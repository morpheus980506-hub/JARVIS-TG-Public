"""Read-only parsing probes and synthetic-conversation live checks; no orders or key edits."""
import asyncio
import json
import sys
from uuid import uuid4
from datetime import datetime,timezone
from pathlib import Path
from time import perf_counter
import httpx
from app.agents.intake import collect_trip_intake,classify_conversation_mode
from app.agents.dining import is_dining_request,dining_city
from app.schemas.domain import ChatMessage

BASE='从温州去哈尔滨玩，2026-12-01出发，3天，1人，预算10000元，希望美食'
RESULTS=[]

def probe(name,latest,field,expected):
    messages=[ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='需求已整理，可以继续修改。'),ChatMessage(role='user',content=latest)]
    try:
        value=collect_trip_intake(messages)
        actual=value.collected.get(field)
        RESULTS.append({'name':name,'kind':'parser','input':latest,'field':field,'expected':expected,'actual':actual,'passed':actual==expected,'mode':classify_conversation_mode(messages),'reply':value.reply})
    except Exception as error:RESULTS.append({'name':name,'kind':'parser','input':latest,'passed':False,'error':type(error).__name__})

def offline():
    for row in [
        ('改出发日期','日期改成12月5日','start_date','2026-12-05'),
        ('改天数','不玩3天了，改成5天','days',5),
        ('改人数','再加一个朋友，现在2人','travelers',2),
        ('改预算','预算改成5000元','budget_cny',5000),
        ('改目的地','不去哈尔滨了，改去成都吧','destination','成都'),
        ('否定目的地','我不去哈尔滨了','destination',None),
        ('改出发地','改成从杭州出发','origin','杭州'),
        ('中文天数修改','改成五天吧','days',5),
        ('改日期跨年','改到2027年1月2日出发','start_date','2027-01-02'),
    ]:probe(*row)
    for answer in ['哈尔滨吧','都行吧','哈尔滨或者长春吧']:
        messages=[ChatMessage(role='user',content=BASE.replace('哈尔滨','东北')),ChatMessage(role='assistant',content='你想去哪个城市？'),ChatMessage(role='user',content=answer)]
        result=collect_trip_intake(messages)
        expected=answer=='哈尔滨吧'
        RESULTS.append({'name':'选城市：'+answer,'kind':'parser','input':answer,'expected_ready':expected,'actual_ready':result.ready,'destination':result.collected.get('destination'),'passed':result.ready==expected})
    context=[ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='已找到哈尔滨餐厅：老厨家、饺子馆。')]
    for answer in ['哪家店','换一家','有没有便宜点的','不要锅包肉，推荐素食餐厅']:
        actual=is_dining_request([*context,ChatMessage(role='user',content=answer)])
        RESULTS.append({'name':'餐厅追问：'+answer,'kind':'intent','input':answer,'passed':actual,'expected_dining':True,'actual_dining':actual})
    RESULTS.append({'name':'省份目的地','kind':'parser','input':'从温州去江西玩，2026-12-01出发，3天，1人，预算10000元，希望美食',
        'ready':collect_trip_intake([ChatMessage(role='user',content=BASE.replace('哈尔滨','江西'))]).ready,
        'note':'省份级目的地需要后续确认具体城市，不能只因字段非空就当成城市。'})


async def live():
    ids=[]
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=65) as client:
        async def turn(name,messages,language='zh',id=None):
            start=perf_counter()
            try:
                response=await client.post('/api/v1/trips/intake/stream',json={'messages':messages,'language':language,'conversation_id':id})
                events=[json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code==200 else []
                result=next((item['intake'] for item in events if item.get('type')=='result'),{})
                row={'name':name,'kind':'live','input':messages[-1]['content'],'http':response.status_code,'elapsed_s':round(perf_counter()-start,2),
                    'ready':result.get('ready'),'collected':result.get('collected'),'trip_request':result.get('trip_request'),'reply':result.get('reply'),
                    'errors':[event.get('message') for event in events if event.get('type')=='error'],
                    'stages':list(dict.fromkeys(event.get('stage') for event in events if event.get('stage')))}
                RESULTS.append(row)
                return result
            except Exception as error:
                RESULTS.append({'name':name,'kind':'live','elapsed_s':round(perf_counter()-start,2),'error':type(error).__name__})
                return {}
        try:
            record=(await client.post('/api/v1/conversations',json={'title':'QA-2026-11-10-临时测试'})).json();ids.append(record['id'])
            history=[{'role':'user','content':BASE}]
            initial=await turn('完整中文需求',history,id=record['id'])
            if initial.get('reply'):history.append({'role':'assistant','content':initial['reply']})
            changed=await turn('修改后是否仍显示旧条件',history+[{'role':'user','content':'日期改成12月5日，改成5天，2人，预算5000元'}],id=record['id'])
            restored=(await client.get('/api/v1/conversations/'+record['id'])).json()
            RESULTS.append({'name':'测试对话恢复','kind':'live','message_count':len(restored.get('messages',[])),'timestamp_count':sum(bool(m.get('created_at')) for m in restored.get('messages',[]))})
            await turn('长回复后的下一次追问',[{'role':'user','content':'计划旅行'},{'role':'assistant','content':'详细安排。'*850},{'role':'user','content':'第二天轻松点'}])
            await turn('完整英文需求',[{'role':'user','content':'Plan a 3-day trip from Wenzhou to Harbin, starting 2026-12-01, 1 traveler, total budget CNY 10000. Focus on food. Please make the itinerary.'}],'en')
            await turn('餐厅换一家短追问',[{'role':'user','content':BASE},{'role':'assistant','content':'已找到餐厅：老厨家(中央大街店)。地址：西七道街55号。'},{'role':'user','content':'换一家，不要这家'}])
            await turn('明确否定原菜系',[{'role':'user','content':BASE},{'role':'assistant','content':'中央大街适合吃锅包肉、铁锅炖。'},{'role':'user','content':'不要锅包肉了，推荐素食餐厅'}])
            health=await client.get('/api/v1/itineraries')
            RESULTS.append({'name':'跨对话行程列表可访问','kind':'live','http':health.status_code,'count':len(health.json()) if health.status_code==200 else None})
        finally:
            for id in ids:
                response=await client.delete('/api/v1/conversations/'+id)
                RESULTS.append({'name':'清理本次测试对话','kind':'cleanup','http':response.status_code,'passed':response.status_code==204})


async def main():
    output_name='logs/user-audit-2026-11-10-public.json' if '--public' in sys.argv else 'logs/user-audit-2026-11-10-fixed.json' if '--fixed' in sys.argv else 'logs/user-audit-2026-11-10.json'
    if '--extra' in sys.argv or '--plan' in sys.argv:
        path=Path(output_name)
        data=json.loads(path.read_text(encoding='utf-8'))
        await (plan_check() if '--plan' in sys.argv else extra_checks())
        data['results'].extend(RESULTS)
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        for result in RESULTS:print(json.dumps(result,ensure_ascii=True))
        return
    offline()
    await live()
    await extra_checks()
    path=Path(output_name)
    path.write_text(json.dumps({'tested_at':datetime.now(timezone.utc).isoformat(),'results':RESULTS},ensure_ascii=False,indent=2),encoding='utf-8')
    for result in RESULTS:
        print(json.dumps({key:value for key,value in result.items() if key not in {'reply','collected','trip_request','input'}},ensure_ascii=True))


async def extra_checks():
    result=collect_trip_intake([ChatMessage(role='user',content='明天从温州去哈尔滨玩，3天，1人，预算10000元，希望美食',created_at='2026-11-09T12:36:00+08:00'),ChatMessage(role='assistant',content='已记录。'),ChatMessage(role='user',content='预算不变')])
    RESULTS.append({'name':'隔天打开相对日期需求','kind':'parser','original_message_time':'2026-11-09T12:36:00+08:00','original_words':'明天','expected_start_date':'2026-11-10','actual_start_date':result.collected.get('start_date')})
    result=collect_trip_intake([ChatMessage(role='user',content=BASE+'，不想太累')])
    RESULTS.append({'name':'否定偏好提取','kind':'parser','preferences':result.collected.get('preferences'),'hard_constraints':result.trip_request.hard_constraints if result.trip_request else None})
    ids=[]
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=30) as client:
        try:
            record=(await client.post('/api/v1/conversations',json={'title':'QA-临时停止与恢复测试'})).json();ids.append(record['id'])
            received=None
            async with client.stream('POST','/api/v1/trips/intake/stream',json={'conversation_id':record['id'],'messages':[{'role':'user','content':'帮我推荐哈尔滨近期适合吃饭的地方，查一下资料。'}]}) as response:
                async for line in response.aiter_lines():
                    if line.strip():received=json.loads(line).get('type');break
            saved=(await client.get('/api/v1/conversations/'+record['id'])).json()
            RESULTS.append({'name':'停止回复后刷新','kind':'live','first_event':received,'saved_message_count':len(saved.get('messages',[])),'expected_at_least_user_message':True})
            record=(await client.post('/api/v1/conversations',json={'title':'QA-需求恢复独立测试'})).json();ids.append(record['id'])
            ready=await client.post('/api/v1/trips/intake',json={'conversation_id':record['id'],'messages':[{'role':'user','content':BASE}]})
            saved=(await client.get('/api/v1/conversations/'+record['id'])).json()
            planner_source=Path('../frontend/src/pages/PlannerPage.tsx').read_text(encoding='utf-8')
            open_source=planner_source.split('async function openConversation',1)[1].split('async function remove',1)[0]
            RESULTS.append({'name':'需求齐全后刷新生成按钮','kind':'api_and_code','ready_before_reload':ready.json().get('ready'),'trip_request_in_restored_detail':bool(saved.get('trip_request')),'front_end_openConversation_clears_request':"setInput(''); setRequest(undefined)" in open_source})
            response=await client.post('/api/v1/trips/intake/stream',json={'messages':[{'role':'user','content':BASE.replace('1人','0人')}]})
            events=[json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code==200 else []
            RESULTS.append({'name':'非法人数的用户反馈','kind':'live','http':response.status_code,'errors':[event.get('message') for event in events if event.get('type')=='error']})
            for index in range(2):
                start=perf_counter()
                response=await client.post('/api/v1/map/weather',json={'west':126.5,'east':127,'south':45.5,'north':46})
                body=response.json()
                RESULTS.append({'name':'地图天气首次请求' if index==0 else '相同范围天气复查','kind':'live','http':response.status_code,'elapsed_s':round(perf_counter()-start,2),'points':len(body.get('points',[])),'hours':len(body.get('hours',[]))})
        finally:
            for id in ids:
                response=await client.delete('/api/v1/conversations/'+id)
                RESULTS.append({'name':'清理附加测试对话','kind':'cleanup','http':response.status_code,'passed':response.status_code==204})


async def plan_check():
    from sqlalchemy import select
    from app.database.db import SessionLocal,TripRecord
    marker='QA-'+uuid4().hex
    text=f'从温州去杭州玩，2026-12-01出发，3天，2人，预算6000元，希望美食与轻松散步。测试标记{marker}'
    id=None;trip_id=None
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=90) as client:
        try:
            id=(await client.post('/api/v1/conversations',json={'title':marker})).json()['id']
            payload={'text':text,'origin':'温州','destination':'杭州','start_date':'2026-12-01','days':3,'travelers':2,'budget_cny':6000,'preferences':['美食','轻松散步'],'allow_mock':False}
            start=perf_counter()
            response=await client.post('/api/v1/trips/plan/stream',json=payload)
            events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            plan=next((event['plan'] for event in events if event.get('type')=='result'),{})
            trip_id=plan.get('trip_id')
            RESULTS.append({'name':'三天城市完整规划','kind':'live_plan','http':response.status_code,'elapsed_s':round(perf_counter()-start,2),'got_plan':bool(plan),'days':len(plan.get('itinerary',[])),
                'stop_counts':[len(day.get('stops',[])) for day in plan.get('itinerary',[])],
                'daily_activities':[day['activities'] for day in plan.get('itinerary',[])],
                'hotels':len(plan.get('hotels',[])),'transport':len(plan.get('transport',[])),
                'total_cost_cny':plan.get('total_cost_cny'),'verification':plan.get('verification'),
                'data_mode':plan.get('data_mode')})
            if not plan:return
            saved=(await client.put(f'/api/v1/conversations/{id}/workspace/plan',json={'trip_id':trip_id})).json()
            exported=(await client.get(f'/api/v1/conversations/{id}/workspace/export')).text
            detail=(await client.get('/api/v1/conversations/'+id)).json()
            RESULTS.append({'name':'完整规划保存恢复与导出','kind':'live_plan','has_completion':bool(saved.get('plan_feedback')),'restored_days':len((detail.get('itinerary') or {}).get('days',[])),
                'plan_total':saved.get('plan',{}).get('total_cost_cny'),'selected_total':saved.get('budget',{}).get('selected_total_cny'),'export':exported})
            candidate=next((hotel for hotel in plan.get('hotels',[]) if hotel.get('candidate_id')),None)
            if candidate:
                selected=await client.post(f'/api/v1/conversations/{id}/workspace/selections',json={'candidate_id':candidate['candidate_id'],'category':'hotel','unit_price_cny':100.25,'quantity':2})
                view=selected.json();selection_id=(view.get('selections') or [{}])[0].get('id')
                edited=await client.patch(f'/api/v1/conversations/{id}/workspace/selections/{selection_id}',json={'category':'hotel','unit_price_cny':120.25,'quantity':3})
                actual=edited.json().get('budget',{}).get('selected_total_cny')
                RESULTS.append({'name':'候选加入与费用编辑','kind':'live_plan','add_http':selected.status_code,'edit_http':edited.status_code,'expected':360.75,'actual':actual,'passed':actual==360.75})
        finally:
            if id:
                response=await client.delete('/api/v1/conversations/'+id)
                RESULTS.append({'name':'清理完整规划测试对话','kind':'cleanup','passed':response.status_code==204})
            async with SessionLocal() as session:
                records=(await session.scalars(select(TripRecord).where(TripRecord.request_text==text))).all()
                for record in records:
                    if marker not in record.request_text:raise RuntimeError('Cleanup guard')
                    await session.delete(record)
                await session.commit()
                RESULTS.append({'name':'仅清理带唯一标记的测试计划','kind':'cleanup','removed':len(records)})


if __name__=='__main__':asyncio.run(main())
