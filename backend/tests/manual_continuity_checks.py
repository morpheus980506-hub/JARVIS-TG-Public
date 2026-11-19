"""Live continuity checks with independent QA chats and one uniquely marked plan."""
import asyncio
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
from sqlalchemy import select
from app.database.db import SessionLocal,TripRecord
from tests.manual_unexpected_audit import BASE


async def main():
    marker='QA-continuity-'+uuid4().hex;ids=[];rows=[];plan_text=None
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=100) as client:
        async def create():
            result=await client.post('/api/v1/conversations',json={'title':marker});result.raise_for_status()
            id=result.json()['id'];ids.append(id);return id
        async def turn(id,text):
            detail=(await client.get('/api/v1/conversations/'+id)).json()
            response=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':detail['messages']+[{'role':'user','content':text}]})
            response.raise_for_status();events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            result=next(event['intake'] for event in events if event.get('type')=='result')
            restored=(await client.get('/api/v1/conversations/'+id)).json()
            assert restored['ready']==result['ready'] and restored['trip_request']==result['trip_request'] and restored['itinerary']==result['itinerary']
            rows.append({'check':'conversation state consistency','input':text,'passed':True})
            return result
        async def workspace(id):return (await client.get('/api/v1/conversations/'+id+'/workspace')).json()
        try:
            id=await create();intake=await turn(id,BASE)
            request={**intake['trip_request'],'text':intake['trip_request']['text']+'\n'+marker,'allow_mock':False};plan_text=request['text']
            start=perf_counter();response=await client.post('/api/v1/trips/plan/stream',json=request)
            response.raise_for_status();events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            plan=next(event['plan'] for event in events if event.get('type')=='result')
            attached=await client.put('/api/v1/conversations/'+id+'/workspace/plan',json={'trip_id':plan['trip_id']});attached.raise_for_status()
            original=await workspace(id);original_days=original['itinerary']['days']
            rows.append({'check':'full plan and matching save','passed':True,'elapsed_s':round(perf_counter()-start,2),'data_mode':plan.get('data_mode')})
            await turn(id,'预算改成5000元')
            assert (await workspace(id))['budget']['budget_cny']==5000
            undone=await turn(id,'撤销刚才的修改')
            assert undone['collected']['budget_cny']==10000 and not undone['ready'] and not undone['itinerary'].get('pending_revision')
            assert (await workspace(id))['itinerary']['days']==original_days
            changed=await turn(id,'把第二天的安排改成轻松一些，保留其他天')
            content_changed=changed['itinerary']['days']!=original_days
            assert content_changed
            undone=await turn(id,'撤销刚才的修改')
            assert undone['itinerary']['days']==original_days and undone['collected']['budget_cny']==10000
            paused=await turn(id,'取消这趟旅行')
            assert paused['itinerary']['planning_status']=='cancelled' and not paused['ready']
            paused_edit=await turn(id,'把第二天改成轻松一些')
            assert paused_edit['itinerary']['days']==original_days
            await turn(id,'恢复行程规划')
            reset=await turn(id,'之前的条件都作废，重新开始')
            assert reset['itinerary']['previous_trip'] and reset['collected']['destination'] is None
            await turn(id,'新旅行第二天怎么玩？')
            assert (await workspace(id))['itinerary']['days']==original_days
            undone=await turn(id,'撤销刚才的修改')
            assert undone['itinerary']['days']==original_days and undone['collected']['destination']=='哈尔滨'
            new=await turn(id,'重新开始，从杭州去苏州，2027-01-02出发，2天，1人，总预算2000元，希望园林')
            assert new['collected']['destination']=='苏州' and new['itinerary']['previous_trip']
            stale=await client.put('/api/v1/conversations/'+id+'/workspace/plan',json={'trip_id':plan['trip_id']})
            assert stale.status_code==409
            rows.append({'check':'budget and day undo; paused edits; reset undo; delayed save protection','passed':True,'day_content_changed':content_changed})

            hotel_id=await create();await turn(hotel_id,BASE)
            initial=await turn(hotel_id,'帮我查杭州酒店，先只查飞猪。入住和退房日期还没定')
            assert not initial.get('travel_results')
            dates=await turn(hotel_id,'2026-12-01入住，12月3日退房')
            assert dates['collected']['destination']=='哈尔滨' and dates['collected']['start_date']=='2026-12-01'
            results=dates.get('travel_results') or []
            assert results
            rows.append({'check':'short hotel date answer reaches supplier without changing trip','passed':True,
                         'providers':[{'provider':result['provider'],'items':len(result.get('items',[])),'error':result.get('error')} for result in results]})
        finally:
            for id in ids:
                response=await client.delete('/api/v1/conversations/'+id)
                rows.append({'check':'cleanup QA conversation','passed':response.status_code==204})
            if plan_text:
                async with SessionLocal() as session:
                    records=(await session.scalars(select(TripRecord).where(TripRecord.request_text==plan_text))).all()
                    for record in records:
                        if marker not in record.request_text:raise RuntimeError('Cleanup guard')
                        await session.delete(record)
                    await session.commit()
                    rows.append({'check':'cleanup uniquely marked plan','passed':True,'removed':len(records)})
            Path('logs/continuity-audit-2026-11-10-public4.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(rows),'all_passed':all(row['passed'] for row in rows),'summary':[row for row in rows if row['check']!='conversation state consistency']},ensure_ascii=True))


if __name__=='__main__':asyncio.run(main())
