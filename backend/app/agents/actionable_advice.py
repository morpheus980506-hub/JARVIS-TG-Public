"""Evidence-backed itinerary follow-ups, without creating orders or saved plans."""
import asyncio
import json
import re
from datetime import date,timedelta
from urllib.parse import parse_qs,urlsplit

from app.agents.destination import needs_city
from app.agents.dining import dining_constraints,markdown,safe_url
from app.schemas.domain import SourceFact
from app.agents.intake_policy import active_epoch
from app.agents.recommendation_checks import hotel_constraints, hotel_matches, indoor_only, indoor_venue


def wants_actionable_itinerary(messages):
    messages=active_epoch(messages)
    users=[message.content for message in messages if message.role=='user']
    if len(users)<2:return False
    latest=users[-1]
    asks=re.search(r'安排|排好|排一下|细化|详细|具体|落地|重排|展开|plan|itinerary|details',latest,re.I)
    scope=re.search(r'路线|行程|每天|时间点|吃住|店面|itinerary|schedule',latest,re.I)
    previous='\n'.join(message.content for message in messages[-5:-1] if message.role=='assistant')
    refine=re.fullmatch(r'(?:再|全部|都|更)?(?:详细|细化|具体|细)(?:一点|些|点|一下)?(?:吧|哈|啊)?[！!。?？ ]*',latest)
    return bool(asks and scope or refine and re.search(r'(?mi)^(?:#{1,4}\s*)?(?:D\d|Day\s*\d|第.*天)|行程',previous))


def position(fact):
    try:
        url=urlsplit(fact.source_url)
        if url.hostname!='uri.amap.com':return None
        lng,lat=map(float,parse_qs(url.query)['position'][0].split(','))
        return (lng,lat) if -180<=lng<=180 and -85<=lat<=85 else None
    except (ValueError,KeyError,IndexError):return None


def real_facts(values):
    return [fact for fact in values if isinstance(fact,SourceFact) and not fact.is_mock and fact.name and safe_url(fact.source_url)]


def quality_places(values):
    seen=set();result=[]
    for fact in real_facts(values):
        rating=re.search(r'高德评分[：:]\s*([0-9.]+)',fact.value)
        if rating and float(rating[1])<3.5:continue
        if fact.name not in seen:
            seen.add(fact.name);result.append(fact)
    return result


def specific_hotel(item,city):
    title=item.get('title') or ''
    return bool(city in title and safe_url(item.get('url') or '') and not re.search(r'通兑|房券|住宿券|兑换券|全国|\d+\+?\s*[家店]',title))


def visit_slot(fact,start):
    minutes=45 if re.search(r'旧址|洋行|教堂|故居',fact.name) else 120 if '博物馆' in fact.name else 90 if re.search(r'大街|步行街|老街',fact.name) else 60
    hour,minute=map(int,start.split(':'));end=hour*60+minute+minutes
    return f'{start}–{end//60:02d}:{end%60:02d}'


async def collect_advice_evidence(engine,messages,facts,emit):
    city=facts.get('destination')
    result={'city':city,'places':[],'restaurants':[],'hotels':[],'transport':[],'route':None,'gaps':[]}
    if not city or needs_city(city):return result
    amap=getattr(engine.tool_gateway,'amap',None)
    travel=getattr(engine,'travel_gateway',None)
    user_text = '\n'.join(message.content for message in messages if message.role == 'user')
    constraints = hotel_constraints(user_text)
    indoors = indoor_only(user_text)
    result['strict_candidates'] = indoors or bool(re.search(
        r'每晚|一晚|电梯|双床|无障碍|停车|宠物|per night|elevator', ' '.join(constraints), re.I,
    ))
    async def bounded(call,default,timeout=8):
        try:return await asyncio.wait_for(call,timeout=timeout)
        except Exception:return default
    async def map_lookups():
        if not amap or not hasattr(amap,'search_poi'):
            result['gaps'].append('地图地点查询未配置');return
        await emit(stage='advice_places',status='RUNNING',message=f'正在查询{city}的景点、餐厅和住宿地点。')
        context='\n'.join(message.content for message in messages[-5:])
        area=re.findall(r'([\u4e00-\u9fff]{2,12}?(?:步行街|大街|老街|广场|商圈|街区))',context)
        anchor=None;locations=[]
        if area:
            name=re.sub(r'^(?:可以|建议|酒店|住宿|可选|推荐|上午|下午|晚间|晚上|步行|抵达后|顺路|游览|参观|位于|选|在|到|去|逛|沿|住)+','',area[-1])
            locations=real_facts(await bounded(amap.search_poi(name,city,max_results=1),[]))
            anchor=position(locations[0]) if locations else None
        kwargs={'location':anchor} if anchor else {}
        keywords = '博物馆|美术馆|科技馆|展览馆' if indoors else '博物馆|教堂|公园'
        places=quality_places(locations+await bounded(amap.search_poi(keywords,city,max_results=5,**kwargs),[]))
        if indoors:
            places = [fact for fact in places if indoor_venue(fact.name)]
        result['places']=places
        if not anchor and places:anchor=position(places[0])
        kwargs={'location':anchor} if anchor else {}
        banned,diet,_=dining_constraints(messages)
        food,hotels=await asyncio.gather(
            bounded(amap.search_poi(diet or '餐厅',city,max_results=4,types='050000',**kwargs),[]),
            bounded(amap.search_poi('酒店',city,max_results=3,**kwargs),[]))
        result['restaurants']=[fact for fact in quality_places(food) if not any(item in fact.name for item in banned) and (
            not diet or re.search('素|vegetarian|vegan' if re.search(r'素|vegetarian|vegan',diet,re.I) else '清真|halal',fact.name+' '+fact.value,re.I))][:3]
        result['hotels']=[{'name':fact.name,'value':fact.value,'url':fact.source_url,'kind':'地图住宿地点，未查询房态及报价'}
                          for fact in quality_places(hotels)
                          if hotel_matches({'title': fact.name, 'url': fact.source_url}, constraints)][:2]
        if len(places)>1 and hasattr(amap,'route'):
            start,end=position(places[0]),position(places[1])
            if start and end:
                route=await bounded(amap.route(','.join(map(str,start)),','.join(map(str,end)),'walking'),{})
                paths=route.get('route',{}).get('paths') or []
                if paths:
                    path=paths[0]
                    try:
                        minutes=round(float(path.get('cost',{}).get('duration',path.get('duration')))/60)
                        meters=round(float(path['distance']))
                        if minutes>=0 and meters>=0:result['route']={'from':places[0].name,'to':places[1].name,'walking_minutes':minutes,'distance_m':meters}
                    except (TypeError,ValueError,OverflowError,KeyError):pass
        await emit(stage='advice_places',status='SUCCESS' if places or result['restaurants'] or result['hotels'] else 'WARNING',message=f"地点查询完成：{len(places)}处游玩候选、{len(result['restaurants'])}家餐厅、{len(result['hotels'])}处住宿地点。")
    async def platform_hotels():
        if not travel or not facts.get('start_date') or not facts.get('days') or facts['days']<2:return
        try:providers=[row['id'] for row in travel.status() if row['configured'] and row['client_installed']]
        except (AttributeError,KeyError,TypeError):return
        if not providers:return
        start=date.fromisoformat(facts['start_date']);end=start+timedelta(days=facts['days']-1)
        await emit(stage='advice_hotels',status='RUNNING',message='正在查询对应入住日期的酒店候选。')
        query=f'仅查询，不预订不支付：{city}酒店，{start}入住、{end}退房，{facts.get("travelers") or 1}人。返回具体酒店名和平台链接。'
        if constraints:
            query += ' 住宿条件：' + '；'.join(constraints) + '。请提供每晚价格及设施依据。'
        for provider in providers[:1]:
            response=await bounded(travel.search(provider,city,query),{})
            items=[item for item in response.get('items',[]) if specific_hotel(item,city) and hotel_matches(item, constraints)]
            if response.get('items') and not items:result['gaps'].append('酒店平台返回的商品未能核实为目的地具体酒店，未作为入住推荐')
            if items:
                result['platform_hotels']=[{'name':item['title'],'value':item.get('price_text') or '价格需在平台确认','url':item['url'],'kind':f'{provider}查询候选，位置与房态仍需平台确认'} for item in items[:2]]
        await emit(stage='advice_hotels',status='SUCCESS' if result.get('platform_hotels') else 'WARNING',message='酒店候选查询完成。' if result.get('platform_hotels') else '酒店平台本次未返回可用候选，住宿地点会与实时房态分开标注。')
    async def intercity():
        if not all(facts.get(key) for key in ['origin','destination','start_date']) or not hasattr(engine.tool_gateway,'transport'):return
        await emit(stage='advice_transport',status='RUNNING',message='正在查询对应日期的往返城际班次，不会下单。')
        async def lookup(origin,destination,day,key):
            # Avoid waiting on rail discovery before searching flights. This is a
            # flight candidate, not a claim that other transport is unavailable.
            rail_requested=bool(re.search(r'高铁|火车|铁路|train|rail','\n'.join(message.content for message in messages if message.role=='user'),re.I))
            if rail_requested and hasattr(engine.tool_gateway, 'trains'):
                options=await bounded(engine.tool_gateway.trains(origin,destination,day),[],timeout=12)
            elif hasattr(engine.tool_gateway,'flights') and not rail_requested:
                options=await bounded(engine.tool_gateway.flights(origin,destination,day),[],timeout=12)
            else:
                options,mode=await bounded(engine.tool_gateway.transport(origin,destination,day,False),([], 'unavailable'),timeout=12)
                if mode!='real':options=[]
            result[key]=[item.model_dump(mode='json') for item in sorted(options,key=lambda item:item.duration_minutes if item.duration_minutes is not None else 10**9) if not item.is_mock and item.departure_time.startswith(day) and (not rail_requested or item.mode=='train')][:3]
        end=date.fromisoformat(facts['start_date'])+timedelta(days=(facts.get('days') or 3)-1)
        await asyncio.gather(lookup(facts['origin'],city,facts['start_date'],'transport'),lookup(city,facts['origin'],end.isoformat(),'return_transport'))
        count=len(result['transport'])+len(result.get('return_transport',[]))
        await emit(stage='advice_transport',status='SUCCESS' if count else 'WARNING',message=f'取得{count}条往返班次候选，余票与价格仍需确认。' if count else '本次未取得可用往返班次，保留其他地点查询结果。')
    try:await asyncio.wait_for(asyncio.gather(map_lookups(),platform_hotels(),intercity()),timeout=14)
    except TimeoutError:result['gaps'].append('本次查询超时，保留已取得的候选')
    for key,label in [('places','游玩地点'),('restaurants','匹配餐厅'),('hotels','住宿地点'),('transport','城际班次')]:
        if not result.get(key) and not (key=='hotels' and result.get('platform_hotels')):result['gaps'].append(label+'本次未取得可用结果')
    return result


def evidence_context(evidence):
    return json.dumps({**evidence,**{key:[{'name':fact.name,'value':fact.value,'url':fact.source_url} for fact in evidence[key]] for key in ['places','restaurants']}},ensure_ascii=False)


def evidence_footer(evidence,reply,language='zh'):
    en=language=='en';lines=[]
    groups=[('用餐候选','Dining candidates',evidence['restaurants']),('住宿候选','Stay candidates',evidence.get('platform_hotels') or evidence['hotels'])]
    for zh,english,items in groups:
        missing=[]
        for item in items[:2]:
            name=item.name if isinstance(item,SourceFact) else item['name']
            url=item.source_url if isinstance(item,SourceFact) else item['url']
            detail=item.value if isinstance(item,SourceFact) else item['value']+'；'+item['kind']
            if f'[{markdown(name)}](' not in reply:missing.append(f'- [{markdown(name)}]({url.replace("(","%28").replace(")","%29")}) · {markdown(detail)}')
        if missing:lines.extend(['',f"### {english if en else zh}",*missing])
    return '\n'.join(lines)


def fallback_itinerary(evidence,facts,language='zh'):
    en=language=='en';places=evidence['places'];food=evidence['restaurants']
    hotels=evidence['hotels'] or evidence.get('platform_hotels',[])
    def link(item):
        name=item.name if isinstance(item,SourceFact) else item['name']
        url=item.source_url if isinstance(item,SourceFact) else item['url']
        return f'[{markdown(name)}]({url.replace("(","%28").replace(")","%29")})'
    if not (places or food or hotels):
        return ('The lookups returned no usable place or hotel candidates. ' if en else '本次查询没有取得可用的地点或酒店候选。')+'\n'+'\n'.join('- '+gap for gap in evidence['gaps'])
    days=facts.get('days') or 3
    lines=['Suggested times; opening hours and reservations still need confirmation.' if en else '以下时间是建议时段，地点来自本次查询；营业和预约仍需确认。','']
    options=sorted(evidence['transport'],key=lambda item:item.get('duration_minutes') if item.get('duration_minutes') is not None else 10**9)
    for number in range(1,min(days,60)+1):
        dated=(date.fromisoformat(facts['start_date'])+timedelta(days=number-1)).isoformat() if facts.get('start_date') else ''
        lines.append(f"### {'Day' if en else 'D'}{number} {dated} · "+(('Arrival' if en else '抵达与入住') if number==1 else ('Return' if en else '退房与返程') if number==days else ('Local visits' if en else '游玩与用餐')))
        if number==1:
            if options:
                option=options[0]
                lines.append(f"- {'Outbound candidate' if en else '去程候选'}：{markdown(option['service_number'])}，{markdown(option['departure_time'])} → {markdown(option['arrival_time'])}（{'not booked' if en else '未预订'}）")
            else:lines.append('- '+('Arrival time is unconfirmed; keep the arrival day flexible.' if en else '去程班次本次未查到，抵达时间先留空，不承诺下午一定能游玩。'))
            if hotels:lines.append(f"- {'Stay candidate' if en else '住宿地点候选'}：{link(hotels[0])}；{markdown(hotels[0]['value'])}（{markdown(hotels[0]['kind'])}）")
            else:lines.append('- '+('No stay candidate with sufficient evidence was found.' if en else '本次没有查到资料足以确认符合条件的住宿候选。'))
            if food:lines.append(f"- {'After arrival, meal candidate' if en else '安顿后用餐备选'}：{link(food[0])}；{markdown(food[0].value)}")
        elif number==days:
            lines.append('- '+('Leave time for check-out and luggage.' if en else '办理退房、寄存或取行李，按返程出发时间安排接送。'))
            returning=evidence.get('return_transport') or []
            if returning:
                option=returning[0]
                lines.append(f"- {'Return candidate' if en else '返程候选'}：{markdown(option['service_number'])}，{markdown(option['departure_time'])} → {markdown(option['arrival_time'])}（{'not booked' if en else '未预订，余票和价格需确认'}）")
            else:lines.append('- '+('No usable return service was returned; keep the day flexible.' if en else '返程查询未取得可用班次，先留出弹性时间，不填入虚构航班。'))
        else:
            selected=places[(number-2)*2:(number-1)*2]
            if selected:lines.append(f"- {visit_slot(selected[0],'09:30')}：{link(selected[0])}；{markdown(selected[0].value)}")
            else:lines.append('- '+('No additional verified place candidates for this day yet.' if en else '这一天尚无更多匹配的具体地点，不重复前一天凑数。'))
            if food:
                meal=food[(number-1)%len(food)]
                lines.append(f"- 11:30–13:00：{link(meal)}；{markdown(meal.value)}")
            if len(selected)>1:lines.append(f"- {visit_slot(selected[1],'14:00')}：{link(selected[1])}；{markdown(selected[1].value)}"+('；先按外观参观安排，能否入内需确认。' if not en and re.search(r'旧址|洋行|故居',selected[1].name) else ''))
            if number==2 and evidence['route']:
                route=evidence['route']
                lines.append(f"- {'Walking lookup' if en else '两处地点之间'}：{route['distance_m']}m / {route['walking_minutes']}min"+('；步行较长，建议改乘交通，车程未核验。' if route['walking_minutes']>30 and not en else '。' if not en else '.'))
            elif len(selected)>1:lines.append('- '+('Transfer time has not been verified; compare routes before fixing the schedule.' if en else '这段交通用时未核验，先比较路线，再固定出发时间。'))
            if len(food)>2:
                meal=food[number%len(food)]
                lines.append(f"- 18:00–19:00：{link(meal)}；{markdown(meal.value)}")
            if hotels:lines.append('- '+('Keep the same accommodation for this short trip.' if en else '住宿延续前一晚的地点，短途旅行不额外换酒店。'))
        lines.append('')
    lines.extend(['Only the provided candidates and links were used. Hotel inventory, menu prices and return transport remain unconfirmed.' if en else '住宿地点不代表可订房态；菜单价格和返程交通仍未确认。已查到的具体候选见上方链接。'])
    return '\n'.join(lines)


async def grounded_advice_reply(model,prompt,evidence,facts,language,token_callback,emit,max_tokens,*,deep_thinking=False):
    await emit(stage='advisor_model',status='RUNNING',message='正在把具体地点、用餐和住宿候选排进日程。')
    reply = ''
    if not evidence.get('strict_candidates'):
        try:
            answer = (
                await model.generate_deep(prompt, max_tokens=max_tokens) if deep_thinking
                else await model.generate_fast(prompt, temperature=0.2, max_tokens=max_tokens)
            )
            reply=(answer.content or '').strip()
        except Exception:
            pass
    names=[fact.name for fact in evidence['places']+evidence['restaurants']]+[item['name'] for item in evidence['hotels']+evidence.get('platform_hotels',[])]
    refusal=re.search(r'无法联网|不能联网|没有联网|我无法.*(?:店名|酒店名)|要不要.*(?:细化|时间)|需要我.*(?:时间点|细化)|cannot access the internet',reply,re.I)
    named_food=not evidence['restaurants'] or any(fact.name in reply for fact in evidence['restaurants'])
    stays=evidence.get('platform_hotels') or evidence['hotels']
    named_stay=not stays or any(item['name'] in reply for item in stays)
    # Flight departure times alone do not make the daily activities timed.
    sections=re.split(r'(?m)^#{1,4}\s*(?:D|Day)\s*\d+\b',reply,flags=re.I)
    timed=bool(re.search(r'\b\d{1,2}:\d{2}\s*[–—\-~至]\s*\d{1,2}:\d{2}',sections[2] if len(sections)>3 else reply))
    if not reply or refusal or names and not any(name in reply for name in names) or not named_food or not named_stay or not timed:
        reply=fallback_itinerary(evidence,facts,language)
    reply+=evidence_footer(evidence,reply,language)
    if token_callback:await token_callback(reply)
    await emit(stage='advisor_model',status='SUCCESS',message='具体候选与建议日程已整理；未取得的资料已单独说明。')
    return reply
