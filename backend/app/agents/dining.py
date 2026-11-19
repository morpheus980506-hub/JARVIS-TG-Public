"""Read-only restaurant lookups for concrete follow-up questions."""
import asyncio
import re
from urllib.parse import urlsplit
from app.agents.destination import needs_city,normalize_place
from app.tools.providers.web_search import WEB_SEARCH_TIMEOUT


FOOD=r'餐厅|饭店|美食|吃饭|吃的|吃点|餐馆|锅包肉|铁锅炖|西餐|火锅|烧烤|饺子|素食|清真|restaurant|dining|food|vegan|vegetarian'


def is_dining_request(messages):
    latest=messages[-1].content if messages else ''
    if re.search(r'酒店|宾馆|住宿|API|MCP|接口|配置|hotel',latest,re.I):return False
    concrete=re.search(r'哪家|哪几家|店名|具体.*店|餐厅|餐馆|饭店|restaurant',latest,re.I)
    action=re.search(r'告诉|推荐|查|找|搜|给|哪家|哪几家|店名|具体|recommend|find|which|name',latest,re.I)
    context='\n'.join(message.content for message in messages[-5:])
    followup=re.search(r'换一家|换几家|不要这家|其他几家|便宜点|便宜一点|cheaper|another one',latest,re.I)
    return bool(((concrete and action) or followup) and re.search(FOOD,context,re.I))


def dining_constraints(messages):
    latest=messages[-1].content if messages else ''
    user='\n'.join(message.content for message in messages if message.role=='user')
    banned=set()
    for clause in re.split(r'[，,。；;\n]',user):
        foods=set(re.findall(r'锅包肉|铁锅炖|西餐|火锅|烧烤|饺子',clause))
        if re.search(r'不吃|不要|不想吃|避免|过敏',clause):banned.update(foods)
        elif re.search(r'可以吃|接受|改吃|恢复',clause):banned.difference_update(foods)
    diet=None
    for match in re.finditer(r'素食|纯素|清真|vegetarian|vegan|halal',user,re.I):
        prefix=user[max(0,match.start()-12):match.start()]
        diet=None if re.search(r'不(?:再|需要|用|要)?(?:坚持|限制|吃)?$|no longer\s+$',prefix,re.I) else match.group()
    refused=[]
    previous=next((message.content for message in reversed(messages[:-1]) if message.role=='assistant'),'')
    names=re.findall(r'^- \*\*(.+?)\*\*',previous,re.M)
    if not names:
        match=re.search(r'餐厅[：:]([^。\n]+)',previous)
        if match:names=[item.strip() for item in re.split(r'[、，,]',match.group(1))]
    if re.search(r'换一家|换几家|不要这家|another one|other restaurants',latest,re.I):refused=names
    else:
        refused=[name for name in names if re.search(r'不要|排除|不去',latest) and (name in latest or re.split(r'[（(]',name)[0] in latest)]
    return banned,diet,refused


def dining_city(latest,known):
    match=re.search(r'([\u4e00-\u9fff]{2,10}?)(?:的|有哪些|有什么|有啥)(?:餐厅|饭店|美食|火锅|烧烤|饺子|店)',latest)
    if match:
        city=re.sub(r'^(?:帮我|给我|推荐|找|搜|查一下|查|在|到|去)+','',match.group(1))
        description=re.search(r'当地|那里|那边|附近|这里|这边|哪里|合适|好吃|靠谱|几家|一些|特色|不错|便宜|正宗|小众|网红|地道|性价比',city)
        neighborhood=city.endswith(('大街','步行街','老街','商圈','广场','街区','区'))
        if city and not description and not neighborhood:return normalize_place(city)
    return normalize_place(known) if known else None


def markdown(value):
    return re.sub(r'([\\`*_{}\[\]<>#])',r'\\\1',str(value).replace('\n',' '))


def safe_url(value):
    try:
        url=urlsplit(value)
        return url.scheme in {'http','https'} and bool(url.hostname) and not url.username and not url.password
    except ValueError:return False


async def dining_reply(gateway,messages,destination,language,emit,*,use_web_search=True):
    en=language=='en'
    latest=messages[-1].content
    city=dining_city(latest,destination)
    if not city or needs_city(city):
        return 'Which city should I search for restaurants in?' if en else '要查哪个城市的餐厅？告诉我城市名，我直接查具体店名和位置。'
    # A short follow-up such as "哪家店" inherits the last food discussion.
    context=latest if re.search(FOOD,latest,re.I) else '\n'.join(message.content for message in messages[-5:])
    banned,diet,refused=dining_constraints(messages)
    cuisines=[item for item in dict.fromkeys(re.findall(r'锅包肉|铁锅炖|俄式西餐|西餐|火锅|烧烤|饺子|东北菜|川菜|粤菜',context)) if item not in banned][:2]
    area_match=re.search(r'(?:在|到|去|逛|推荐)([\u4e00-\u9fff]{2,10}?(?:大街|步行街|老街|商圈|广场|街区))',context)
    keywords=' '.join([area_match.group(1) if area_match else '',diet or (cuisines[0] if cuisines else '餐厅')]).strip()
    def eligible(fact):
        if fact.is_mock or not fact.name or not safe_url(fact.source_url):return False
        if any(name==fact.name or re.split(r'[（(]',name)[0] in fact.name for name in refused):return False
        if diet:
            pattern='素|vegetarian|vegan' if re.search(r'素|vegetarian|vegan',diet,re.I) else '清真|halal'
            if not re.search(pattern,fact.name+' '+fact.value,re.I):return False
        return not any(item in fact.name for item in banned)
    amap=getattr(gateway,'amap',None);web_search=getattr(gateway,'web_search',getattr(gateway,'tavily',None))
    if not use_web_search:
        web_search = None
    if not amap and not web_search:
        return 'Restaurant search is not configured. Set up AMap or a web search provider in Settings → API connections.' if en else '餐厅查询服务尚未配置。可在“设置 → API 接口”配置高德地图或联网搜索。'
    await emit(stage='dining_search',status='RUNNING',message=f'正在查询{city}的具体餐厅与位置。')
    async def bounded(call,timeout=8):
        try:return await asyncio.wait_for(call,timeout=timeout)
        except Exception:return []
    map_task=asyncio.create_task(bounded(amap.search_poi(keywords,city,max_results=8,types='050000'))) if amap else None
    web_task=asyncio.create_task(bounded(web_search.search(f'{city} {keywords} 餐厅 店名 地址',max_results=3),timeout=WEB_SEARCH_TIMEOUT)) if web_search else None
    try:
        places=await map_task if map_task else []
        places=[fact for fact in places if eligible(fact)]
        if places:
            await emit(stage='dining_search',status='SUCCESS',message=f'已查到{len(places[:3])}家餐厅地点候选。')
            lines=[f"**{markdown(city)} · {'Restaurant candidates' if en else '餐厅候选'}**",'']
            if diet:lines.extend([f"{'Search constraint' if en else '检索条件'}：{markdown(diet)}；"+('confirm ingredients with the restaurant; map labels are not an ingredient guarantee.' if en else '仅依据名称及地图资料筛选，具体配料仍需向店家确认。'),''])
            if re.search(r'便宜|人均|预算|cheaper',latest,re.I):lines.extend(['Prices were not provided, so these options are not verified to be cheaper.' if en else '本次地点资料未提供可比较的人均价格，不能确认哪家更便宜。',''])
            for fact in places[:3]:
                lines.extend([f'- **{markdown(fact.name)}**',f'  - {markdown(fact.value)}',f"  - [{'Map location' if en else '查看地图位置'}]({fact.source_url.replace('(', '%28').replace(')', '%29')})"])
            lines.extend(['','Source: AMap place search. Locations are candidates, not personal reviews; confirm branch, opening hours and current prices before going.' if en else '来源：高德地点查询。以上为地点候选，非实地探店结论；出发前核对分店、营业时间和实际菜单价格。'])
            return '\n'.join(lines)
        sources=await web_task if web_task else []
        sources=[fact for fact in sources if eligible(fact)]
        if sources:
            await emit(stage='dining_search',status='SUCCESS',message='已找到餐厅相关资料，地图位置仍待核对。')
            lines=[f"**{markdown(city)} · {'Restaurant search results' if en else '餐厅检索资料'}**",'']
            for fact in sources[:3]:lines.extend([f'- [{markdown(fact.name)}]({fact.source_url.replace("(","%28").replace(")","%29")})',f'  - {markdown(fact.value[:260])}'])
            lines.extend(['','Source: web search. These are source excerpts, not verified restaurant listings. Confirm names, locations and opening hours.' if en else '来源：联网搜索。以上为资料摘录，尚未取得可核对的地图餐厅列表；店名、地址及营业状态需按原页面进一步确认。'])
            return '\n'.join(lines)
        await emit(stage='dining_search',status='WARNING',message='本次餐厅查询未返回可用资料。')
        return f'Restaurant search for {city} did not return usable results this time. Please retry or specify a neighborhood or cuisine.' if en else f'已尝试查询{city}的餐厅，但本次没有取得可用结果。可以重试，或告诉我想吃的菜系、所在街区以缩小范围。'
    finally:
        tasks=[task for task in [map_task,web_task] if task]
        for task in tasks:
            if not task.done():task.cancel()
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
