import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from datetime import date, datetime, timezone
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.agents.intake import collect_trip_intake,classify_conversation_mode
from app.agents.dining import dining_reply,is_dining_request
from app.agents.itinerary import ItineraryAgent
from app.agents.message_history import model_history
from app.schemas.domain import ChatMessage,Requirement,TransportOption,SourceFact
from app.database.db import Base,ConversationState
from app.api.routes import build_router
from app.api.workspace_routes import build_workspace_router
from app.database.db import TripRecord
from app.tools.providers.amap import AmapProvider

BASE='从温州去哈尔滨玩，2026-12-01出发，3天，1人，预算10000元，希望美食'
def messages(change):return [ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='我已整理好，总预算10000元，点击生成行程。'),ChatMessage(role='user',content=change)]

@pytest.mark.parametrize('change,key,expected',[
    ('日期改成12月5日','start_date','2026-12-05'),('不玩3天了，改成5天','days',5),
    ('再加一个朋友，现在2人','travelers',2),('预算改成5000元','budget_cny',5000),
    ('不去哈尔滨了，改去成都吧','destination','成都'),('我不去哈尔滨了','destination',None),
    ('改成从杭州出发','origin','杭州'),('改成五天吧','days',5),('改到2027年1月2日出发','start_date','2027-01-02'),
])
def test_latest_user_edits_win_without_resurrecting_old_values(change,key,expected):
    response=collect_trip_intake(messages(change))
    assert response.collected[key]==expected


def test_multi_field_edit_never_uses_date_as_money():
    response=collect_trip_intake(messages('日期改成12月5日，改成5天，2人，预算5000元'))
    assert response.ready
    assert response.trip_request.start_date==date(2026,12,5)
    assert response.trip_request.days==5 and response.trip_request.travelers==2 and response.trip_request.budget_cny==5000
    decimal=collect_trip_intake(messages('预算改成1234.56元'))
    assert decimal.trip_request.budget_cny==1234.56 and decimal.trip_request.start_date==date(2026,12,1)


def test_flight_date_edit_stays_in_flight_lookup_instead_of_requesting_trip_budget():
    history=[ChatMessage(role='user',content='查询从北京大兴到上海虹桥的航班'),ChatMessage(role='assistant',content='计划哪天出发？'),ChatMessage(role='user',content='日期改成2026年12月5日')]
    assert classify_conversation_mode(history)=='advisor'
    assert collect_trip_intake(history).collected['start_date']=='2026-12-05'


def test_relative_date_uses_original_timestamp_across_midnight_and_recovery(monkeypatch):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 9, 17, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr("app.agents.intake.datetime", FrozenDateTime)
    response=collect_trip_intake([ChatMessage(role='user',content=BASE.replace('2026-12-01','明天'),created_at='2026-11-09T12:36:00+08:00'),ChatMessage(role='user',content='预算不变')])
    assert response.collected['start_date']=='2026-11-10'


@pytest.mark.parametrize('answer',['都行吧','你决定吧','随便','哈尔滨或者长春吧'])
def test_uncertain_answers_never_complete_a_city_slot(answer):
    response=collect_trip_intake([ChatMessage(role='user',content=BASE.replace('哈尔滨','江西')),ChatMessage(role='assistant',content='你想去哪个城市？'),ChatMessage(role='user',content=answer)])
    assert not response.ready


def test_complete_english_requirement_produces_same_structured_request():
    history=[ChatMessage(role='user',content='Plan a 3-day trip from Wenzhou to Harbin, starting 2026-12-01, 1 traveler, total budget CNY 10000. Focus on food.')]
    assert classify_conversation_mode(history)=='planning'
    response=collect_trip_intake(history,'en')
    assert response.ready and response.trip_request.origin=='Wenzhou' and response.trip_request.destination=='Harbin'
    assert response.trip_request.days==3 and response.trip_request.budget_cny==10000


@pytest.mark.parametrize('value,field',[('0人','travelers'),('0天','days'),('预算0元','budget_cny')])
def test_invalid_input_has_field_specific_feedback(value,field):
    result=collect_trip_intake(messages(value))
    assert not result.ready and field in result.missing and '暂时无法处理' not in result.reply


def test_long_assistant_history_is_accepted_and_model_context_is_bounded():
    history=[ChatMessage(role='assistant',content='详细安排。'*850),ChatMessage(role='user',content='第二天轻松点')]
    assert len(history[0].content)>4000
    prompt=model_history(history*10)
    assert sum(len(item['content']) for item in prompt)<=24000
    assert prompt[-1]['content']=='第二天轻松点'


@pytest.mark.asyncio
async def test_vegetarian_request_does_not_search_for_rejected_pork_dish():
    pork=SourceFact(name='锅包肉店',value='普通餐饮',source_url='https://uri.amap.com/marker?a=1')
    vegan=SourceFact(name='素食餐厅',value='地址：测试路',source_url='https://uri.amap.com/marker?a=2')
    gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[pork,vegan])),tavily=None)
    response=await dining_reply(gateway,messages('不要锅包肉了，推荐素食餐厅'),'哈尔滨','zh',AsyncMock())
    assert '素食餐厅' in response and '锅包肉店' not in response
    query=gateway.amap.search_poi.call_args.args[0]
    assert '素食' in query and '锅包肉' not in query


@pytest.mark.asyncio
async def test_replace_restaurant_keeps_lookup_scope_and_excludes_previous_option():
    previous=SourceFact(name='老厨家(中央大街店)',value='地址：测试',source_url='https://uri.amap.com/marker?a=1')
    other=SourceFact(name='另一家餐厅',value='地址：测试',source_url='https://uri.amap.com/marker?a=2')
    history=[ChatMessage(role='assistant',content='餐厅：老厨家(中央大街店)。'),ChatMessage(role='user',content='换一家，不要这家')]
    assert is_dining_request(history)
    response=await dining_reply(SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[previous,other])),tavily=None),history,'哈尔滨','zh',AsyncMock())
    assert '另一家餐厅' in response and '老厨家' not in response
    assert 'D1' not in response


@pytest.mark.asyncio
async def test_late_arrival_and_unknown_route_do_not_produce_fixed_activity_promises():
    req=Requirement(origin='温州',destination='杭州',start_date=date(2026,12,1),days=3,travelers=2,budget_cny=6000)
    transport=[TransportOption(mode='train',service_number='T1',provider='test',departure_name='温州',arrival_name='杭州',departure_time='2026-12-01 22:00:00',arrival_time='2026-12-01 23:23:00',source_url='https://example.com',duration_minutes=83)]
    facts=[SourceFact(name='地点'+str(i),value='地址',source_url=f'https://uri.amap.com/marker?position={120+i/10},30') for i in range(3)]
    state={'requirement':req,'transport':transport,'research':facts,'tool_gateway':SimpleNamespace(amap=SimpleNamespace(route=AsyncMock(side_effect=RuntimeError('unavailable'))))}
    plan=(await ItineraryAgent().execute(state))['itinerary']
    assert not any(item=='品尝当地特色晚餐' for item in plan[0].activities)
    assert len(plan[1].stops)==1
    assert not any(item.startswith('14:00') for item in plan[1].activities)
    assert any('尚未核验' in item for item in plan[1].activities)


@pytest.mark.asyncio
async def test_ready_request_and_long_history_survive_api_restore(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    app=FastAPI();app.include_router(build_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        response=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'assistant','content':'详细安排。'*850},{'role':'user','content':BASE}]})
        assert response.status_code==200 and response.json()['ready']
        restored=(await client.get('/api/v1/conversations/'+id)).json()
        assert restored['ready'] and restored['trip_request']['budget_cny']==10000
        assert restored['reply_status']=='complete'
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancelled_reply_keeps_user_input_and_marks_incomplete(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    async def cancel(*args,**kwargs):raise asyncio.CancelledError()
    app=FastAPI();app.include_router(build_router(SimpleNamespace(travel_advice=cancel)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        response=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':[{'role':'user','content':'推荐周末适合放松的地方'}]})
        assert response.status_code==200
        saved=(await client.get('/api/v1/conversations/'+id)).json()
        assert saved['messages'][-1]['role']=='user' and saved['reply_status']=='stopped'
        assert saved['messages'][-1]['created_at']
    await engine.dispose()


@pytest.mark.asyncio
async def test_meal_candidate_is_requested_around_the_actual_scheduled_stop():
    req=Requirement(origin='温州',destination='杭州',start_date=date(2026,12,1),days=3,travelers=2,budget_cny=6000,preferences=['美食'])
    meal=SourceFact(name='当天景点旁餐厅',value='地址：附近',source_url='https://uri.amap.com/marker?position=120,30')
    meal_route = {'route': {'paths': [{'distance': '500', 'cost': {'duration': '480'}}]}}
    amap=SimpleNamespace(search_poi=AsyncMock(return_value=[meal]),route=AsyncMock(side_effect=[RuntimeError(), meal_route]))
    facts=[SourceFact(name='景点'+str(i),value='地点',source_url=f'https://uri.amap.com/marker?position={120+i/10},30') for i in range(2)]
    plans=(await ItineraryAgent().execute({'requirement':req,'research':facts,'tool_gateway':SimpleNamespace(amap=amap)}))['itinerary']
    assert amap.search_poi.call_args.kwargs['location']==(120,30)
    assert '当天景点旁餐厅' in '\n'.join(plans[1].activities)
    assert '当天景点旁餐厅' not in '\n'.join(plans[2].activities)


@pytest.mark.asyncio
async def test_nearby_restaurant_provider_uses_radius_and_coordinate_precision():
    def handler(request):
        assert request.url.path=='/v5/place/around'
        assert request.url.params['location']=='120.123457,30.123457'
        assert request.url.params['radius']=='3000' and request.url.params['types']=='050000'
        return httpx.Response(200,json={'status':'1','pois':[]})
    await AmapProvider('fake',transport=httpx.MockTransport(handler)).search_poi('','杭州',types='050000',location=(120.1234567,30.1234567))


@pytest.mark.asyncio
async def test_export_preserves_full_budget_and_unverified_details(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions);monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    plan={'requirement':{'origin':'温州','destination':'杭州','start_date':'2026-12-01','days':1,'travelers':1,'budget_cny':1000},
          'itinerary':[{'day':1,'title':'散步','activities':['公园'],'notes':['开放时间待核对']}],
          'costs':[{'category':'food','description':'餐饮估算','amount_cny':200,'is_estimate':True}],
          'verification':{'status':'WARNING','issues':[{'status':'WARNING','message':'路线未核验'}]}}
    async with sessions() as session:
        session.add(TripRecord(id='p',trace_id='t',request_text='test',payload=plan));await session.commit()
    app=FastAPI();app.include_router(build_router(SimpleNamespace()));app.include_router(build_workspace_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        saved=(await client.put(f'/api/v1/conversations/{id}/workspace/plan',json={'trip_id':'p'})).json()
        assert '待核对' in saved['plan_feedback']['text']
        assert not (await client.get('/api/v1/conversations/'+id)).json()['ready']
        text=(await client.get(f'/api/v1/conversations/{id}/workspace/export')).text
        assert '总预算：¥1000.00' in text and '全行程估算合计：¥200.00' in text
        assert '路线未核验' in text and '开放时间待核对' in text and '已选费用合计：¥0.00' in text
    await engine.dispose()
