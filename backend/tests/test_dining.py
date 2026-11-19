import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from app.agents.dining import is_dining_request,dining_city,dining_reply
from app.agents.intake import classify_conversation_mode
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage,SourceFact
from app.tools.providers.amap import AmapProvider


def conversation(latest='你好歹告诉我哪家店吧'):
    return [ChatMessage(role='user',content='从温州去哈尔滨玩，2099-12-01出发，3天，1人，预算10000元，希望美食'),
            ChatMessage(role='assistant',content='可以在中央大街品尝锅包肉、铁锅炖和饺子。'),ChatMessage(role='user',content=latest)]


@pytest.mark.parametrize('latest',['你好歹告诉我哪家店吧','给我具体店名','推荐几家餐厅','Which restaurants do you recommend?'])
def test_restaurant_followups_use_search_instead_of_unconnected_smalltalk(latest):
    assert is_dining_request(conversation(latest))
    assert classify_conversation_mode(conversation(latest))=='advisor'


@pytest.mark.parametrize('latest',['哪家酒店便宜','推荐住宿区域','把行程全部细化','API怎么配置'])
def test_unrelated_requests_do_not_enter_restaurant_lookup(latest):
    assert not is_dining_request(conversation(latest))


@pytest.mark.asyncio
async def test_named_restaurants_come_from_city_scoped_poi_without_model_refusal():
    poi=SourceFact(name='真实返回的餐厅(分店)',value='地址：道里区测试路1号；高德评分：4.5',source_url='https://uri.amap.com/marker?position=126,45')
    engine=Orchestrator.__new__(Orchestrator)
    engine.tool_gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[poi])),tavily=None)
    engine.model_gateway=SimpleNamespace(generate_fast=AsyncMock(side_effect=AssertionError('Should not invent a restaurant')))
    events=[]
    async def progress(event):events.append(event)
    reply=await engine.travel_advice(conversation(),progress=progress,use_search=False)
    assert poi.name in reply and '测试路1号' in reply and poi.source_url in reply
    assert '没有联网' not in reply and '要不要' not in reply
    call=engine.tool_gateway.amap.search_poi.call_args
    assert call.args[1]=='哈尔滨' and '锅包肉' in call.args[0] and call.kwargs['types']=='050000'
    assert events[-1]['status']=='SUCCESS'
    engine.model_gateway.generate_fast.assert_not_called()


@pytest.mark.asyncio
async def test_saved_destination_is_reused_and_explicit_city_change_wins():
    assert dining_city('推荐成都的火锅店','哈尔滨')=='成都'
    assert dining_city('推荐当地的餐厅','哈尔滨')=='哈尔滨'
    assert dining_city('推荐几家好吃的餐厅','哈尔滨')=='哈尔滨'
    assert dining_city('推荐靠谱的餐厅','哈尔滨')=='哈尔滨'
    assert dining_city('推荐中央大街的餐厅','哈尔滨')=='哈尔滨'
    gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[])),tavily=None)
    engine=Orchestrator.__new__(Orchestrator);engine.tool_gateway=gateway
    await engine.travel_advice([ChatMessage(role='user',content='推荐几家餐厅')],workspace_context={'requirement':{'destination':'哈尔滨'},'days':[]})
    assert gateway.amap.search_poi.call_args.args[1]=='哈尔滨'


@pytest.mark.asyncio
async def test_missing_city_asks_once_and_failed_query_reports_attempt_without_fake_names():
    gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(side_effect=RuntimeError('fake-secret'))),tavily=None)
    emit=AsyncMock()
    question=await dining_reply(gateway,conversation(),None,'zh',emit)
    assert '哪个城市' in question
    gateway.amap.search_poi.assert_not_called()
    reply=await dining_reply(gateway,conversation(),'哈尔滨','zh',emit)
    assert '已尝试查询哈尔滨' in reply and 'fake-secret' not in reply
    assert emit.call_args.kwargs['status']=='WARNING'


@pytest.mark.asyncio
async def test_web_fallback_is_source_material_not_fake_verified_restaurant_cards():
    fact=SourceFact(name='哈尔滨餐饮资料',value='页面提到某某饭店，位置请看原文。',source_url='https://example.com/restaurants')
    gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[])),tavily=SimpleNamespace(search=AsyncMock(return_value=[fact])))
    reply=await dining_reply(gateway,conversation(),'哈尔滨','zh',AsyncMock())
    assert fact.source_url in reply and '资料摘录' in reply and '营业' in reply
    assert '地点候选' not in reply


@pytest.mark.asyncio
async def test_successful_map_lookup_cancels_slow_web_work():
    cancelled=asyncio.Event()
    async def slow(*args,**kwargs):
        try:await asyncio.Event().wait()
        finally:cancelled.set()
    fact=SourceFact(name='餐厅',value='地址：测试',source_url='https://uri.amap.com/marker?position=126,45')
    gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[fact])),tavily=SimpleNamespace(search=slow))
    await asyncio.wait_for(dining_reply(gateway,conversation(),'哈尔滨','en',AsyncMock()),1)
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_restaurant_type_filter_and_marker_name_encoding():
    def handler(request):
        assert request.url.params['types']=='050000' and request.url.params['city_limit']=='true'
        return httpx.Response(200,json={'status':'1','pois':[{'name':'餐厅 #1 & 分店','location':'126,45','address':'测试街'}]})
    provider=AmapProvider('fake',transport=httpx.MockTransport(handler))
    facts=await provider.search_poi('锅包肉','哈尔滨',types='050000')
    assert '%23' in facts[0].source_url and '%26' in facts[0].source_url
