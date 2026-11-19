"""Live checks against the local server, using only disposable conversations."""
import asyncio
import json
from pathlib import Path
import httpx
from app.core.version import VERSION

BASE='从温州去哈尔滨玩，2026-12-01出发，3天，1人，预算10000元，希望美食'

async def main():
    results=[];id=None
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=20) as client:
        try:
            version=(await client.get('/openapi.json')).json()['info']['version']
            assert version==VERSION
            results.append({'check':'public version','version':version,'passed':True})
            message={'role':'user','content':BASE}
            created=(await client.post('/api/v1/conversations',json={'title':'QA-public-disposable','message':message})).json();id=created['id']
            saved=(await client.get('/api/v1/conversations/'+id)).json()
            assert saved['messages'][0]['content']==BASE
            results.append({'check':'initial message saved before reply connection','passed':True})
            replies=await asyncio.gather(*(client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[message]}) for _ in range(2)))
            statuses=sorted(response.status_code for response in replies)
            assert statuses==[200,409],statuses
            saved=(await client.get('/api/v1/conversations/'+id)).json()
            assert len(saved['messages'])==2 and saved['ready']
            results.append({'check':'simultaneous duplicate submissions','http':statuses,'messages':len(saved['messages']),'passed':True})
            stale=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[message]})
            assert stale.status_code==409
            results.append({'check':'stale tab rejected without history loss','http':409,'passed':True})
            history=saved['messages']+[{'role':'user','content':'你好'}]
            greeting=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':history})
            assert greeting.status_code==200 and greeting.json()['ready'] and greeting.json()['trip_request']['destination']=='哈尔滨'
            results.append({'check':'smalltalk retains trip details and generation entry','passed':True})
            saved=(await client.get('/api/v1/conversations/'+id)).json()
            changed=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':saved['messages']+[{'role':'user','content':'再多玩两天，2人，人均预算2000元'}]})
            request=changed.json()['trip_request']
            assert request['days']==5 and request['travelers']==2 and request['budget_cny']==4000
            results.append({'check':'relative day edit and per-person budget','days':5,'travelers':2,'budget_cny':4000,'passed':True})
        finally:
            if id:
                deleted=await client.delete('/api/v1/conversations/'+id)
                assert deleted.status_code==204
                missing=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':'你好'}]})
                assert missing.status_code==404
                results.append({'check':'own test conversation cleaned; deleted conversation refused','passed':True})
            Path(f'logs/public-release-checks-2026-11-10-{VERSION}.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=True))

if __name__=='__main__':asyncio.run(main())
