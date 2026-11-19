"""Resolve read-only supplier queries without inventing locations or booking anything."""
import asyncio
import json
import re
from datetime import datetime, timezone, timedelta, date
from pydantic import BaseModel, Field
from typing import Literal
from app.agents.intake import format_trip_memory, _city_answer
from app.tools.providers.travel_search import TravelSearchError
from app.agents.dining import is_dining_request
from app.agents.message_history import model_history
from app.agents.intake_policy import active_epoch,split_clauses,trip_control,undo_requested,supplier_prompt,supplier_request as explicit_supplier_search
from app.agents.stay_dates import stay_is_grounded
from app.agents.actionable_advice import wants_actionable_itinerary


class TravelIntent(BaseModel):
    action:Literal['search','ride','clarify','general']='general'
    city:str|None=Field(default=None,max_length=80)
    origin:str|None=Field(default=None,max_length=160)
    destination:str|None=Field(default=None,max_length=160)
    category:Literal['hotel','transport','tickets','other']='hotel'
    providers:list[Literal['fliggy','meituan']]=Field(default_factory=lambda:['fliggy','meituan'])
    check_in:date|None=None
    check_out:date|None=None
    question:str|None=Field(default=None,max_length=300)


def wants_supplier_search(messages):
    if not messages:return False
    current=active_epoch(messages)
    latest=current[-1].content
    clauses=split_clauses(latest)
    positive=[clause for clause in clauses if not re.search(r'不查|不用查|不要查|先不查|取消.*查询|停止.*查|stop searching|stop the search',clause,re.I)]
    if not positive:return False
    latest='，'.join(positive)
    if explicit_supplier_search(latest):return True
    if trip_control(latest) or undo_requested(latest):return False
    roots=[message.content for message in current[-9:-1] if message.role=='user' and explicit_supplier_search(message.content)]
    if not roots:return False
    previous=current[-2].content if len(current)>1 and current[-2].role=='assistant' else ''
    if re.search(r'天气|weather|景点|餐厅|航班|出发地|目的地|人数|天数|总预算',latest,re.I):return False
    clarify=supplier_prompt(previous)
    if clarify:
        return bool(_city_answer(latest) or re.search(r'\d|明天|后天|今天|今晚|晚|tomorrow|today|night|没定|不知道',latest,re.I)) and not bool(re.fullmatch(r'你好|hi|hello',latest,re.I))
    retry=re.search(r'便宜|贵了|换一家|重新查|重试|cheaper|retry',latest,re.I)
    return bool(retry and re.search(r'酒店|hotel|美团|飞猪|Fliggy|Meituan',previous,re.I))


async def supplier_reply(orchestrator,messages,language='zh',progress=None):
    if wants_actionable_itinerary(messages):return None
    if is_dining_request(messages):return None
    if not wants_supplier_search(messages):return None
    en=language=='en'
    facts,memory=format_trip_memory(messages)
    current_messages=active_epoch(messages)
    today=datetime.now(timezone(timedelta(hours=8))).date()
    prompt=(f'你是只读旅行查询意图解析器。北京时间今天是{today}。只输出JSON。'
      '格式：{"action":"search|ride|clarify|general","city":null,"origin":null,"destination":null,'
      '"category":"hotel|transport|tickets|other","providers":["fliggy","meituan"],"check_in":null,"check_out":null,"question":null}。'
      '只根据用户明确提供的信息，结合上下文逐次应用最新修改，不补造城市、日期。'
      '地点保留用户使用的语言和写法，例如用户写Hangzhou时city也写Hangzhou，不翻译成未提及的城市名。'
      '酒店的check_in/check_out用ISO日期，只知道入住+晚数时可计算退房。'
      '普通攻略/住宿区域建议为general，不强行查商品。打车/滴滴查询为ride，必须保留具体起终点，city为出发城市。'
      '明确只查一家时providers只填该家，否则查两家。缺必要信息clarify，最多问一个问题。'+memory)
    try:
        answer=await orchestrator.model_gateway.generate_fast([{'role':'system','content':prompt},*model_history(current_messages)],temperature=0,max_tokens=500)
        text=answer.content.strip()
        if text.startswith('```'):text=re.sub(r'^```(?:json)?\s*|\s*```$','',text)
        intent=TravelIntent.model_validate(json.loads(text))
        user_text='\n'.join(m.content for m in current_messages if m.role=='user')+'\n'+'\n'.join(str(facts.get(key) or '') for key in ['origin','destination'])
        for place in [intent.city,intent.origin,intent.destination]:
            if place and place not in user_text and place.rstrip('市') not in user_text:raise ValueError('Ungrounded place')
    except Exception:
        return {'reply':'Please give the city, dates and what you want to search.' if en else '你想查哪个城市、哪天的酒店或出行？告诉我后我直接查询。','travel_results':[]}
    if intent.action=='general':return None
    if not intent.city:
        return {'reply':'Which city should I search?' if en else '你想查哪个城市？','travel_results':[]}
    if intent.action=='ride':
        if not intent.origin or not intent.destination:
            return {'reply':'Where are your pickup and drop-off points?' if en else '你准备在哪里上车、到哪里下车？','travel_results':[]}
        return {'reply':'Confirm the pickup and drop-off choices in DiDi to get estimates.' if en else '我已填好滴滴查询条件，请确认上下车点后查看车型和预估价。',
                'ride_request':{'city':intent.city,'origin':intent.origin,'destination':intent.destination},'travel_results':[]}
    if intent.category=='hotel' and (not intent.check_in or not intent.check_out or intent.check_in<today or intent.check_out<=intent.check_in or not stay_is_grounded(intent.check_in,intent.check_out,current_messages,facts)):
        return {'reply':'What are your check-in and check-out dates?' if en else '你准备哪天入住、哪天退房？我确认日期后查实时酒店候选。','travel_results':[]}
    if intent.action=='clarify':
        return {'reply':intent.question or ('What else should I search for?' if en else '还需要补充哪些查询条件？'),'travel_results':[]}
    gateway=orchestrator.travel_gateway;gateway.settings=orchestrator.settings
    root=next((message.content for message in reversed(current_messages[:-1]) if message.role=='user' and explicit_supplier_search(message.content)),'')
    latest = messages[-1].content
    provider_context = latest if explicit_supplier_search(latest) else root
    explicit_providers = [
        provider for provider, pattern in (('fliggy', r'飞猪|\bfliggy\b'), ('meituan', r'美团|\bmeituan\b'))
        if re.search(pattern, provider_context, re.I)
        and not re.search(rf'(?:不用|不查|别用|排除|exclude\s+)(?:{pattern})', provider_context, re.I)
    ]
    providers = explicit_providers or intent.providers
    available=[name for name in dict.fromkeys(providers) if getattr(gateway.settings, 'fliggy_api_key' if name=='fliggy' else 'meituan_ht_token')]
    if not available:
        if len(explicit_providers) == 1:
            label = {'fliggy': ('飞猪', 'Fliggy'), 'meituan': ('美团', 'Meituan')}[explicit_providers[0]][int(en)]
            reply = f'Configure {label} in Settings → API connections first.' if en else f'请先在「设置与服务 → API 接口」配置{label}。'
        else:
            reply = 'Configure Fliggy or Meituan in Settings → API connections first.' if en else '请先在「设置与服务 → API 接口」配置飞猪或美团。'
        return {'reply':reply,'travel_results':[]}
    category={'hotel':'酒店','transport':'交通','tickets':'门票','other':'旅行候选'}[intent.category]
    query=f'查询{intent.city}的{category}。\n'+(root+'\n' if root else '')+messages[-1].content+'\n'+memory
    if intent.check_in:query+=f'\n入住：{intent.check_in}；退房：{intent.check_out}'
    query+='\n仅查询，不创建、取消订单，不支付。'
    async def search(name):
        if progress:await progress({'stage':'supplier_'+name,'status':'RUNNING','message':f'正在查询{name}的真实候选…'})
        try:
            result=await gateway.search(name,intent.city,query)
            result['category']=intent.category
            if progress:await progress({'stage':'supplier_'+name,'status':'SUCCESS','message':f'{name}查询已返回','travel_result':result})
            return result
        except TravelSearchError as error:
            if progress:await progress({'stage':'supplier_'+name,'status':'WARNING','message':f'{name}暂未返回结果'})
            return {'provider':name,'error':error.code,'items':[],'text':'','notice':''}
    results=await asyncio.gather(*[search(name) for name in available])
    summary=[]
    for result in results:
        label=('Fliggy' if result['provider']=='fliggy' else 'Meituan') if en else ('飞猪' if result['provider']=='fliggy' else '美团')
        success=(f"{len(result['items'])} candidates returned." if result['items'] else 'Provider response received.') if en else (f"返回{len(result['items'])}条候选。" if result['items'] else '平台答复已返回。')
        summary.append(f"- {label}："+(('查询未完成，可单独重试。' if not en else 'Search unavailable; retry separately.') if result.get('error') else success))
    return {'reply':'\n'.join(summary)+'\n\n'+('Select a candidate below to add an estimated cost to this conversation. Booking is completed on the provider’s page.' if en else '可在下方选择候选并填写费用估算，加入当前对话；预订仍在平台确认。'), 'travel_results':results}
