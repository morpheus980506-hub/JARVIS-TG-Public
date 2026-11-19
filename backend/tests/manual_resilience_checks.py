"""Live public.3 checks; disposable QA chats and one explicitly marked plan only."""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
from sqlalchemy import select
from app.database.db import SessionLocal, TripRecord
from tests.manual_unexpected_audit import BASE


async def main():
    marker='QA-resilience-'+uuid4().hex
    rows=[];ids=[];plan_text=None
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=100) as client:
        async def create():
            response=await client.post('/api/v1/conversations',json={'title':marker})
            response.raise_for_status();id=response.json()['id'];ids.append(id);return id
        async def turn(id,text,expected):
            detail=(await client.get('/api/v1/conversations/'+id)).json()
            response=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':detail['messages']+[{'role':'user','content':text}]})
            response.raise_for_status()
            events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            result=next(event['intake'] for event in events if event.get('type')=='result')
            for key,value in expected.items():
                assert (result['ready'] if key=='ready' else result['collected'].get(key))==value,(text,key)
            saved=(await client.get('/api/v1/conversations/'+id)).json()
            assert saved['ready']==result['ready'] and saved['trip_request']==result['trip_request']
            rows.append({'check':'conversation','input':text,'passed':True,'ready':result['ready'],'collected':result['collected']})
            return result
        try:
            for body in [
                {'messages':[{'role':'assistant','content':'invalid'}]},
                {'messages':[{'role':'user','content':' \n\t'}]},
                {'messages':[{'role':'user','content':'A'*4001}]},
            ]:
                response=await client.post('/api/v1/trips/intake',json=body)
                assert response.status_code==422
            response=await client.post('/api/v1/trips/plan',content='{"text":"QA-only","budget_cny":Infinity}',headers={'Content-Type':'application/json'})
            assert response.status_code==422
            rows.append({'check':'malformed turns and nonfinite JSON rejected','passed':True})
            id=await create()
            for text,expected in [
                (BASE,{'ready':True,'travelers':2}),
                ('先别改预算，人数改成3人',{'travelers':3,'budget_cny':10000}),
                ('人均2000元，总预算4000元',{'budget_cny':4000}),
                ('撤销刚才的修改',{'budget_cny':10000}),
                ('人数改成1人',{'travelers':1}),
                ('先别改日期，预算改成8000元',{'budget_cny':8000,'start_date':'2026-12-01'}),
                ('出发日期未定',{'ready':False,'start_date':None}),
                ('日期改成2027-01-02',{'ready':True,'start_date':'2027-01-02'}),
                ('取消这趟旅行',{'ready':False}),
                ('预算改成5000元',{'ready':False,'budget_cny':5000}),
                ('恢复行程规划',{'ready':True,'budget_cny':5000}),
                ('哈尔滨明天天气怎么样？',{'start_date':'2027-01-02'}),
            ]:await turn(id,text,expected)
            # A hypothetical day-by-day reply must not become the saved itinerary.
            result=await turn(id,'如果去成都玩3天怎么排？先别改我的行程',{'destination':'哈尔滨','days':3})
            assert result['itinerary'] is None
            assert (await client.get('/api/v1/conversations/'+id+'/workspace')).json()['itinerary'] is None
            rows.append({'check':'hypothetical itinerary not promoted after restore','passed':True})

            id=await create()
            await turn(id,BASE,{'ready':True,'travelers':2})
            request=(await turn(id,'人数改成1人',{'ready':True,'travelers':1}))['trip_request']
            request.update(text=request['text']+'\n'+marker,allow_mock=False)
            plan_text=request['text'];started=perf_counter()
            response=await client.post('/api/v1/trips/plan/stream',json=request)
            response.raise_for_status()
            events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            plan=next(event['plan'] for event in events if event.get('type')=='result')
            assert plan['requirement']['travelers']==1 and len(plan['itinerary'])==3
            rows.append({'check':'complete plan preserves confirmed solo traveler','passed':True,'elapsed_s':round(perf_counter()-started,2),
                         'days':len(plan['itinerary']),'travelers':1,'data_mode':plan.get('data_mode'),'verification':plan.get('verification')})
            attached=await client.put('/api/v1/conversations/'+id+'/workspace/plan',json={'trip_id':plan['trip_id']})
            attached.raise_for_status()
            restored=(await client.get('/api/v1/conversations/'+id+'/workspace')).json()
            exported=await client.get('/api/v1/conversations/'+id+'/workspace/export')
            assert restored['plan']['requirement']['travelers']==1 and restored['plan_feedback']
            assert exported.status_code==200 and '1人' in exported.text and '10000.00' in exported.text
            rows.append({'check':'plan attach, completion feedback, restore and export','passed':True})
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
                    rows.append({'check':'cleanup uniquely marked plan','removed':len(records),'passed':True})
            Path('logs/resilience-audit-2026-11-10-public3.json').write_text(json.dumps({'tested_at':datetime.now(timezone.utc).isoformat(),'checks':rows},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(rows),'all_passed':all(row['passed'] for row in rows),'plan':[row for row in rows if 'elapsed_s' in row]},ensure_ascii=True))


if __name__=='__main__':asyncio.run(main())
