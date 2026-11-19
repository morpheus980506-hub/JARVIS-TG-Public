import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.api.routes import build_router
from app.agents.intake import format_trip_memory
from app.agents.dining import dining_constraints
from app.schemas.domain import ChatMessage

BASE='从温州去哈尔滨玩，2026-12-01出发，3天，1人，预算10000元，希望美食'

@pytest.fixture
async def sessions(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');factory=async_sessionmaker(engine,expire_on_commit=False)
    from app.database.db import Base
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    monkeypatch.setattr('app.api.routes.SessionLocal',factory)
    yield factory
    await engine.dispose()


def test_smalltalk_does_not_erase_full_travel_memory():
    facts,_=format_trip_memory([ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='已记录'),ChatMessage(role='user',content='你好')])
    assert facts['destination']=='哈尔滨' and facts['budget_cny']==10000


def test_latest_dietary_permission_overrides_an_older_restriction():
    messages=[ChatMessage(role='user',content='素食，不吃锅包肉'),ChatMessage(role='assistant',content='已记录'),ChatMessage(role='user',content='不需要素食了，现在可以吃锅包肉，推荐餐厅')]
    banned,diet,_=dining_constraints(messages)
    assert not banned and diet is None


@pytest.mark.parametrize('change,key,expected',[
    ('再多玩两天','days',5),('少玩一天','days',2),('再加一个朋友','travelers',2),
    ('2大1小','travelers',3),('2个大人和1个孩子','travelers',3),
    ('日期改成下周五','start_date',None),
])
def test_relative_edits_and_unparsed_dates_never_silently_use_old_values(change,key,expected):
    from app.agents.intake import collect_trip_intake
    response=collect_trip_intake([ChatMessage(role='user',content=BASE),ChatMessage(role='user',content=change)])
    assert response.collected[key]==expected


def test_per_person_budget_is_not_mistaken_for_the_group_total():
    from app.agents.intake import collect_trip_intake
    history=[ChatMessage(role='user',content=BASE),ChatMessage(role='user',content='2人，人均预算2000元')]
    assert collect_trip_intake(history).trip_request.budget_cny==4000
    history.append(ChatMessage(role='user',content='3人'))
    assert collect_trip_intake(history).trip_request.budget_cny==6000
    history.append(ChatMessage(role='user',content='总预算改成5000元'))
    assert collect_trip_intake(history).trip_request.budget_cny==5000
    for text,expected in [('2人，人均预算两千元',4000),('2人，人均预算2000.50元',4001)]:
        assert collect_trip_intake([ChatMessage(role='user',content=BASE),ChatMessage(role='user',content=text)]).trip_request.budget_cny==expected
    ambiguous=collect_trip_intake([ChatMessage(role='user',content=BASE),ChatMessage(role='user',content='每人每天预算200元')])
    assert not ambiguous.ready and 'budget_cny' in ambiguous.missing


@pytest.mark.asyncio
async def test_a_slow_old_reply_cannot_overwrite_a_newer_turn(sessions):
    started=asyncio.Event();release=asyncio.Event()
    async def slow(*args,**kwargs):
        started.set();await release.wait();return '迟到的旧回复'
    app=FastAPI();app.include_router(build_router(SimpleNamespace(travel_advice=slow)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        first={'role':'user','content':'请讲个旅行笑话'}
        task=asyncio.create_task(client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':[first]}))
        await asyncio.wait_for(started.wait(),1)
        second=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[first,{'role':'user','content':'你好'}]})
        assert second.status_code==200
        release.set();old=await task
        events=[json.loads(line) for line in old.text.splitlines()]
        assert any(event.get('code')==409 for event in events)
        saved=(await client.get('/api/v1/conversations/'+id)).json()
        assert saved['messages'][-1]['content']==second.json()['reply']
        assert not any(message['content']=='迟到的旧回复' for message in saved['messages'])
        assert saved['reply_status']=='complete'


@pytest.mark.asyncio
async def test_stale_tab_and_deleted_conversation_do_not_lose_history_or_call_a_model(sessions):
    model=AsyncMock(side_effect=AssertionError('Must not call provider'))
    app=FastAPI();app.include_router(build_router(SimpleNamespace(travel_advice=model)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        first=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':'你好'}]})
        assert first.status_code==200
        stale=await client.post('/api/v1/trips/intake/stream',json={'conversation_id':id,'messages':[{'role':'user','content':'过期窗口的问题'}]})
        assert stale.status_code==409
        saved=(await client.get('/api/v1/conversations/'+id)).json()
        assert saved['messages'][0]['content']=='你好' and len(saved['messages'])==2
        await client.delete('/api/v1/conversations/'+id)
        missing=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':'已删除的问题'}]})
        assert missing.status_code==404
        model.assert_not_called()


@pytest.mark.asyncio
async def test_greeting_keeps_ready_request_available_after_restore(sessions):
    app=FastAPI();app.include_router(build_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        first=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':[{'role':'user','content':BASE}]})
        history=[{'role':'user','content':BASE},{'role':'assistant','content':first.json()['reply']},{'role':'user','content':'你好'}]
        greeting=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':history})
        assert greeting.json()['ready']
        assert greeting.json()['collected']['destination']=='哈尔滨'
        saved=(await client.get('/api/v1/conversations/'+id)).json()
        assert saved['ready'] and saved['trip_request']['destination']=='哈尔滨'


@pytest.mark.asyncio
async def test_initial_question_is_saved_before_the_reply_connection_is_started(sessions):
    app=FastAPI();app.include_router(build_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        created=await client.post('/api/v1/conversations',json={'title':'新对话','message':{'role':'user','content':'你好'}})
        saved=(await client.get('/api/v1/conversations/'+created.json()['id'])).json()
        assert saved['messages'][0]['content']=='你好' and saved['messages'][0]['created_at']
        assert saved['reply_status']=='stopped'
        resumed=await client.post('/api/v1/trips/intake',json={'conversation_id':saved['id'],'messages':saved['messages']})
        assert resumed.status_code==200
