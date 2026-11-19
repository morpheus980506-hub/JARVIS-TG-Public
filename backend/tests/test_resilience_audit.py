"""Adversarial integration and domain checks beyond the previous language audit."""
import asyncio
import itertools
import random
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.agents.intake import collect_trip_intake
from app.agents.planner import PlannerAgent
from app.api.routes import build_router
from app.api.workspace_routes import build_workspace_router
from app.api.validation import install_validation_handler
from app.database.db import Base, ConversationRecord, ConversationState
from app.schemas.domain import ChatMessage, TripRequest, ConversationItinerary
from tests.test_unexpected_intake import history
from tests.manual_unexpected_audit import BASE as BASE_REQUEST


@pytest.mark.parametrize('text,expected',[
    ('哈尔滨明天天气怎么样？',{'start_date':'2026-12-01'}),
    ('12月10日的天气怎样？',{'start_date':'2026-12-01'}),
    ('先别改预算，人数改成3人',{'travelers':3,'budget_cny':10000}),
    ('先别改日期，预算改成8000元',{'start_date':'2026-12-01','budget_cny':8000}),
    ('人均2000元，总预算4000元',{'budget_cny':4000}),
    ('3人总预算6000元',{'travelers':3,'budget_cny':6000}),
    ('总预算1e4元',{'budget_cny':10000}),
    ('总预算1e400元',{'budget_cny':None}),
    ('到店吃饭，不是去成都旅游',{'destination':'哈尔滨'}),
    ('2大1小，还有1个婴儿',{'travelers':4}),
    ('2个成人和-1个孩子',{'travelers':None}),
    ('日期改成9999-12-31',{'start_date':None}),
    ('查杭州12月10日入住、12月12日退房的酒店',{'start_date':'2026-12-01','destination':'哈尔滨'}),
    ('推荐3个人均200元的餐厅',{'travelers':2,'budget_cny':10000}),
    ('想查3人住5天的酒店',{'travelers':2,'days':3}),
    ('预算还没定',{'budget_cny':None}),
    ('人数不确定',{'travelers':None}),
    ('天数以后再定',{'days':None}),
    ('出发日期未定',{'start_date':None}),
    ('出发地未知',{'origin':None}),
    ('预算Infinity',{'budget_cny':None}),
    ('2个大人和1个10岁的孩子',{'travelers':3}),
    ('2个成人，1个3岁儿童，还有1个婴儿',{'travelers':4}),
    ('10岁的孩子玩得动吗？',{'travelers':2}),
])
def test_additional_language_boundaries(text,expected):
    result=collect_trip_intake(history(text),requirements_only=True)
    for key,value in expected.items():assert result.collected[key]==value


def test_yearless_date_uses_next_occurrence_at_original_message_time():
    messages=history('日期改到1月2日')
    messages[-1].created_at=ChatMessage(role='user',content='anchor',created_at='2026-12-20T23:58:00+08:00').created_at
    assert collect_trip_intake(messages).collected['start_date']=='2027-01-02'


def test_yesterday_is_not_an_acceptable_new_departure_date():
    result=collect_trip_intake(history('昨天出发'))
    assert not result.ready and 'start_date' in result.missing


def test_undo_reverts_last_committed_edit_and_skips_intervening_questions():
    messages=history('预算改成5000元')
    messages.extend([ChatMessage(role='user',content='现在是什么条件？'),ChatMessage(role='user',content='撤销刚才的修改')])
    result=collect_trip_intake(messages)
    assert result.ready and result.trip_request.budget_cny==10000


@pytest.mark.parametrize('edit',[
    '目的地改成成都','出发地改成杭州','日期改成2026-12-10','改成5天','人数改成3人','预算改成5000元',
    '之前的条件都作废，重新开始','取消这趟旅行',
])
def test_undo_restores_every_committed_dimension_and_control(edit):
    messages=history(edit)+[ChatMessage(role='user',content='现在的条件是什么？'),ChatMessage(role='user',content='撤销刚才的修改')]
    result=collect_trip_intake(messages)
    assert result.ready
    assert {key:result.collected[key] for key in ['origin','destination','start_date','days','travelers','budget_cny']}=={
        'origin':'温州','destination':'哈尔滨','start_date':'2026-12-01','days':3,'travelers':2,'budget_cny':10000}


@pytest.mark.parametrize('day',[1,60])
def test_duration_boundaries_remain_supported(day):
    assert collect_trip_intake(history(f'改成{day}天')).trip_request.days==day


@pytest.mark.parametrize('day',[0,61,999999])
def test_duration_outside_limits_never_reaches_planning(day):
    result=collect_trip_intake(history(f'改成{day}天'))
    assert not result.ready and 'days' in result.missing


@pytest.mark.parametrize('value',['日期改成10000-12-01','日期改成2027-02-29','日期改成2026-13-01','日期改成2026-12-32'])
def test_invalid_calendar_values_never_fall_back_to_another_part_of_the_number(value):
    result=collect_trip_intake(history(value))
    assert not result.ready and result.collected['start_date'] is None


def test_relative_dates_keep_the_original_china_day_near_utc_midnight():
    messages=history('明天出发')
    messages[-1].created_at=ChatMessage(role='user',content='anchor',created_at='2026-12-31T18:30:00Z').created_at
    assert collect_trip_intake(messages).collected['start_date']=='2027-01-02'


def test_multi_field_edits_are_independent_of_clause_order():
    for clauses in itertools.permutations(['日期改到2027-01-02','改成5天','人数改成3人','总预算6000元']):
        result=collect_trip_intake(history('，'.join(clauses)))
        assert result.ready
        assert {key:result.collected[key] for key in ['start_date','days','travelers','budget_cny']}=={
            'start_date':'2027-01-02','days':5,'travelers':3,'budget_cny':6000}


def test_mixed_noise_never_throws_or_produces_an_inconsistent_ready_request():
    rng=random.Random(20261110)
    alphabet='预算人数日期改成不去明天酒店0123456789eE+-.,，😅abc\n\t'
    for _ in range(120):
        text=''.join(rng.choice(alphabet) for _ in range(rng.randint(1,160)))
        if not text.strip():continue
        result=collect_trip_intake(history(text),requirements_only=True)
        if result.ready:
            for key in ['origin','destination','days','travelers','budget_cny']:
                assert getattr(result.trip_request,key)==result.collected[key]


@pytest.mark.parametrize('value',[float('inf'),float('-inf'),float('nan')])
def test_provider_costs_must_be_finite(value):
    from app.schemas.domain import CostItem
    with pytest.raises(ValidationError):CostItem(category='food',description='test',amount_cny=value)


@pytest.mark.parametrize('text,check_in,check_out',[
    ('查杭州2099年11月20日至22日的酒店','2099-11-20','2099-11-22'),
    ('查杭州2099-11-20入住，2099-11-22退房的酒店','2099-11-20','2099-11-22'),
    ('查杭州2099年12月30日至2日的酒店','2099-12-30','2100-01-02'),
    ('杭州2099-11-20入住，住2晚酒店','2099-11-20','2099-11-22'),
    ('杭州2099-11-20入住，住两晚酒店','2099-11-20','2099-11-22'),
])
def test_real_user_stay_dates_and_compact_ranges_remain_usable(text,check_in,check_out):
    from app.agents.stay_dates import stay_is_grounded
    assert stay_is_grounded(date.fromisoformat(check_in),date.fromisoformat(check_out),[ChatMessage(role='user',content=text)],{})


@pytest.mark.parametrize('text',['杭州酒店预算1.23元','杭州酒店预算12,000元','杭州酒店日期还没定'])
def test_amounts_and_unknown_dates_are_not_grounded_hotel_dates(text):
    from app.agents.stay_dates import grounded_stay_dates
    assert not grounded_stay_dates([ChatMessage(role='user',content=text)],{})[0]


def test_rejected_or_superseded_stay_dates_cannot_be_used_for_a_new_quote():
    from app.agents.stay_dates import stay_is_grounded
    messages=[ChatMessage(role='user',content='杭州2099-11-20入住，2099-11-22退房的酒店'),
              ChatMessage(role='user',content='改到2099-12-01入住，2099-12-03退房')]
    assert not stay_is_grounded(date(2099,11,20),date(2099,11,22),messages,{})
    assert stay_is_grounded(date(2099,12,1),date(2099,12,3),messages,{})
    messages.append(ChatMessage(role='user',content='入住和退房日期未定'))
    assert not stay_is_grounded(date(2099,12,1),date(2099,12,3),messages,{})


@pytest.mark.parametrize('value',[float('inf'),float('-inf'),float('nan')])
def test_nonfinite_request_budget_is_rejected(value):
    with pytest.raises(ValidationError):TripRequest(text='预算测试',budget_cny=value)


def test_duplicate_day_numbers_are_rejected_before_saving():
    with pytest.raises(ValidationError):
        ConversationItinerary(days=[{'day':1,'title':'A','items':['A']},{'day':1,'title':'B','items':['B']}])


@pytest.mark.asyncio
async def test_confirmed_solo_traveler_is_not_overwritten_by_superseded_text():
    request=TripRequest(text='从温州去杭州，2026-12-01出发，3天，2人，预算5000。改成1人。',origin='温州',destination='杭州',start_date=date(2026,12,1),days=3,travelers=1,budget_cny=5000)
    result=await PlannerAgent().execute({'request':request})
    assert result['requirement'].travelers==1


@pytest.mark.asyncio
async def test_direct_text_plan_cannot_bypass_duration_bounds():
    request=TripRequest(text='从温州去杭州，2026-12-01出发，99999天，预算5000元')
    with pytest.raises(ValueError):await PlannerAgent().execute({'request':request})


@pytest.fixture
async def isolated_api(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    factory=async_sessionmaker(engine,expire_on_commit=False)
    for module in ['app.api.routes','app.api.workspace_routes','app.approval.manager']:
        monkeypatch.setattr(module+'.SessionLocal',factory)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    advice=AsyncMock(return_value='### D1 成都\n- 新安排')
    app=FastAPI();install_validation_handler(app);orchestrator=SimpleNamespace(travel_advice=advice)
    app.include_router(build_router(orchestrator));app.include_router(build_workspace_router(orchestrator))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        yield client,factory,advice
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('messages',[
    [{'role':'assistant','content':'只有助手'}],
    [{'role':'user','content':'你好'},{'role':'assistant','content':'历史'}],
    [{'role':'user','content':' \n\t '}],
])
async def test_invalid_user_turns_are_rejected_without_provider_calls(isolated_api,messages):
    client,_,advice=isolated_api
    for endpoint in ['/api/v1/trips/intake','/api/v1/trips/intake/stream']:
        response=await client.post(endpoint,json={'messages':messages})
        assert response.status_code==422
    advice.assert_not_called()


@pytest.mark.asyncio
async def test_blank_conversation_title_is_not_saved(isolated_api):
    client,_,_=isolated_api
    assert (await client.post('/api/v1/conversations',json={'title':'   '})).status_code==422
    assert (await client.get('/api/v1/conversations')).json()==[]


@pytest.mark.asyncio
@pytest.mark.parametrize('value',['Infinity','-Infinity','NaN'])
async def test_invalid_numeric_json_returns_validation_error_instead_of_server_failure(isolated_api,value):
    client,_,_=isolated_api
    response=await client.post('/api/v1/trips/plan',content='{"text":"test","budget_cny":'+value+'}',headers={'Content-Type':'application/json'})
    assert response.status_code==422


@pytest.mark.asyncio
async def test_invalid_fields_do_not_echo_a_credential_like_input(isolated_api):
    client,_,_=isolated_api
    private='QA-only-private-value-not-a-real-key'
    response=await client.post('/api/v1/trips/intake',json={'messages':[{'role':'user','content':'你好'}],'language':private})
    assert response.status_code==422 and private not in response.text


@pytest.mark.asyncio
async def test_message_length_edge_and_oversized_input(isolated_api):
    client,_,advice=isolated_api
    valid=await client.post('/api/v1/trips/intake',json={'messages':[{'role':'user','content':'A'*4000}]})
    assert valid.status_code==200
    advice.reset_mock()
    invalid=await client.post('/api/v1/trips/intake',json={'messages':[{'role':'user','content':'A'*4001}]})
    assert invalid.status_code==422
    advice.assert_not_called()


@pytest.mark.asyncio
async def test_cleared_budget_does_not_leave_a_hidden_old_budget_limit(isolated_api):
    client,_,_=isolated_api
    id=(await client.post('/api/v1/conversations',json={})).json()['id']
    await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':BASE_REQUEST}]})
    detail=(await client.get('/api/v1/conversations/'+id)).json()
    response=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':detail['messages']+[{'role':'user','content':'预算不限了'}]})
    assert response.status_code==200 and not response.json()['ready']
    workspace=(await client.get('/api/v1/conversations/'+id+'/workspace')).json()
    assert workspace['budget']['budget_cny'] is None


@pytest.mark.asyncio
async def test_hypothetical_advice_cannot_replace_a_saved_itinerary(isolated_api):
    client,sessions,advice=isolated_api
    id=(await client.post('/api/v1/conversations',json={})).json()['id']
    snapshot={'days':[{'day':1,'title':'哈尔滨','items':['中央大街']}],'updated_at':'original'}
    async with sessions() as session:
        session.add(ConversationState(id=id,payload={'itinerary':deepcopy(snapshot)}));await session.commit()
    response=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':'如果去成都怎么玩？先别改我的行程'}]})
    assert response.status_code==200
    assert response.json()['itinerary']==snapshot
    advice.assert_awaited_once()


@pytest.mark.asyncio
async def test_hypothetical_day_headings_do_not_reappear_as_an_itinerary_after_reload(isolated_api):
    client,_,_=isolated_api
    id=(await client.post('/api/v1/conversations',json={})).json()['id']
    response=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':'如果去成都怎么玩？先别改我的行程'}]})
    assert response.status_code==200 and response.json()['itinerary'] is None
    assert (await client.get('/api/v1/conversations/'+id)).json()['itinerary'] is None
    assert (await client.get('/api/v1/conversations/'+id+'/workspace')).json()['itinerary'] is None
    assert (await client.get('/api/v1/itineraries')).json()==[]


@pytest.mark.asyncio
async def test_concurrent_approval_decisions_have_only_one_winner(isolated_api):
    from app.approval.manager import ApprovalManager
    from app.schemas.domain import ApprovalRequest,ApprovalLevel
    manager=ApprovalManager()
    approval=await manager.request(ApprovalRequest(trip_id='qa',action='qa-only',level=ApprovalLevel.L2,summary='test'))
    results=await asyncio.gather(manager.decide(approval.id,True,'A'),manager.decide(approval.id,False,'B'),return_exceptions=True)
    assert sum(not isinstance(result,Exception) for result in results)==1
    assert sum(isinstance(result,ValueError) for result in results)==1


@pytest.mark.asyncio
async def test_pending_revision_still_marks_previously_selected_hotels_for_review(isolated_api):
    client,sessions,_=isolated_api
    async with sessions() as session:
        session.add(ConversationRecord(id='qa-selection',title='qa',messages=[]))
        session.add(ConversationState(id='qa-selection',payload={
            'requirements':{'destination':'成都','start_date':'2026-12-10','days':4,'travelers':2},
            'itinerary':{'pending_revision':True,'days':[{'day':1,'title':'哈尔滨','items':['旧版']}],'updated_at':'old'},
            'selections':[{'id':'old','candidate_id':'old','title':'哈尔滨酒店','provider':'test','category':'hotel','city':'哈尔滨','unit_price_cny':100,'quantity':1,
                           'trip_context':{'destination':'哈尔滨','start_date':'2026-12-01','days':3,'travelers':2}}]}))
        await session.commit()
    result=(await client.get('/api/v1/conversations/qa-selection/workspace')).json()
    assert result['selections'][0]['needs_review'] is True


@pytest.mark.asyncio
async def test_supplier_cannot_invent_hotel_dates_when_the_user_provided_none():
    import json
    from app.agents.travel_intent import supplier_reply
    gateway=SimpleNamespace(search=AsyncMock(return_value={'provider':'fliggy','items':[],'text':'','notice':''}))
    model=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=json.dumps({
        'action':'search','city':'杭州','category':'hotel','check_in':'2099-12-01','check_out':'2099-12-03','providers':['fliggy']}))))
    orchestrator=SimpleNamespace(model_gateway=model,travel_gateway=gateway,settings=SimpleNamespace(fliggy_api_key='test',meituan_ht_token=''))
    result=await supplier_reply(orchestrator,[ChatMessage(role='user',content='查杭州酒店')])
    gateway.search.assert_not_called()
    assert '入住' in result['reply']


@pytest.mark.asyncio
async def test_supplier_does_not_reuse_locations_from_before_a_reset():
    import json
    from app.agents.travel_intent import supplier_reply
    gateway=SimpleNamespace(search=AsyncMock(return_value={'provider':'fliggy','items':[],'text':'','notice':''}))
    model=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=json.dumps({
        'action':'search','city':'哈尔滨','category':'hotel','check_in':'2099-12-01','check_out':'2099-12-03','providers':['fliggy']}))))
    orchestrator=SimpleNamespace(model_gateway=model,travel_gateway=gateway,settings=SimpleNamespace(fliggy_api_key='test',meituan_ht_token=''))
    messages=[ChatMessage(role='user',content=BASE_REQUEST),ChatMessage(role='user',content='之前的条件都作废，重新开始'),ChatMessage(role='user',content='查酒店')]
    result=await supplier_reply(orchestrator,messages)
    gateway.search.assert_not_called()
    assert not result['travel_results']


@pytest.mark.asyncio
async def test_chat_only_itinerary_export_includes_confirmed_budget_without_inventing_full_cost(isolated_api):
    client,sessions,_=isolated_api
    async with sessions() as session:
        session.add(ConversationRecord(id='qa-export',title='qa',messages=[]))
        session.add(ConversationState(id='qa-export',payload={'requirements':{'origin':'温州','destination':'杭州','days':2,'travelers':1,'start_date':'2099-12-01','budget_cny':1500},
            'budget_limit':1500,'itinerary':{'days':[{'day':1,'title':'杭州','items':['散步']}],'updated_at':'test'}}))
        await session.commit()
    response=await client.get('/api/v1/conversations/qa-export/workspace/export')
    assert response.status_code==200
    assert '1500.00' in response.text and '温州' in response.text and '尚无全行程费用估算' in response.text


@pytest.mark.asyncio
async def test_weather_refresh_refuses_a_changed_destination_even_when_trip_id_is_unchanged(isolated_api):
    from app.database.db import TripRecord
    from app.schemas.domain import SourceFact
    client,sessions,_=isolated_api
    started=asyncio.Event();release=asyncio.Event()
    async def weather(*args):
        started.set();await release.wait()
        return [SourceFact(name='2099-12-01 杭州',value='晴',source_url='https://example.com')],'real'
    # This router has the same isolated database and a controlled provider.
    app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace(tool_gateway=SimpleNamespace(weather=weather))))
    plan={'trip_id':'qa-weather-trip','requirement':{'start_date':'2099-12-01','budget_cny':1000,'days':2,'destination':'杭州'},'itinerary':[],'costs':[],'verification':{'status':'PASS','issues':[]}}
    async with sessions() as session:
        session.add(ConversationRecord(id='qa-weather',title='qa',messages=[]))
        session.add(TripRecord(id='qa-weather-trip',trace_id='qa',request_text='qa',payload=plan))
        session.add(ConversationState(id='qa-weather',payload={'trip_id':'qa-weather-trip','itinerary':None,'weather_review':{'facts':[],'destination':'杭州','checked_at':'old'}}))
        await session.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as other:
        task=asyncio.create_task(other.post('/api/v1/conversations/qa-weather/workspace/refresh-weather'))
        await asyncio.wait_for(started.wait(),1)
        async with sessions() as session:
            record=await session.get(ConversationState,'qa-weather')
            record.payload={**record.payload,'requirements':{'destination':'成都'}};await session.commit()
        release.set()
        assert (await task).status_code==409
    async with sessions() as session:
        record=await session.get(ConversationState,'qa-weather')
        assert record.payload['weather_review']['checked_at']=='old'
