import asyncio
from copy import deepcopy
from datetime import date, timedelta
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from typing import Literal
import hashlib
import json
import re

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field, ConfigDict
from app.database.db import SessionLocal, ConversationRecord, ConversationState, TripRecord
from app.database.conversation_locks import conversation_lock
from app.tools.providers.travel_search import TravelSearchError
from app.agents.conversation_state import update_itinerary
from app.agents.destination import invalid_route_place, normalize_place


class AttachPlan(BaseModel):
    trip_id:str=Field(min_length=1,max_length=64)
    language:Literal['zh','en']='zh'


class SelectionCost(BaseModel):
    model_config=ConfigDict(extra='forbid')
    category:str=Field(pattern='^(hotel|transport|tickets|food|other)$')
    unit_price_cny:Decimal=Field(ge=0,le=10000000,max_digits=12,decimal_places=2)
    quantity:int=Field(ge=1,le=365)
    note:str=Field(default='',max_length=300)


class AddSelection(SelectionCost):
    candidate_id:str=Field(min_length=1,max_length=64)


class EditSelection(SelectionCost):
    review_confirmed:bool=False


def budget_summary(selections,limit=None):
    totals={}
    for item in selections:
        value=Decimal(str(item['unit_price_cny']))*item['quantity']
        totals[item['category']]=totals.get(item['category'],Decimal('0'))+value
    total=sum(totals.values(),Decimal('0'))
    return {'selected_total_cny':float(total),'categories':{key:float(value) for key,value in totals.items()},
            'budget_cny':limit,'remaining_cny':float(Decimal(str(limit))-total) if limit is not None else None,
            'is_estimate':True}


async def workspace(session,id):
    if not await session.get(ConversationRecord,id):raise HTTPException(404,'Conversation not found')
    record=await session.get(ConversationState,id)
    if not record:
        record=ConversationState(id=id,payload={});session.add(record)
    return record


def current_requirements(state,plan=None):
    # The displayed plan can deliberately remain the previous version while edits are pending.
    return {**((plan or {}).get('requirement',{})),**state.get('requirements',{})}


async def workspace_view(session,record):
    state=record.payload or {}
    if 'itinerary' not in state:
        conversation=await session.get(ConversationRecord,record.id)
        snapshot=None
        for message in (conversation.messages or []) if conversation else []:
            if message.get('role')=='assistant':snapshot=update_itinerary(snapshot,message.get('content',''))
        if snapshot:state={**state,'itinerary':snapshot}
    trip=await session.get(TripRecord,state['trip_id']) if state.get('trip_id') else None
    plan=deepcopy(trip.payload) if trip else None
    invalid_itinerary = bool(plan and any(
        (place := plan['requirement'].get(field)) and invalid_route_place(normalize_place(place))
        for field in ('origin','destination')
    ))
    if invalid_itinerary:
        return {'plan':None,'itinerary':None,'invalid_itinerary':True,'selections':deepcopy(state.get('selections',[])),
                'plan_feedback':None,'route_review':None,'weather_review':None,
                'budget':budget_summary(state.get('selections',[]),state.get('budget_limit'))}
    selections=deepcopy(state.get('selections',[]))
    if plan:
        if not (state.get('itinerary') or {}).get('pending_revision'):
            for key,value in state.get('requirements',{}).items():
                if key in {'origin','destination','start_date','days','travelers','budget_cny'} and value is not None:plan['requirement'][key]=value
        for key in ['origin','destination']:
            if plan['requirement'].get(key):plan['requirement'][key]=normalize_place(plan['requirement'][key])
        snapshot=state.get('itinerary')
        if snapshot and not snapshot.get('pending_revision'):
            start=date.fromisoformat(plan['requirement']['start_date'])
            previous={day['day']:day for day in plan['itinerary']}
            unchanged=lambda day:previous.get(day['day'],{}).get('activities')==day['items'] and previous.get(day['day'],{}).get('title')==day['title']
            revised=len(snapshot['days'])!=len(previous) or any(not unchanged(day) for day in snapshot['days'])
            plan['itinerary']=[{**(previous.get(day['day'],{}) if unchanged(day) else {'notes':['安排已变更，路线与开放时间需重新核验'],'stops':[],'route_checks':[]}),
                                'day':day['day'],'date':(start+timedelta(days=day['day']-1)).isoformat(),
                                'title':day['title'],'activities':day['items']} for day in snapshot['days']]
            if not snapshot.get('incomplete'):plan['requirement']['days']=len(snapshot['days'])
            if revised or snapshot.get('incomplete'):
                verification=plan.setdefault('verification',{'status':'WARNING','issues':[]})
                if verification.get('status')!='FAIL':verification['status']='WARNING'
                verification.setdefault('issues',[]).append({'code':'ITINERARY_REVISED','status':'WARNING','message':'每日安排已修改，路线、营业与预约信息需重新核验'})
        amounts=budget_summary([] if (state.get('itinerary') or {}).get('previous_trip') else selections)['categories']
        for cost in plan['costs']:
            if cost['category'] in amounts:
                cost['amount_cny']=amounts.pop(cost['category']);cost['description']+='（仅已选部分，未选尚未计入）'
        plan['costs'] += [{'category':category,'description':'已选候选估算','amount_cny':amount,'is_estimate':True} for category,amount in amounts.items()]
        plan['total_cost_cny']=float(sum(Decimal(str(cost['amount_cny'])) for cost in plan['costs']))
        plan['remaining_budget_cny']=float(Decimal(str(plan['requirement']['budget_cny']))-Decimal(str(plan['total_cost_cny'])))
        if plan['total_cost_cny']>plan['requirement']['budget_cny']:
            verification=plan.setdefault('verification',{'status':'WARNING','issues':[]})
            if verification.get('status')!='FAIL':verification['status']='WARNING'
            verification.setdefault('issues',[]).append({'code':'SELECTION_BUDGET','status':'WARNING','message':'当前候选和其余估算合计超过预算'})
    requirement=current_requirements(state,plan)
    for item in selections:
        context=item.get('trip_context',{})
        item['needs_review']=any(context.get(key) is not None and requirement.get(key)!=context[key] for key in ['destination','start_date','days','travelers'])
        if item['category']=='hotel' and item.get('city'):
            allowed=[requirement.get('destination') or '']
            if plan and requirement.get('destination')==plan['requirement'].get('destination'):
                allowed.extend(day['title'] for day in plan.get('itinerary',[]))
            item['needs_review']=item['needs_review'] or not any(item['city'].rstrip('市') in value for value in allowed)
    review=state.get('route_review')
    weather_review=deepcopy(state.get('weather_review'))
    if weather_review and plan and weather_review.get('destination')!=plan['requirement']['destination']:weather_review=None
    if weather_review and plan:
        covered={match.group(0) for fact in weather_review['facts'] if (match:=re.search(r'\d{4}-\d{2}-\d{2}',fact['name']))}
        weather_review['covers_departure']=plan['requirement']['start_date'] in covered
    signature=hashlib.sha256(json.dumps(state.get('itinerary'),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {'itinerary':state.get('itinerary'),'plan':plan,'selections':selections,'plan_feedback':state.get('plan_feedback'),
            'route_review':review if review and review.get('signature')==signature else None,'weather_review':weather_review,
            'budget':budget_summary(selections,state['budget_limit'] if 'budget_limit' in state else plan['requirement']['budget_cny'] if plan else None)}


def build_workspace_router(orchestrator):
    async def check_origin(request:Request):
        allowed={getattr(getattr(orchestrator,'settings',None),'frontend_origin','http://localhost:5173'),'http://127.0.0.1:5173','http://localhost:5173',str(request.base_url).rstrip('/')}
        if request.headers.get('origin') and request.headers['origin'] not in allowed:raise HTTPException(403,'Untrusted workspace origin')
    router=APIRouter(prefix='/api/v1/conversations',dependencies=[Depends(check_origin)])

    @router.get('/{id}/workspace')
    async def get_workspace(id:str):
        async with SessionLocal() as session:
            record=await workspace(session,id)
            return await workspace_view(session,record)

    @router.put('/{id}/workspace/plan')
    async def attach_plan(id:str,payload:AttachPlan):
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            trip=await session.get(TripRecord,payload.trip_id)
            if not trip:raise HTTPException(404,'Trip not found')
            plan=trip.payload
            facts=record.payload.get('requirements',{})
            if facts and (facts.get('planning_status','active')!='active' or any(
                key in facts and facts[key]!=plan['requirement'].get(key) for key in ['origin','destination','start_date','days','travelers','budget_cny'])):
                raise HTTPException(409,'旅行条件已变更，这份旧计划未保存，请按当前条件重新生成。')
            if record.payload.get('trip_id')==trip.id and record.payload.get('plan_feedback',{}).get('trip_id')==trip.id:
                return await workspace_view(session,record)
            snapshot={'days':[{'day':day['day'],'title':day['title'],'items':day['activities']} for day in plan['itinerary']],
                      'updated_at':datetime.now(timezone.utc).isoformat()}
            selections=[{**item,'trip_context':{key:(item.get('trip_context',{}).get(key) if item.get('trip_context',{}).get(key) is not None else plan['requirement'].get(key)) for key in ['destination','start_date','days','travelers']}} for item in record.payload.get('selections',[])]
            record.payload={**record.payload,'trip_id':trip.id,'itinerary':snapshot,'selections':selections,'ready_for_plan':False}
            if record.payload.get('plan_feedback',{}).get('trip_id')!=trip.id:
                draft=not any(day.get('stops') for day in plan['itinerary'])
                english=payload.language=='en'
                title=('Itinerary draft saved' if draft else 'Itinerary saved') if english else ('行程草案已保存' if draft else '行程已生成并保存')
                days='\n'.join(f"- D{day['day']} · {day['title']}" for day in plan['itinerary'][:7])
                tail=('Specific places still need to be added. You can continue refining this trip here.' if draft else 'Open the itinerary to see the daily schedule, or tell me what to change.') if english else ('具体游玩地点仍待补充，可以继续在这里细化。' if draft else '可查看每天的安排，也可以直接告诉我想修改哪里。')
                feedback=f"**{title} · {len(plan['itinerary'])}{' days' if english else '天'}**\n\n{days}\n\n{tail}"
                pending=[issue['message'] for issue in plan.get('verification',{}).get('issues',[]) if issue.get('status') in {'WARNING','FAIL'}]
                if pending:feedback+='\n\n'+(f'{len(pending)} checks still need review:' if english else f'仍有{len(pending)}项待核对：')+'\n'+'\n'.join('- '+item for item in pending[:3])
                conversation=await session.get(ConversationRecord,id)
                completed_at=datetime.now(timezone.utc)
                conversation.messages=[*(conversation.messages or []),{'role':'assistant','content':feedback,'created_at':completed_at.isoformat()}]
                conversation.updated_at=completed_at
                record.payload={**record.payload,'plan_feedback':{'trip_id':trip.id,'text':feedback,'created_at':completed_at.isoformat()}}
            await session.commit()
            return await workspace_view(session,record)

    @router.post('/{id}/workspace/selections')
    async def select_candidate(id:str,payload:AddSelection):
        try:candidate=orchestrator.travel_gateway.candidate(payload.candidate_id)
        except TravelSearchError:raise HTTPException(410,'候选已过期，请重新查询') from None
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            view=await workspace_view(session,record)
            requirement=current_requirements(record.payload,view.get('plan'))
            current=list(record.payload.get('selections',[]))
            # Repeating a selection edits its amount instead of double-counting it.
            previous=next((item for item in current if item['candidate_id']==payload.candidate_id),None)
            selected={'id':previous['id'] if previous else uuid4().hex,**candidate,**payload.model_dump(mode='json'),
                      'trip_context':{key:requirement.get(key) for key in ['destination','start_date','days','travelers']},
                      'unit_price_cny':float(payload.unit_price_cny),'is_estimate':True}
            current=[item for item in current if item['candidate_id']!=payload.candidate_id]+[selected]
            if len(current)>100:raise HTTPException(400,'Too many selections')
            record.payload={**record.payload,'selections':current}
            await session.commit()
            return await workspace_view(session,record)

    @router.delete('/{id}/workspace/selections/{selection_id}')
    async def remove_selection(id:str,selection_id:str):
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            record.payload={**record.payload,'selections':[item for item in record.payload.get('selections',[]) if item['id']!=selection_id]}
            await session.commit()
            return await workspace_view(session,record)

    @router.patch('/{id}/workspace/selections/{selection_id}')
    async def edit_selection(id:str,selection_id:str,payload:EditSelection):
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            current=deepcopy(record.payload.get('selections',[]))
            selected=next((item for item in current if item['id']==selection_id),None)
            if selected is None:raise HTTPException(404,'所选项目不存在')
            selected.update(payload.model_dump(mode='json',exclude={'review_confirmed'}))
            selected['unit_price_cny']=float(payload.unit_price_cny)
            if payload.review_confirmed:
                view=await workspace_view(session,record)
                requirement=current_requirements(record.payload,view.get('plan'))
                selected['trip_context']={key:requirement.get(key) for key in ['destination','start_date','days','travelers']}
                selected['reviewed_at']=datetime.now(timezone.utc).isoformat()
            record.payload={**record.payload,'selections':current}
            await session.commit()
            return await workspace_view(session,record)

    @router.get('/{id}/workspace/export')
    async def export(id:str):
        async with SessionLocal() as session:
            record=await workspace(session,id)
            view=await workspace_view(session,record)
            requirement=current_requirements(record.payload,view.get('plan'))
        if view.get('invalid_itinerary'):
            raise HTTPException(422,'草案的路线有误，请回到对话确认出发地和目的地后重新生成。')
        lines=['# 旅行行程','']
        snapshot=view.get('itinerary') or {}
        if snapshot.get('planning_status')=='cancelled':lines.extend(['规划已暂停，以下为已保存方案。',''])
        elif snapshot.get('previous_trip'):lines.extend(['旅行条件已重置，以下仅保留上一趟已保存行程。',''])
        elif snapshot.get('incomplete'):lines.extend(['当前为未完成草案，部分旅行天数仍待补齐。',''])
        elif snapshot.get('pending_revision'):lines.extend(['修改尚未完成，以下保留上一版安排。',''])
        plan=view.get('plan')
        if plan:
            req=plan['requirement']
            lines.extend([f"{req.get('origin','出发地未记录')} → {req.get('destination','目的地未记录')} · {req.get('start_date','日期未记录')} · {req.get('days','—')}天 · {req.get('travelers','—')}人",f"总预算：¥{req['budget_cny']:.2f}",''])
        elif requirement:
            lines.extend([f"{requirement.get('origin') or '出发地未记录'} → {requirement.get('destination') or '目的地未记录'} · {requirement.get('start_date') or '日期未记录'} · {requirement.get('days') or '—'}天 · {requirement.get('travelers') or '—'}人"])
            limit=view['budget']['budget_cny']
            lines.extend([f'总预算：¥{limit:.2f}' if limit is not None else '总预算尚未确定','尚无全行程费用估算，已选候选费用仅代表已选部分。',''])
        for day in (view['itinerary'] or {}).get('days',[]):
            lines.extend([f"## D{day['day']} {day['title']}",*[f'- {item}' for item in day['items']],''])
            if plan:
                detail=next((item for item in plan['itinerary'] if item['day']==day['day']),{})
                lines.extend(f'- 说明：{note}' for note in detail.get('notes',[]))
        if plan:
            lines.extend(['## 全行程费用估算',''])
            lines.extend(f"- {cost['description']}：¥{cost['amount_cny']:.2f}" for cost in plan['costs'])
            lines.extend([f"全行程估算合计：¥{plan['total_cost_cny']:.2f}",f"预算余额（估算）：¥{plan['remaining_budget_cny']:.2f}",''])
            issues=[issue for issue in plan.get('verification',{}).get('issues',[]) if issue.get('status') in {'WARNING','FAIL'}]
            if issues:lines.extend(['## 待核对事项','',*[f"- {issue['message']}" for issue in issues],''])
        lines.extend(['## 已选候选（费用为估算）',''])
        for item in view['selections']:
            lines.append(f"- {item['title']} · {item['provider']} · ¥{item['unit_price_cny']} × {item['quantity']}")
            if item.get('needs_review'):lines.append('  - 行程条件已变化，此候选与估算需重新核对。')
            if item.get('note'):lines.append('  - 备注：'+item['note'])
            if item.get('url'):lines.append(item['url'])
        lines.extend(['',f"已选费用合计：¥{view['budget']['selected_total_cny']:.2f}（不含尚未选择的项目）"])
        if view.get('route_review'):
            lines.extend(['','## 自驾路程复核'])
            for item in view['route_review']['days']:lines.append(f"- D{item['day']} {item['origin']} → {item['destination']}：{item.get('driving_hours','待核验')}小时；{item.get('warning','')}")
        if view.get('weather_review'):
            weather=view['weather_review']
            lines.extend(['','## 天气资料',f"更新于：{weather['checked_at']}",f"是否覆盖出发日：{'是' if weather.get('covers_departure') else '否'}"])
            lines.extend(f"- {fact['name']}：{fact['value']}（{fact.get('source_url','')}）" for fact in weather.get('facts',[]))
        return Response('\n'.join(lines),media_type='text/markdown; charset=utf-8',headers={'Content-Disposition':'attachment; filename="trip.md"'})

    @router.post('/{id}/workspace/check-routes')
    async def check_routes(id:str):
        async with SessionLocal() as session:
            record=await workspace(session,id)
            itinerary=record.payload.get('itinerary')
        provider=getattr(orchestrator.tool_gateway,'amap',None)
        if not provider:raise HTTPException(503,'地图服务尚未配置')
        routes=[]
        for day in (itinerary or {}).get('days',[]):
            match=re.search(r'([\u4e00-\u9fffA-Za-z]{2,15})\s*(?:→|->)\s*([\u4e00-\u9fffA-Za-z]{2,15})',day['title'])
            if match:routes.append((day['day'],match.group(1),match.group(2)))
        if not routes:raise HTTPException(422,'未识别到每天的自驾起终点，可在地图中按天查询。')
        semaphore=asyncio.Semaphore(3)
        async def check(number,origin,destination):
            async with semaphore:
                result={'day':number,'origin':origin,'destination':destination}
                try:
                    measured=await asyncio.wait_for(provider.driving_overview(origin,destination),timeout=18)
                    hours=float(measured['driving_hours'])
                    result.update(distance_km=measured['distance_km'],driving_hours=hours,
                        rest_minutes=int(hours//2)*20,
                        warning='纯驾驶已超过6小时，建议拆分或减少游玩安排' if hours>6 else '仍需另计游玩、用餐、停车和进出城时间',status='checked')
                except Exception:result.update(status='unavailable',warning='路线暂未核验成功，请到地图确认')
                return result
        days=await asyncio.gather(*[check(*route) for route in routes])
        signature=hashlib.sha256(json.dumps(itinerary,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            current_signature=hashlib.sha256(json.dumps(record.payload.get('itinerary'),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            if signature!=current_signature:raise HTTPException(409,'行程已变更，请重新核对')
            record.payload={**record.payload,'route_review':{'days':days,'signature':signature,'checked_at':datetime.now(timezone.utc).isoformat()}}
            await session.commit()
            return await workspace_view(session,record)

    @router.post('/{id}/workspace/refresh-weather')
    async def refresh_weather(id:str):
        async with SessionLocal() as session:
            view=await workspace_view(session,await workspace(session,id))
        plan=view.get('plan')
        if not plan:raise HTTPException(422,'请先生成含目的地与日期的完整行程')
        if invalid_route_place(plan['requirement']['destination']):
            raise HTTPException(422,'请先在对话中确认行程目的地')
        if (view.get('itinerary') or {}).get('pending_revision'):raise HTTPException(409,'行程修改尚未完成，请先更新行程再刷新天气')
        try:
            facts,mode=await asyncio.wait_for(orchestrator.tool_gateway.weather(plan['requirement']['destination'],min(plan['requirement']['days'],7),False),timeout=20)
            if not facts or mode!='real':raise ValueError()
        except Exception:raise HTTPException(503,'天气更新未完成，已保留上次结果') from None
        target=plan['requirement']['start_date']
        coverage=sorted({match.group(0) for fact in facts if (match:=re.search(r'\d{4}-\d{2}-\d{2}',fact.name))})
        review={'facts':[fact.model_dump(mode='json') for fact in facts],'destination':plan['requirement']['destination'],
                'covers_departure':target in coverage,'checked_at':datetime.now(timezone.utc).isoformat()}
        async with conversation_lock(id),SessionLocal() as session:
            record=await workspace(session,id)
            latest=current_requirements(record.payload,plan)
            if record.payload.get('trip_id')!=plan['trip_id'] or any(latest.get(key)!=plan['requirement'].get(key) for key in ['destination','start_date','days']) or (record.payload.get('itinerary') or {}).get('pending_revision'):
                raise HTTPException(409,'行程已变更，请重新更新天气')
            record.payload={**record.payload,'weather_review':review}
            await session.commit()
            return await workspace_view(session,record)

    return router
