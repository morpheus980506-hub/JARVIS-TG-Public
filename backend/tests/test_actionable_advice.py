from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.agents.actionable_advice import wants_actionable_itinerary,collect_advice_evidence
from app.agents.intake import classify_conversation_mode
from app.agents.travel_intent import supplier_reply
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage,SourceFact,TransportOption

BASE='从温州去哈尔滨，2026-12-01出发，3天，2人，总预算10000元，希望美食'
TRIGGER='那你至少安排一下路线，店面，酒店，交通吧'
def history(latest=TRIGGER):
    return [ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='### D1\n- 中央大街附近游玩\n### D2\n- 在当地吃饭'),ChatMessage(role='user',content=latest)]

@pytest.mark.parametrize('latest',[TRIGGER,'再详细一点吧','把吃住和每天的时间点排好','Please plan the itinerary with restaurants and hotels.'])
def test_concrete_itinerary_followups_are_not_lost_in_generic_short_chat(latest):
    assert wants_actionable_itinerary(history(latest))
    assert classify_conversation_mode(history(latest))=='advisor'

@pytest.mark.parametrize('latest',['查杭州酒店','查航班','你好','帮我安排接机交通'])
def test_single_service_queries_do_not_become_a_full_itinerary(latest):
    assert not wants_actionable_itinerary(history(latest))

@pytest.mark.asyncio
async def test_combined_query_is_not_intercepted_by_hotel_only_search():
    result=await supplier_reply(SimpleNamespace(),history('查具体餐厅和酒店，把路线和行程安排好'))
    assert result is None

def build_engine(reply='### 先说明\n我无法联网核实具体店名和酒店名。需要我补时间点吗？'):
    places=[SourceFact(name=name,value='地址：测试路'+str(index),source_url=f'https://uri.amap.com/marker?position={126.62+index*.001},45.77') for index,name in enumerate(['中央大街','测试博物馆','测试公园'])]
    food=SourceFact(name='实际返回的素食餐厅',value='地址：测试街2号',source_url='https://uri.amap.com/marker?position=126.62,45.77&name=food')
    hotel=SourceFact(name='实际返回的住宿地点',value='地址：测试街3号',source_url='https://uri.amap.com/marker?position=126.62,45.77&name=hotel')
    async def search(keyword,city,**kwargs):
        if kwargs.get('types')=='050000':return [food]
        if keyword=='酒店':return [hotel]
        return places[:1] if kwargs.get('max_results')==1 else places
    amap=SimpleNamespace(search_poi=AsyncMock(side_effect=search),route=AsyncMock(return_value={'route':{'paths':[{'distance':'500','cost':{'duration':'600'}}]}}))
    option=TransportOption(mode='flight',service_number='TEST123',provider='test',departure_name='温州机场',arrival_name='哈尔滨机场',departure_time='2026-12-01 08:00:00',arrival_time='2026-12-01 12:00:00',duration_minutes=240,source_url='https://example.com/flights',is_mock=False)
    engine=Orchestrator.__new__(Orchestrator)
    engine.tool_gateway=SimpleNamespace(amap=amap,tavily=None,transport=AsyncMock(return_value=([option],'real')))
    engine.travel_gateway=SimpleNamespace(status=lambda:[{'id':'fliggy','configured':True,'client_installed':True}],search=AsyncMock(return_value={'items':[{'title':'平台酒店候选','price_text':'房价待确认','url':'https://router.feizhu.com/test'}]}))
    engine.model_gateway=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=reply,model='test')),stream_fast=AsyncMock())
    engine.settings=SimpleNamespace(deepseek_fast_model='test')
    return engine,places,food,hotel

@pytest.mark.asyncio
async def test_exact_screenshot_request_performs_real_lookup_paths_and_does_not_emit_model_refusal():
    engine,places,food,hotel=build_engine()
    events=[];tokens=[]
    async def progress(event):events.append(event)
    async def token(text):tokens.append(text)
    result=await engine.travel_advice(history(),progress=progress,token_callback=token)
    assert food.name in result and hotel.name in result and 'TEST123' in result
    assert food.source_url in result and '测试街2号' in result
    assert '无法联网' not in result and '需要我补' not in result
    assert 'D1' in result and 'D2' in result and 'D3' in result
    assert tokens==[result]  # Unchecked refusal text is never shown before the final answer.
    engine.tool_gateway.transport.assert_any_await('温州','哈尔滨','2026-12-01',False)
    engine.tool_gateway.transport.assert_any_await('哈尔滨','温州','2026-12-03',False)
    assert any(event['stage']=='advice_places' for event in events)
    assert any(event['stage']=='advice_hotels' for event in events)
    assert '2026-12-03退房' in engine.travel_gateway.search.call_args.args[2]
    assert engine.model_gateway.generate_fast.call_args.kwargs['max_tokens']>=2400
    engine.model_gateway.stream_fast.assert_not_called()

@pytest.mark.asyncio
async def test_diet_and_geographic_anchor_are_applied_to_concrete_restaurant_lookup():
    engine,_,food,_=build_engine()
    messages=history('把路线、酒店和餐厅都安排好，只吃素食')
    messages[1].content='上午：步行逛中央大街，然后用餐。'
    from app.agents.intake import format_trip_memory
    facts,_=format_trip_memory(messages)
    evidence=await collect_advice_evidence(engine,messages,facts,AsyncMock())
    assert evidence['restaurants']==[food]
    call=next(call for call in engine.tool_gateway.amap.search_poi.call_args_list if call.kwargs.get('types')=='050000')
    assert '素食' in call.args[0] and call.kwargs.get('location') is not None
    assert engine.tool_gateway.amap.search_poi.call_args_list[0].args[0]=='中央大街'

@pytest.mark.asyncio
async def test_map_hotels_are_not_claimed_as_bookable_when_platform_is_missing():
    engine,_,food,hotel=build_engine();engine.travel_gateway=None
    result=await engine.travel_advice(history())
    assert hotel.name in result and '未查询房态及报价' in result
    assert '已预订' not in result

@pytest.mark.asyncio
async def test_provider_failures_do_not_leak_private_errors_or_make_up_names():
    engine,_,_,_=build_engine()
    engine.tool_gateway.amap.search_poi.side_effect=RuntimeError('QA-private-error')
    engine.tool_gateway.transport.side_effect=RuntimeError('QA-private-error')
    engine.travel_gateway.search.side_effect=RuntimeError('QA-private-error')
    result=await engine.travel_advice(history())
    assert 'QA-private-error' not in result and '没有取得可用' in result
    assert '实际返回的' not in result


def test_vouchers_and_other_cities_are_not_recommended_as_specific_hotels():
    from app.agents.actionable_advice import specific_hotel
    def item(title):return {'title':title,'url':'https://example.com/hotel'}
    assert not specific_hotel(item('全国8000+店2晚通兑'),'哈尔滨')
    assert not specific_hotel(item('哈尔滨多店住宿券通兑'),'哈尔滨')
    assert not specific_hotel(item('上海某某酒店'),'哈尔滨')
    assert specific_hotel(item('哈尔滨某某酒店中央大街店双早套餐'),'哈尔滨')


@pytest.mark.asyncio
async def test_anchor_kept_low_rated_places_removed_and_vouchers_excluded():
    engine,places,_,hotel=build_engine()
    places[1].value='地址：测试街；高德评分：2.9'
    engine.travel_gateway.search.return_value={'items':[{'title':'全国酒店2晚通兑','url':'https://example.com/voucher'}]}
    from app.agents.intake import format_trip_memory
    messages=history();facts,_=format_trip_memory(messages)
    evidence=await collect_advice_evidence(engine,messages,facts,AsyncMock())
    assert evidence['places'][0].name=='中央大街'
    assert len([item for item in evidence['places'] if item.name=='中央大街'])==1
    assert places[1] not in evidence['places']
    assert not evidence.get('platform_hotels')
    assert evidence['hotels'][0]['name']==hotel.name
    assert not evidence.get('return_transport')  # Mock outbound response is not a valid return.


def test_visit_lengths_and_meal_variety():
    from app.agents.actionable_advice import fallback_itinerary,visit_slot
    _,places,food,hotel=build_engine()
    old=places[1].model_copy(update={'name':'某某洋行旧址'})
    assert visit_slot(old,'14:00')=='14:00–14:45'
    other=food.model_copy(update={'name':'第二家餐厅','source_url':'https://example.com/other'})
    evidence={'places':[places[0],old],'restaurants':[food,other],'hotels':[{'name':hotel.name,'value':hotel.value,'url':hotel.source_url,'kind':'未查询房态'}],'transport':[],'route':None,'gaps':[]}
    reply=fallback_itinerary(evidence,{'days':3})
    day2=reply.split('### D2')[1].split('### D3')[0]
    assert other.name in day2 and food.name not in day2
    assert '14:00–14:45' in day2 and '外观参观' in day2


@pytest.mark.asyncio
async def test_named_but_still_vague_model_output_is_replaced_with_timed_plan():
    engine,_,food,hotel=build_engine()
    engine.model_gateway.generate_fast.return_value.content=f'### D1\n飞机15:40起飞。\n### D2\n上午游玩，下午自由活动。晚餐：{food.name}；住{hotel.name}。\n### D3\n返程10:55起飞。'
    reply=await engine.travel_advice(history())
    assert '09:30' in reply and '2026-12-02' in reply
    assert '下午自由活动' not in reply
