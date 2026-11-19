"""Adversarial user questions; only disposable conversations, no orders/settings."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
from app.agents.intake import collect_trip_intake, classify_conversation_mode
from app.schemas.domain import ChatMessage
from app.core.version import VERSION

BASE='从温州去哈尔滨玩，2026-12-01出发，3天，2人，总预算10000元，希望美食'
CASES=[
 ('假设并非修改','如果改去成都会不会更贵？先别改','destination','哈尔滨'),
 ('引用朋友并非修改','朋友说“改去成都吧”，但我还是去哈尔滨','destination','哈尔滨'),
 ('目的地反悔','不去成都，还是哈尔滨','destination','哈尔滨'),
 ('多目的地','改去哈尔滨和长春，两个都要','destination',None),
 ('目的地二选一','改去成都或者重庆','destination',None),
 ('取消整趟旅行','这趟旅行取消了，别再规划了','ready',False),
 ('重新开始','之前的条件都作废，我们重新开始','ready',False),
 ('改聊另一趟','另外一趟我想去上海，先别改这趟','destination','哈尔滨'),
 ('城市同名歧义','改去吉林','ready',False),
 ('不是出发地','不是从温州出发了，出发地还没定','origin',None),
 ('出发到达对调','把出发地和目的地交换一下','origin','哈尔滨'),
 ('明确先不改预算','预算先别改，还是10000元','budget_cny',10000),
 ('预算上限','预算最多8000，能压到6000更好','budget_cny',8000),
 ('预算区间','预算改成5000到8000元','budget_cny',None),
 ('预算否定','不是5000，是8000元总预算','budget_cny',8000),
 ('预算含千分位','总预算改成12,000元','budget_cny',12000),
 ('人民币缩写','总预算改成8k人民币','budget_cny',8000),
 ('预算不含交通','总预算6000元，不含往返机票','budget_scope','clarify'),
 ('中文人均预算','人均两千元','budget_cny',4000),
 ('取消预算上限','预算不限了','budget_cny',None),
 ('人数减去一人','少一个人，就我自己','travelers',1),
 ('人数含婴儿','两个大人，一个小孩，还有一个婴儿','travelers',4),
 ('不是人数的数字','不是3个人，还是2个人','travelers',2),
 ('天数不是两天','不是两天，是五天','days',5),
 ('三晚四天','改成四天三晚','days',4),
 ('范围天数','玩三到五天，还没定','days',None),
 ('无效日期','出发日期改成2027-02-30','start_date',None),
 ('日期区间','12月1日或者12月5日出发，还没定','start_date',None),
 ('退回过去日期','日期改成2020年1月1日','ready',False),
 ('改变月不重复日','改到明年1月，具体哪天没定','start_date',None),
 ('只有回程日期','12月8日回来，出发日期先不变','start_date','2026-12-01'),
 ('日期不是修改','12月5日会不会下雪？日期先不改','start_date','2026-12-01'),
 ('否定天数修改','别改成五天了，还是三天','days',3),
 ('仅餐厅价格','餐厅人均200元以内','budget_cny',10000),
 ('英文只改目的地','Change the destination to Chengdu, keep everything else.','destination','Chengdu'),
 ('英文改天数','Make it 5 days instead.','days',5),
 ('英文改预算','Change the total budget to CNY 8000.','budget_cny',8000),
 ('英文取消','Cancel this trip. Do not plan it.','ready',False),
 ('全角数字','改成５天，３人，总预算８０００元','days',5),
 ('仅表情','👍','destination','哈尔滨'),
 ('普通询问误识别路线','行，那你说说现在到底是什么条件？','origin','温州'),
 ('不相关地名','我朋友住成都，他不跟我们去','destination','哈尔滨'),
 ('只问备选地','上海有什么好吃的？不要改我的行程','destination','哈尔滨'),
 ('否定新出发地','不要从杭州出发，还是温州','origin','温州'),
 ('改回原目的地','改回哈尔滨，其他不变','destination','哈尔滨'),
 ('不确定目的地','目的地还没定','destination',None),
 ('否定人数更改','别增加人数了，还是2个人','travelers',2),
 ('取消儿童同行','孩子不去了，就两个大人','travelers',2),
 ('中文家人人数','我和爸妈三个人','travelers',3),
 ('含小数人数','人数改成2.5人','travelers',None),
 ('负数人数','人数改成-2人','travelers',None),
 ('取消偏好','不想以美食为主了，主要看博物馆','preference_removed','美食'),
 ('不去景点不是改城','不去中央大街了，哈尔滨照去','destination','哈尔滨'),
 ('预算带货币符号','总预算改成￥8000','budget_cny',8000),
 ('预算后置数字','8000元，总预算就这么多','budget_cny',8000),
 ('负数预算','预算改成-100元','budget_cny',None),
 ('零元明确修改','预算改成0元','ready',False),
 ('小数天数','改成2.5天','days',None),
 ('周数表达','改成一周','days',7),
 ('日期带回程','12月2日出发，12月6日回来','start_date','2026-12-02'),
 ('跨年模糊时间','改到春节，日期你查一下','start_date',None),
 ('跨语言否定更改','Do not change the budget to 5000. Keep CNY 10000.','budget_cny',10000),
 ('英文人数增量','Add one more traveler.','travelers',3),
 ('英文天数减量','One day shorter, please.','days',2),
 ('英文起终点交换','Swap the origin and destination.','origin','哈尔滨'),
 ('预算另一场景','我手机预算3000元，旅游预算不变','budget_cny',10000),
 ('机票价格非总预算','机票大概1500元一个人，旅行总预算不变','budget_cny',10000),
 ('日期当景点历史','博物馆是12月5日开馆的，行程不改','start_date','2026-12-01'),
 ('取消不等于删记录','不去了，保留聊天记录就好','ready',False),
 ('英文后补起点','Change the departure city to Hangzhou.','origin','Hangzhou'),
]

def offline():
    rows=[]
    for name,text,field,expected in CASES:
        messages=[ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='需求已记录。'),ChatMessage(role='user',content=text)]
        try:
            result=collect_trip_intake(messages,requirements_only=True)
            actual=result.ready if field=='ready' else result.collected.get(field)
            if field=='budget_scope':
                actual='clarify' if not result.ready or any('机票' in item for item in result.collected.get('hard_constraints',[])) else 'unhandled'
            if field=='preference_removed':
                actual=expected if expected not in result.collected.get('preferences',[]) else 'still present'
            rows.append(dict(name=name,input=text,field=field,expected=expected,actual=actual,
                passed=actual==expected,ready=result.ready,collected=result.collected,
                mode=classify_conversation_mode(messages),reply=result.reply))
        except Exception as error:
            rows.append(dict(name=name,input=text,passed=False,error=type(error).__name__))
    return rows

async def live():
    rows=[];ids=[]
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=55) as client:
        async def create():
            r=await client.post('/api/v1/conversations',json={'title':'QA-unexpected-'+uuid4().hex[:8]})
            r.raise_for_status();id=r.json()['id'];ids.append(id);return id
        async def turn(id,text):
            detail=(await client.get('/api/v1/conversations/'+id)).json()
            started=perf_counter()
            response=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':detail['messages']+[{'role':'user','content':text}]})
            events=[json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code==200 else []
            result=next((e['intake'] for e in events if e.get('type')=='result'),{})
            row=dict(input=text,http=response.status_code,elapsed_s=round(perf_counter()-started,2),
                result=result,stages=list(dict.fromkeys(e['stage'] for e in events if e.get('stage'))),
                errors=[e.get('message') for e in events if e.get('type')=='error'])
            restored=(await client.get('/api/v1/conversations/'+id)).json()
            row['restored_ready']=restored.get('ready')
            row['restored_request']=restored.get('trip_request')
            row['state_consistent']=result.get('ready')==restored.get('ready') and result.get('trip_request')==restored.get('trip_request')
            rows.append(row);return row
        try:
            # Each scenario starts with the same known facts and uses server-restored history.
            for text in [
                '如果改去成都会不会更贵？先别改',
                '这趟旅行取消了，别再规划了',
                '之前的条件都作废，我们重新开始',
                '不是5000，是8000元总预算',
                '出发日期改成2027-02-30',
                '12月8日回来，出发日期先不变',
                '改去成都或者重庆，还没定',
                'Change the total budget to CNY 8000.',
                '总预算改成12,000元',
                '总预算改成8k人民币',
                '两个大人，一个小孩，还有一个婴儿',
                '人数改成-2人',
                '预算改成-100元',
                '改成2.5天',
                '我手机预算3000元，旅游预算不变',
                '博物馆是12月5日开馆的，行程不改',
                '改去哈尔滨和长春，两个都要',
                '不去中央大街了，哈尔滨照去',
                '不想以美食为主了，主要看博物馆',
                'Change the destination to Chengdu, keep everything else.',
            ]:
                id=await create();await turn(id,BASE);await turn(id,text)
            # Long sequence: can later clarification actually repair conflicting facts?
            id=await create()
            for text in [BASE,'不去哈尔滨了','也不去成都，目的地还没定','那就重庆吧','预算不是5000，是8000元','不是三天，改成五天','行，那你说说现在到底是什么条件？']:
                await turn(id,text)
            id=await create()
            await turn(id,BASE)
            await turn(id,'行，那你说说现在到底是什么条件？')
            restored=(await client.get('/api/v1/conversations/'+id)).json()
            rows.append(dict(kind='summary_persistence',ready=restored.get('ready'),trip_request=restored.get('trip_request')))
            # Basic form boundary checks use only the disposable chat.
            for title in ['   ','😀'*161,'<script>alert(1)</script>','短标题']:
                response=await client.patch('/api/v1/conversations/'+id,json={'title':title})
                rows.append(dict(kind='rename',input=title,http=response.status_code))
        finally:
            for id in ids:
                response=await client.delete('/api/v1/conversations/'+id)
                rows.append(dict(kind='cleanup',http=response.status_code,passed=response.status_code==204))
    return rows

async def main():
    path=Path(f'logs/unexpected-audit-2026-11-10-{VERSION}.json' if '--current' in sys.argv else 'logs/unexpected-audit-2026-11-10-fixed.json' if '--fixed' in sys.argv else 'logs/unexpected-audit-2026-11-10.json')
    data={'tested_at':datetime.now(timezone.utc).isoformat(),'offline':offline()}
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    data['live']=await live()
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'offline_total':len(data['offline']),'offline_mismatches':sum(not r['passed'] for r in data['offline']),
        'live_turns':sum('result' in r for r in data['live']),
        'cleanup_ok':all(r['passed'] for r in data['live'] if r.get('kind')=='cleanup')},ensure_ascii=True))

if __name__=='__main__':asyncio.run(main())
