from types import SimpleNamespace
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.agents.intake import collect_trip_intake,classify_conversation_mode
from app.agents.planner import PlannerAgent
from app.schemas.domain import ChatMessage,TripRequest
from app.api.workspace_routes import build_workspace_router
from app.database.db import Base,ConversationRecord,TripRecord


@pytest.mark.parametrize('answer',['哈尔滨','哈尔滨吧','那就哈尔滨吧','就去哈尔滨呗','哈尔滨好了','哈尔滨呀！'])
def test_region_is_clarified_and_city_answer_preserves_other_requirements(answer):
    messages=[ChatMessage(role='user',content='从温州去东北玩，2099-12-01出发，3天，1人，预算10000元，希望吃美食')]
    response=collect_trip_intake(messages)
    assert not response.ready and response.missing==['destination']
    messages.extend([ChatMessage(role='assistant',content=response.reply),ChatMessage(role='user',content=answer)])
    assert classify_conversation_mode(messages)=='planning'
    fixed=collect_trip_intake(messages)
    assert fixed.ready and fixed.trip_request.destination=='哈尔滨'
    assert fixed.trip_request.origin=='温州' and fixed.trip_request.days==3
    assert fixed.trip_request.budget_cny==10000 and fixed.trip_request.start_date.isoformat()=='2099-12-01'
    assert 'Agent' not in fixed.reply


@pytest.mark.asyncio
async def test_direct_plan_cannot_query_a_region_as_a_city():
    with pytest.raises(ValueError,match='具体城市'):
        await PlannerAgent().execute({'request':TripRequest(text='旅行',origin='温州',destination='东北',start_date='2099-12-01',days=3,budget_cny=10000)})


@pytest.mark.asyncio
@pytest.mark.parametrize('language,with_stops,expected',[('zh',True,'行程已生成并保存'),('zh',False,'行程草案已保存'),('en',True,'Itinerary saved')])
async def test_attached_plan_leaves_one_persistent_completion_message_on_retries(monkeypatch,language,with_stops,expected):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    payload={'requirement':{'origin':'温州','destination':'哈尔滨','start_date':'2099-12-01','days':1,'travelers':1,'budget_cny':10000},
             'itinerary':[{'day':1,'title':'美食漫步','date':'2099-12-01','activities':['中央大街'],'notes':[],
                           'stops':[{'name':'中央大街'}] if with_stops else []}], 'costs':[]}
    async with sessions() as session:
        session.add_all([ConversationRecord(id='c',title='Trip',messages=[{'role':'user','content':'生成吧'}]),TripRecord(id='p',trace_id='trace',request_text='test',payload=payload)])
        await session.commit()
    app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        for _ in range(2):
            response=await client.put('/api/v1/conversations/c/workspace/plan',json={'trip_id':'p','language':language})
            assert response.status_code==200
            assert expected in response.json()['plan_feedback']['text']
        restored=(await client.get('/api/v1/conversations/c/workspace')).json()
        async with sessions() as session:
            conversation=await session.get(ConversationRecord,'c')
            assert len(conversation.messages)==2
            assert conversation.messages[-1]['content']==restored['plan_feedback']['text']
            assert conversation.messages[-1]['created_at']==restored['plan_feedback']['created_at']
            assert 'D1' in conversation.messages[-1]['content']
    await engine.dispose()
