import asyncio
import json
import re
from datetime import timedelta
from app.schemas.domain import DayPlan
from app.tools.providers.amap import AmapLocationMismatch
from types import SimpleNamespace


async def driving_schedule(state):
    req=state['requirement'];model=state.get('model_gateway')
    amap=getattr(state.get('tool_gateway'),'amap',None)
    text=state['request'].text
    normalized=re.sub(r'不(?:考虑|安排|规划|需要|用|要)?(?:返程|返回|回到)|(?:返程|返回)不(?:安排|考虑|规划)','单程',text)
    markers=re.findall(r'单程|往返|返程|返回|回到|one.way|round.trip|return trip',normalized,re.I)
    return_trip=bool(markers and not re.match(r'单程|one.way',markers[-1],re.I))
    final=req.origin if return_trip else req.destination
    stops=None
    if model:
        try:
            result=await model.generate_fast([{'role':'system','content':
                '你是自驾途经城市建议器，只输出JSON {"stops":["第一晚城市",...]}。'
                f'出发{req.origin}，目的地{req.destination}，{req.days}天，最后到{final}。'
                'stops长度必须等于天数，每项是当天终点，可重复城市代表停留游玩。只用真实城市，最后一项必须原样使用上面指定的最终地点，跨省同名城市要注明省份。'
                '尽量均衡每日驾驶，优先每段4至6小时，留出服务区休息。你提出的是候选，后续会用地图验证，不能声称路程已核验。'},
                {'role':'user','content':text}],temperature=0,max_tokens=500)
            raw=re.sub(r'^```(?:json)?\s*|\s*```$','',result.content.strip())
            stops=json.loads(raw).get('stops')
            if not isinstance(stops,list) or len(stops)!=req.days or any(not isinstance(s,str) or not 1<len(s)<40 for s in stops):raise ValueError()
            if stops[-1].rstrip('市')!=final.rstrip('市'):raise ValueError()
            if return_trip and not any(req.destination.rstrip('市') in stop for stop in stops):raise ValueError()
        except Exception:stops=None
    if not stops:
        return {'itinerary':[DayPlan(day=i+1,date=req.start_date+timedelta(days=i),title=f'{req.origin} → {final} · 分段待确认',
            activities=['逐日途经城市尚未核对成功，请调整天数或明确中途停留城市'],notes=['不能据此判断当天可达或驾驶强度'],route_checks=[{'status':'unavailable'}]) for i in range(req.days)]}
    semaphore=asyncio.Semaphore(3)
    async def day(index,destination):
        origin=stops[index-1] if index else req.origin
        activities=[];checks=[];notes=['路程按城市位置估算，不含市内景点往返；出发前用导航核对具体地址','开放时间与预约规则需另外核验']
        if origin.rstrip('市')==destination.rstrip('市'):
            activities=['上午 · 休整或市内游玩','午间 · 用餐与休息','下午 · 按体力安排一个地点候选'];hours=0
        elif amap:
            try:
                async with semaphore:route=await asyncio.wait_for(amap.driving_overview(origin,destination),timeout=18)
                hours=float(route['driving_hours'])
                rest=int(hours//2)*20
                checks=[{'mode':'driving','hours':hours,'minutes':round(hours*60),'distance_km':route['distance_km'],'source':'AMap','from':origin,'to':destination}]
                activities=[f"驾车 · 约{route['distance_km']}公里，纯驾驶约{hours}小时",f'休息 · 每约2小时休息20分钟，建议至少预留{rest}分钟',f'到达{destination}后用餐和休整'+('，按已选住宿安排入住' if req.days>1 else '')]
                if hours>6:notes.append('当天纯驾驶超过6小时，建议延长行程或调整停留点，当天不安排必游景点')
                elif hours<=4.5:activities.append('可选 · 抵达后视体力安排一处市内游览，先核对开放时间')
            except AmapLocationMismatch:
                hours=None;checks=[{'status':'unavailable','reason':'location_mismatch'}];activities=[f'{origin}到{destination}的城市位置未能准确识别，需要重新确认地名']
            except Exception as error:
                code=re.search(r'AMap API error (\d+)',str(error))
                reason='amap_'+code.group(1) if code else type(error).__name__
                hours=None;checks=[{'status':'unavailable','reason':reason}];activities=[f'{origin}到{destination}的路线暂未核对成功，不按预计到达时间安排景点']
        else:
            hours=None;checks=[{'status':'unavailable'}];activities=[f'从{origin}前往{destination}，具体路程与驾驶时间待核验']
        return DayPlan(day=index+1,date=req.start_date+timedelta(days=index),title=f'{origin} → {destination}',activities=activities,notes=notes,route_checks=checks)
    plans=await asyncio.gather(*[day(index,destination) for index,destination in enumerate(stops)])
    if not state.get('_place_retry') and any(c.get('reason')=='location_mismatch' for plan in plans for c in plan.route_checks):
        failed=[plan.title for plan in plans if any(c.get('reason')=='location_mismatch' for c in plan.route_checks)]
        retry_text=text+'\n以下城市的省市组合未被地图识别：'+ '；'.join(failed)+'。请修正中途城市的地名，保持最后终点不变。可以仅用明确的城市名，不要猜测省份。'
        return await driving_schedule({**state,'request':SimpleNamespace(text=retry_text),'_place_retry':True})
    return {'itinerary':plans}
