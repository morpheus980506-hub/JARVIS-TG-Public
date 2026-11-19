import json
from types import SimpleNamespace
from datetime import datetime,timezone
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.api.routes import build_router
from app.database.db import Base,ConversationRecord


@pytest.mark.asyncio
@pytest.mark.parametrize('stream',[False,True])
async def test_message_times_survive_history_and_old_clients_without_inventing_legacy_times(monkeypatch,stream):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    original=[{'role':'user','content':'旧消息'},{'role':'assistant','content':'旧回复','created_at':'2026-11-08T04:36:00+00:00'}]
    async with sessions() as session:
        session.add(ConversationRecord(id='c',title='Time test',messages=original));await session.commit()
    app=FastAPI();app.include_router(build_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        supplied='2026-11-09T12:36:00+08:00'
        before=datetime.now(timezone.utc)
        history=[{key:value for key,value in item.items() if key!='created_at'} for item in original]
        payload={'conversation_id':'c','messages':[*history,{'role':'user','content':'你好','created_at':supplied}]}
        response=await client.post('/api/v1/trips/intake'+('/stream' if stream else ''),json=payload)
        assert response.status_code==200
        result=next(json.loads(line)['intake'] for line in response.text.splitlines() if json.loads(line)['type']=='result') if stream else response.json()
        reply_time=datetime.fromisoformat(result['reply_created_at'])
        assert before<=reply_time<=datetime.now(timezone.utc)
        saved=(await client.get('/api/v1/conversations/c')).json()['messages']
        assert 'created_at' not in saved[0]
        assert saved[1]['created_at']==original[1]['created_at']
        assert datetime.fromisoformat(saved[2]['created_at'])==datetime.fromisoformat(supplied)
        assert saved[3]['created_at']==result['reply_created_at']
        older_client=[{key:value for key,value in item.items() if key!='created_at'} for item in saved]
        again=await client.post('/api/v1/trips/intake',json={'conversation_id':'c','messages':[*older_client,{'role':'user','content':'你好'}]})
        assert again.status_code==200
        restored=(await client.get('/api/v1/conversations/c')).json()['messages']
        assert 'created_at' not in restored[0]
        assert [message['created_at'] for message in restored[1:4]]==[message['created_at'] for message in saved[1:4]]
        assert datetime.fromisoformat(restored[4]['created_at']).tzinfo is not None
    await engine.dispose()
