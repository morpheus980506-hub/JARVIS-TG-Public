import json
from types import SimpleNamespace
import pytest
from app.agents.travel_intent import wants_supplier_search,supplier_reply
from app.schemas.domain import ChatMessage
from app.tools.providers.travel_search import TravelSearchError


def user(text):return ChatMessage(role='user',content=text)


@pytest.mark.parametrize('text',['帮我查杭州酒店','用美团找酒店','滴滴打车多少钱','Find hotels in Hangzhou'])
def test_explicit_supplier_queries_are_detected(text):assert wants_supplier_search([user(text)])


@pytest.mark.parametrize('text',['怎么配置滴滴API','推荐住宿区域和选择标准','帮我规划7天旅行','晚上好'])
def test_configuration_and_general_advice_do_not_trigger_product_queries(text):assert not wants_supplier_search([user(text)])


@pytest.mark.asyncio
async def test_supplier_results_are_independent_and_progress_delivers_each_result():
    async def generate(messages,**kwargs):return SimpleNamespace(content=json.dumps({'action':'search','city':'杭州','category':'hotel','check_in':'2099-11-20','check_out':'2099-11-22','providers':['fliggy','meituan']}))
    calls=[];events=[]
    class Gateway:
        settings=None
        async def search(self,provider,city,query):
            calls.append((provider,city,query))
            if provider=='meituan':raise TravelSearchError('timeout')
            return {'provider':provider,'items':[{'title':'真实候选','candidate_id':'one'}],'text':'','notice':''}
    async def progress(event):events.append(event)
    engine=SimpleNamespace(model_gateway=SimpleNamespace(generate_fast=generate),travel_gateway=Gateway(),settings=SimpleNamespace(fliggy_api_key='fake',meituan_ht_token='fake'))
    result=await supplier_reply(engine,[user('查杭州2099年11月20日至22日的酒店')],progress=progress)
    assert len(calls)==2
    assert result['travel_results'][0]['items'][0]['title']=='真实候选'
    assert result['travel_results'][1]['error']=='timeout'
    assert any(event.get('travel_result',{}).get('provider')=='fliggy' for event in events)
    assert '2099-11-20' in calls[0][2] and '2099-11-22' in calls[0][2]


@pytest.mark.asyncio
async def test_missing_dates_and_hallucinated_city_do_not_query_suppliers():
    async def generate(messages,**kwargs):return SimpleNamespace(content=json.dumps({'action':'search','city':'北京','category':'hotel','check_in':'2099-11-20','check_out':'2099-11-22'}))
    engine=SimpleNamespace(model_gateway=SimpleNamespace(generate_fast=generate))
    result=await supplier_reply(engine,[user('查杭州的酒店')])
    assert not result['travel_results'] and '城市' in result['reply']
    async def missing(messages,**kwargs):return SimpleNamespace(content=json.dumps({'action':'search','city':'杭州','category':'hotel'}))
    engine.model_gateway.generate_fast=missing
    result=await supplier_reply(engine,[user('查杭州的酒店')])
    assert '入住' in result['reply'] and not result['travel_results']
