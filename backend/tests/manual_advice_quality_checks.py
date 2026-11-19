"""Reproduce the screenshot request in a disposable chat; no orders or user edits."""
import asyncio
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx


async def main():
    id=None;report={}
    messages=[{'role':'user','content':'从温州去哈尔滨，2026-12-01出发，3天，1人，总预算10000元，希望美食'},
              {'role':'assistant','content':'可以在中央大街品尝当地美食，第二天参观附近景点。'},
              {'role':'user','content':'那你至少安排一下路线，店面，酒店，交通吧'}]
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=100) as client:
        try:
            created=await client.post('/api/v1/conversations',json={'title':'QA-advice-quality-'+uuid4().hex[:8]})
            created.raise_for_status();id=created.json()['id']
            start=perf_counter()
            response=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':messages})
            response.raise_for_status();events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
            result=next(event['intake'] for event in events if event.get('type')=='result')
            reply=result['reply'];elapsed=round(perf_counter()-start,2)
            report={'passed':False,'elapsed_s':elapsed,'characters':len(reply),'map_links':reply.count('https://uri.amap.com'),
                    'stages':list(dict.fromkeys(event['stage'] for event in events if event.get('stage'))),'reply':reply}
            Path('logs/advice-quality-example-2026-11-10.md').write_text('# 具体候选与日程 · 测试场景\n\n'+reply,encoding='utf-8')
            restored=(await client.get('/api/v1/conversations/'+id)).json()
            assert restored['messages'][-1]['content']==reply
            assert all(f'D{day}' in reply for day in range(1,4))
            assert reply.count('https://uri.amap.com')>=3
            assert '无法联网' not in reply and '没有联网' not in reply
            assert '需要我再补' not in reply
            assert '住宿' in reply or '酒店' in reply
            assert '09:30' in reply or '10:00' in reply
            assert '通兑' not in reply and '高德评分：2.9' not in reply
            report={'passed':True,'elapsed_s':elapsed,'characters':len(reply),'map_links':reply.count('https://uri.amap.com'),
                    'stages':list(dict.fromkeys(event['stage'] for event in events if event.get('stage'))),'reply':reply}
            Path('logs/advice-quality-example-2026-11-10.md').write_text('# 具体候选与日程 · 测试场景\n\n'+reply,encoding='utf-8')
        finally:
            if id:report['cleanup_http']=(await client.delete('/api/v1/conversations/'+id)).status_code
            Path('logs/advice-quality-checks-2026-11-10.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='reply'},ensure_ascii=True))


if __name__=='__main__':asyncio.run(main())
