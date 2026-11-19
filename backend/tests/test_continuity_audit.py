"""Cross-feature continuity: saved plans, undo, reset, and supplier clarification."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
import json

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.api.routes import build_router
from app.api.workspace_routes import build_workspace_router
from app.database.db import Base,ConversationRecord,ConversationState,TripRecord
from app.agents.intake import collect_trip_intake
from app.agents.travel_intent import wants_supplier_search,supplier_reply
from app.schemas.domain import ChatMessage
from tests.manual_unexpected_audit import BASE


def msg(text):return ChatMessage(role='user',content=text)


@pytest.mark.parametrize('text,expected',[
    ('重新开始，从杭州去苏州，2027-01-02出发，2天，1人，总预算2000元，希望园林',{'origin':'杭州','destination':'苏州','days':2,'budget_cny':2000}),
    ('取消这趟旅行，预算改成5000元',{'planning_status':'cancelled','budget_cny':5000}),
    ('Do not change the budget. Change the destination to Chengdu.',{'budget_cny':10000,'destination':'Chengdu'}),
])
def test_controls_can_share_a_message_with_other_explicit_edits(text,expected):
    result=collect_trip_intake([msg(BASE),msg(text)],requirements_only=True)
    for key,value in expected.items():assert result.collected[key]==value


def test_undoing_a_day_edit_does_not_instead_undo_an_older_budget_edit():
    result=collect_trip_intake([msg(BASE),msg('预算改成5000元'),msg('把第二天的安排改成轻松一些'),msg('撤销刚才的修改')])
    assert result.trip_request.budget_cny==5000


@pytest.mark.parametrize('text',['第二天去哪玩？','第三天会不会太累？','第3位同伴喜欢吃辣'])
def test_ordinal_numbers_do_not_replace_duration_or_total_travelers(text):
    result=collect_trip_intake([msg(BASE),msg(text)],requirements_only=True)
    assert result.collected['days']==3 and result.collected['travelers']==2


@pytest.mark.parametrize('reply,answer',[
    ('你准备哪天入住、哪天退房？','2027-01-02入住，1月4日退房'),
    ('你想查哪个城市？','杭州'),
    ('What are your check-in and check-out dates?','2027-01-02 to 2027-01-04'),
])
def test_supplier_clarification_can_be_answered_without_repeating_search_request(reply,answer):
    messages=[msg('帮我查酒店'),ChatMessage(role='assistant',content=reply),msg(answer)]
    assert wants_supplier_search(messages)


def test_hotel_city_answer_does_not_change_the_trip_destination():
    messages=[msg(BASE),msg('查酒店'),ChatMessage(role='assistant',content='你想查哪个城市？'),msg('杭州')]
    assert collect_trip_intake(messages,requirements_only=True).collected['destination']=='哈尔滨'


def test_general_trip_city_question_is_not_mistaken_for_a_supplier_prompt():
    messages=[msg('帮我规划旅行'),ChatMessage(role='assistant',content='你想去哪个城市，入住酒店有什么要求？'),msg('哈尔滨')]
    assert collect_trip_intake(messages,requirements_only=True).collected['destination']=='哈尔滨'


def test_hotel_date_clarification_does_not_change_departure_even_without_checkin_word():
    messages=[msg(BASE),msg('查杭州酒店'),ChatMessage(role='assistant',content='请提供入住和退房日期。'),msg('日期改到2027-01-02，1月4日退房')]
    assert wants_supplier_search(messages)
    assert collect_trip_intake(messages,requirements_only=True).collected['start_date']=='2026-12-01'


def test_undoing_reset_restores_the_pending_supplier_epoch():
    from app.agents.intake_policy import active_epoch
    messages=[msg('查杭州酒店'),ChatMessage(role='assistant',content='你准备哪天入住、哪天退房？'),
              msg('重新开始'),msg('撤销刚才的修改'),ChatMessage(role='assistant',content='请提供入住和退房日期。'),msg('2099-01-02入住，2099-01-04退房')]
    assert active_epoch(messages)[0].content=='查杭州酒店'
    assert wants_supplier_search(messages)


@pytest.mark.parametrize('text,expected_in,expected_out',[
    ('2099-01-02入住，1月4日退房','2099-01-02','2099-01-04'),
    ('2099-12-30入住，1月2日退房','2099-12-30','2100-01-02'),
])
def test_hotel_checkout_without_year_follows_the_explicit_checkin_year(text,expected_in,expected_out):
    from datetime import date
    from app.agents.stay_dates import stay_is_grounded
    assert stay_is_grounded(date.fromisoformat(expected_in),date.fromisoformat(expected_out),[msg(text)],{})


@pytest.mark.parametrize('text',['先不查酒店了','不用查酒店','取消酒店查询','Stop searching for hotels'])
def test_stopping_a_supplier_search_does_not_start_another_query(text):
    assert not wants_supplier_search([msg('帮我查杭州酒店'),ChatMessage(role='assistant',content='哪天入住？'),msg(text)])


@pytest.fixture
async def api(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');factory=async_sessionmaker(engine,expire_on_commit=False)
    for module in ['app.api.routes','app.api.workspace_routes']:
        monkeypatch.setattr(module+'.SessionLocal',factory)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    advice=AsyncMock(return_value='### D1 哈尔滨\n- 新的安排')
    app=FastAPI();orchestrator=SimpleNamespace(travel_advice=advice)
    app.include_router(build_router(orchestrator));app.include_router(build_workspace_router(orchestrator))
    plan={'trip_id':'qa-trip','requirement':{'origin':'温州','destination':'哈尔滨','start_date':'2026-12-01','days':3,'travelers':2,'budget_cny':10000},
          'itinerary':[{'day':day,'date':f'2026-12-0{day}','title':'哈尔滨','activities':['旧的安排'],'notes':[]} for day in range(1,4)],
          'costs':[],'total_cost_cny':0,'remaining_budget_cny':10000,'verification':{'status':'WARNING','issues':[]}}
    snapshot={'days':[{'day':day,'title':'哈尔滨','items':['旧的安排']} for day in range(1,4)],'updated_at':'original'}
    async with factory() as session:
        session.add(ConversationRecord(id='qa',title='qa',messages=[{'role':'user','content':BASE},{'role':'assistant','content':'需求已记录。'}]))
        session.add(TripRecord(id='qa-trip',trace_id='qa',request_text='qa-only',payload=deepcopy(plan)))
        session.add(ConversationState(id='qa',payload={'trip_id':'qa-trip','itinerary':deepcopy(snapshot),'requirements':deepcopy(plan['requirement']),'budget_limit':10000}))
        await session.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        yield client,factory,advice,snapshot
    await engine.dispose()


async def turn(client,text):
    detail=(await client.get('/api/v1/conversations/qa')).json()
    response=await client.post('/api/v1/trips/intake',json={'conversation_id':'qa','messages':detail['messages']+[{'role':'user','content':text}]})
    assert response.status_code==200
    return response.json()


@pytest.mark.asyncio
async def test_undoing_requirements_clears_a_false_pending_revision(api):
    client,_,_,snapshot=api
    await turn(client,'预算改成5000元')
    result=await turn(client,'撤销刚才的修改')
    assert result['collected']['budget_cny']==10000
    assert not result['itinerary'].get('pending_revision')
    assert result['itinerary']['days']==snapshot['days']
    assert not result['ready'] and result['trip_request'] is None


@pytest.mark.asyncio
async def test_legacy_undo_without_a_snapshot_does_not_rewrite_conditions_on_the_next_turn(api):
    client,_,_,snapshot=api
    result=await turn(client,'撤销刚才的修改')
    assert '没有可恢复' in result['reply']
    assert result['collected']['destination']=='哈尔滨' and result['itinerary']==snapshot
    detail=(await client.get('/api/v1/conversations/qa')).json()
    # Old clients may omit the returned marker; the server retains its authoritative copy.
    messages=[{key:value for key,value in message.items() if key!='undo_ignored'} for message in detail['messages']]
    response=await client.post('/api/v1/trips/intake',json={'conversation_id':'qa','messages':messages+[{'role':'user','content':'预算改成5000元','undo_ignored':True}]})
    assert response.status_code==200
    assert response.json()['collected']['destination']=='哈尔滨' and response.json()['collected']['budget_cny']==5000


@pytest.mark.asyncio
async def test_undo_restores_the_previous_actual_day_content_and_keeps_budget(api):
    client,_,_,snapshot=api
    await turn(client,'预算改成5000元')
    result=await turn(client,'把第二天的安排改成轻松一些')
    assert result['itinerary']['days'][0]['items']==['新的安排']
    result=await turn(client,'撤销刚才的修改')
    assert result['collected']['budget_cny']==5000
    assert result['itinerary']['days']==snapshot['days']


@pytest.mark.asyncio
async def test_reset_does_not_feed_old_plan_days_into_a_new_trip(api):
    client,_,advice,_=api
    await turn(client,'之前的条件都作废，重新开始')
    result=await turn(client,'新行程的第二天安排什么？')
    context=advice.call_args.kwargs['workspace_context']
    assert context['days']==[] and context['selected']==[]
    assert context['requirement']['destination'] is None
    assert result['itinerary']['days'][0]['items']==['旧的安排']


@pytest.mark.asyncio
async def test_new_trip_advice_does_not_relabel_old_trip_prices_and_dates(api):
    client,_,_,_=api
    await turn(client,'之前的条件都作废，重新开始')
    await turn(client,'我想去成都')
    await turn(client,'新旅行第二天怎么玩？')
    workspace=(await client.get('/api/v1/conversations/qa/workspace')).json()
    assert workspace['plan'] is None
    assert workspace['itinerary']['incomplete']
    assert workspace['budget']['budget_cny'] is None


@pytest.mark.asyncio
async def test_paused_trip_does_not_publish_day_changes_before_resume(api):
    client,_,advice,snapshot=api
    await turn(client,'取消这趟旅行')
    result=await turn(client,'把第二天的安排改成轻松一些')
    assert result['itinerary']['days']==snapshot['days']
    advice.assert_not_called()
    resumed=await turn(client,'恢复行程规划')
    assert not resumed['itinerary'].get('pending_revision') and not resumed['ready']


@pytest.mark.asyncio
async def test_delayed_plan_save_cannot_undo_a_reset_or_overwrite_new_requirements(api):
    client,_,_,_=api
    await turn(client,'之前的条件都作废，重新开始')
    response=await client.put('/api/v1/conversations/qa/workspace/plan',json={'trip_id':'qa-trip'})
    assert response.status_code==409


@pytest.mark.asyncio
async def test_cancel_status_is_visible_without_marking_saved_plan_as_active(api):
    client,_,_,_=api
    result=await turn(client,'取消这趟旅行')
    assert not result['ready']
    assert result['itinerary'].get('planning_status')=='cancelled'
    assert '规划已暂停' in (await client.get('/api/v1/conversations/qa/workspace/export')).text


@pytest.mark.asyncio
async def test_changed_budget_is_current_even_while_previous_plan_is_pending(api):
    client,_,_,_=api
    await turn(client,'预算改成5000元')
    workspace=(await client.get('/api/v1/conversations/qa/workspace')).json()
    assert workspace['budget']['budget_cny']==5000
    assert workspace['plan']['requirement']['budget_cny']==10000


@pytest.mark.asyncio
async def test_reset_combined_with_new_trip_does_not_mix_new_selection_costs_into_old_plan(api):
    client,sessions,_,_=api
    await turn(client,'重新开始，从杭州去苏州，2027-01-02出发，2天，1人，总预算2000元，希望园林')
    async with sessions() as session:
        state=await session.get(ConversationState,'qa')
        state.payload={**state.payload,'selections':[{'id':'s','candidate_id':'s','category':'other','provider':'test','title':'新旅行候选','unit_price_cny':50,'quantity':1}]}
        await session.commit()
    workspace=(await client.get('/api/v1/conversations/qa/workspace')).json()
    assert workspace['itinerary']['previous_trip']
    assert workspace['budget']['budget_cny']==2000 and workspace['budget']['selected_total_cny']==50
    assert workspace['plan']['total_cost_cny']==0


def test_partial_day_revision_never_silently_removes_the_last_requested_day():
    from app.agents.conversation_state import update_itinerary
    previous={'days':[{'day':day,'title':'旧版','items':['旧安排']} for day in range(1,4)]}
    result=update_itinerary(previous,'### D1 新版\n- 新安排\n### D2 新版\n- 新安排',expected_days=3)
    assert len(result['days'])==3 and result['days'][2]['items']==['旧安排']
    shorter=update_itinerary(previous,'### D1 新版\n- 新安排\n### D2 新版\n- 新安排',expected_days=2)
    assert len(shorter['days'])==2


def test_new_incomplete_advice_is_marked_incomplete_without_changing_expected_duration():
    from app.agents.conversation_state import update_itinerary
    result=update_itinerary(None,'### D1 只有一天\n- 活动',expected_days=3)
    assert result['incomplete']


@pytest.mark.asyncio
async def test_undoing_reset_restores_plan_and_selections_without_rewriting_chat(api):
    client,sessions,_,snapshot=api
    selection={'id':'s','candidate_id':'s','category':'other','provider':'test','title':'旧候选','unit_price_cny':10,'quantity':1}
    async with sessions() as session:
        state=await session.get(ConversationState,'qa');state.payload={**state.payload,'selections':[selection]};await session.commit()
    reset=await turn(client,'之前的条件都作废，重新开始')
    assert reset['itinerary']['previous_trip']
    assert (await client.get('/api/v1/conversations/qa/workspace')).json()['selections']==[]
    undo=await turn(client,'撤销刚才的修改')
    assert undo['itinerary']==snapshot
    workspace=(await client.get('/api/v1/conversations/qa/workspace')).json()
    assert workspace['plan']['trip_id']=='qa-trip' and workspace['selections'][0]['id']=='s'
    assert len((await client.get('/api/v1/conversations/qa')).json()['messages'])==6


@pytest.mark.asyncio
async def test_day_content_change_is_not_still_verified_as_pass(api):
    client,sessions,_,_=api
    async with sessions() as session:
        trip=await session.get(TripRecord,'qa-trip');trip.payload={**trip.payload,'verification':{'status':'PASS','issues':[]}};await session.commit()
    await turn(client,'把第二天的安排改成轻松一些')
    workspace=(await client.get('/api/v1/conversations/qa/workspace')).json()
    assert workspace['plan']['verification']['status']=='WARNING'
    assert any(issue['code']=='ITINERARY_REVISED' for issue in workspace['plan']['verification']['issues'])
    async with sessions() as session:assert (await session.get(TripRecord,'qa-trip')).payload['verification']['status']=='PASS'


@pytest.mark.asyncio
async def test_retrying_the_same_plan_save_does_not_overwrite_later_day_edits(api):
    client,_,_,_=api
    first=await client.put('/api/v1/conversations/qa/workspace/plan',json={'trip_id':'qa-trip'})
    assert first.status_code==200
    changed=await turn(client,'把第二天的安排改成轻松一些')
    retry=await client.put('/api/v1/conversations/qa/workspace/plan',json={'trip_id':'qa-trip'})
    assert retry.status_code==200
    assert retry.json()['itinerary']['days']==changed['itinerary']['days']


@pytest.mark.asyncio
async def test_supplier_receives_a_complete_query_after_short_date_followup():
    model=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=json.dumps({
        'action':'search','city':'杭州','category':'hotel','check_in':'2099-01-02','check_out':'2099-01-04','providers':['fliggy']}))))
    gateway=SimpleNamespace(search=AsyncMock(return_value={'provider':'fliggy','items':[],'text':'','notice':''}))
    orchestrator=SimpleNamespace(model_gateway=model,travel_gateway=gateway,settings=SimpleNamespace(fliggy_api_key='test',meituan_ht_token=''))
    messages=[msg('帮我查杭州酒店'),ChatMessage(role='assistant',content='你准备哪天入住、哪天退房？'),msg('2099-01-02入住，2099-01-04退房')]
    result=await supplier_reply(orchestrator,messages)
    assert result is not None
    gateway.search.assert_awaited_once()
    query=gateway.search.call_args.args[2]
    assert '酒店' in query and '2099-01-02' in query and '2099-01-04' in query
