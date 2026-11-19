import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.agents.conversation_state import update_itinerary
from app.api.routes import build_router
from app.database.db import Base, ConversationState


@pytest.mark.asyncio
async def test_beach_trip_keeps_city_and_waits_for_choices_and_allergy_details(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal', sessions)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    app = FastAPI()
    advice = AsyncMock()
    app.include_router(build_router(SimpleNamespace(travel_advice=advice)))
    departure = datetime.now(timezone(timedelta(hours=8))).date() + timedelta(days=60)
    initial_turns = [
        ('我打算在这个冬天去三亚，你觉得呢？', '你更想偏海边度假，还是多逛吃和景点？'),
        ('那必须是去海滩度假', '你更偏安静泡酒店沙滩，还是每天玩点水上项目？'),
        ('就我一个人去，你来推荐', '可以住大东海。'),
        ('我想体验潜水', '你这次打算在三亚住几晚？'),
        ('额，4天', '你从哪里出发？说个城市名就行，比如杭州。'),
        ('玉环', '计划哪天出发？请告诉我具体日期，例如11月20日。'),
        (f'{departure:%y}年{departure.month}月{departure.day}号', '这次旅行的总预算大约是多少元？'),
        ('7万', '还有哪些偏好或必须遵守的条件？如果没有，回复“没有”即可。'),
    ]
    messages = [
        {'role': role, 'content': content}
        for user, assistant in initial_turns
        for role, content in (('user', user), ('assistant', assistant))
    ]
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            conversation = (await client.post('/api/v1/conversations', json={'title': '三亚度假'})).json()
            conversation_id = conversation['id']
            url = f'/api/v1/conversations/{conversation_id}'
            for answer, expected_missing in [
                ('额，我是高度近视+易过敏体至', ['lodging', 'transport', 'dining', 'activities', 'allergy_detail']),
                ('酒店想住海边，飞机，想看日落', ['dining', 'allergy_detail']),
                ('你来安排', ['allergy_detail']),
                ('我对虾蟹过敏', []),
            ]:
                messages.append({'role': 'user', 'content': answer})
                payload = {'conversation_id': conversation_id, 'messages': messages}
                response = await client.post('/api/v1/trips/intake/stream', json=payload)
                assert response.status_code == 200
                events = [json.loads(line) for line in response.text.splitlines()]
                result = next(event['intake'] for event in events if event['type'] == 'result')
                assert result['missing'] == expected_missing
                restored = (await client.get(url)).json()
                assert result['ready'] == restored['ready'] == (not expected_missing)
                assert restored['trip_request'] == result['trip_request']
                if expected_missing:
                    assert '潜水先保留为待确认项目' in result['reply']
                messages = restored['messages']
            trip = restored['trip_request']
            assert (trip['origin'], trip['destination'], trip['days'], trip['travelers'], trip['budget_cny']) == ('玉环', '三亚', 4, 1, 70000)
            assert trip['start_date'] == departure.isoformat()
            assert {'我想体验潜水', '飞机', '想看日落', '酒店想住海边'} <= set(trip['preferences'])
            assert '我是高度近视+易过敏体质' in trip['hard_constraints']
            assert '我对虾蟹过敏' in trip['hard_constraints']
            assert any('潜水适宜性待确认' in value for value in trip['hard_constraints'])
            advice.assert_not_awaited()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_automatic_conversation_title_and_manual_override(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal', sessions)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    generate = AsyncMock(return_value=SimpleNamespace(content='哈尔滨冬季美食行程'))
    app = FastAPI()
    app.include_router(build_router(SimpleNamespace(
        model_gateway=SimpleNamespace(generate_fast=generate),
        travel_advice=AsyncMock(return_value='可以安排三天。'),
    )))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            conversation = (await client.post('/api/v1/conversations', json={'title':'新对话'})).json()
            url = f"/api/v1/conversations/{conversation['id']}"
            original = '我打算在这个冬天去哈尔滨吃好吃的，你觉得呢？'
            messages = [{'role':'user','content':original}]
            request = {'conversation_id':conversation['id'],'messages':messages}
            assert (await client.post('/api/v1/trips/intake', json=request)).status_code == 200
            detail = (await client.get(url)).json()
            assert detail['title'] == '哈尔滨冬季美食行程'
            assert original in generate.await_args.args[0][1]['content']
            await client.patch(url, json={'title':'我的冬季假期'})
            request['messages'] = [*detail['messages'], {'role':'user','content':'再说说当地特色。'}]
            assert (await client.post('/api/v1/trips/intake', json=request)).status_code == 200
            assert (await client.get(url)).json()['title'] == '我的冬季假期'
            generate.assert_awaited_once()
    finally:
        await engine.dispose()


def test_daily_revision_preserves_other_days_and_shorter_plan_replaces_trailing_days():
    original = update_itinerary(None, '### D1｜A → B\n- Museum\n### D2｜B → C\n- Park\n### D3｜C → D\n- Return')
    changed = update_itinerary(original, '### Day 2: B → C\n- Rest\n## Notes\n- Not a day activity')
    assert [day['items'] for day in changed['days']] == [['Museum'], ['Rest'], ['Return']]
    assert original['days'][1]['items'] == ['Park']
    shortened = update_itinerary(changed, '### 第1天 A\n- Walk\n### 第2天 B\n- Finish')
    assert [day['day'] for day in shortened['days']] == [1, 2]


def test_prose_and_invalid_day_headings_do_not_claim_a_successful_update():
    previous = update_itinerary(None, '### D1 Route\n- Visit')
    assert update_itinerary(None, 'I recommend a three-day trip.') is None
    assert update_itinerary(previous, '### D1\nPlease provide more details.') is previous
    assert update_itinerary(previous, '### D99 Invalid\n- Ignore') is previous
    assert update_itinerary(None, '### Day 1\n- Museum')['days'][0]['items'] == ['Museum']


@pytest.mark.asyncio
async def test_conversation_isolation_rename_survives_replies_and_delete_cleans_metadata(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal', sessions)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    replies = iter(['### Day 1: Lanzhou\n- Museum\n### Day 2: Yuhuan\n- Beach',
                    '### Day 2: Yuhuan\n- Seafood lunch', 'Could you clarify the change?'])

    async def advise(messages, **kwargs):
        assert kwargs['language'] == 'en'
        reply = next(replies)
        await kwargs['token_callback'](reply[:10])
        return reply

    app = FastAPI()
    app.include_router(build_router(SimpleNamespace(travel_advice=advise)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        a = (await client.post('/api/v1/conversations', json={'title':'A'})).json()['id']
        b = (await client.post('/api/v1/conversations', json={'title':'B'})).json()['id']
        assert (await client.patch(f'/api/v1/conversations/{a}', json={'title':'  My road trip  '})).json()['title'] == 'My road trip'
        assert (await client.patch(f'/api/v1/conversations/{a}', json={'title':'  '})).status_code == 422
        messages = []
        for text in ['Suggest activities for two days', 'Change day 2', 'Change the activities']:
            messages.append({'role':'user','content':text})
            response = await client.post('/api/v1/trips/intake/stream', json={'conversation_id':a,'language':'en','messages':messages})
            events = [json.loads(line) for line in response.text.splitlines()]
            assert any(event['type'] == 'delta' for event in events)
            result = next(event['intake'] for event in events if event['type'] == 'result')
            messages.append({'role':'assistant','content':result['reply']})
        detail = (await client.get(f'/api/v1/conversations/{a}')).json()
        assert detail['title'] == 'My road trip'
        assert detail['itinerary']['days'][1]['items'] == ['Seafood lunch']
        assert detail['itinerary']['pending_revision'] is True
        assert (await client.get(f'/api/v1/conversations/{b}')).json()['itinerary'] is None
        saved = await client.put(f'/api/v1/conversations/{a}/itinerary', json={'days':[{'day':1,'title':'New plan','items':['Walk']}]})
        assert saved.status_code == 200
        assert 'pending_revision' not in saved.json()
        assert (await client.get(f'/api/v1/conversations/{a}')).json()['title'] == 'My road trip'
        assert (await client.delete(f'/api/v1/conversations/{a}')).status_code == 204
        async with sessions() as session:
            assert await session.get(ConversationState, a) is None
    await engine.dispose()
