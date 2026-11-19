from types import SimpleNamespace
from datetime import datetime,timezone,timedelta
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.api.routes import build_router
from app.api.workspace_routes import build_workspace_router
from app.database.db import Base,ConversationRecord,ConversationState,TripRecord


@pytest.mark.asyncio
async def test_catalog_lists_each_saved_conversation_once_and_restores_legacy_chat_plans(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    now=datetime.now(timezone.utc)
    def trip(id,destination):
        return TripRecord(id=id,trace_id=id,request_text='test',payload={'requirement':{'origin':'温州','destination':destination,'start_date':'2099-12-01','travelers':2}})
    snapshot={'days':[{'day':1,'title':'西湖漫步','items':['西湖']},{'day':2,'title':'返程','items':['回家']}],'updated_at':now.isoformat()}
    async with sessions() as session:
        session.add_all([
            ConversationRecord(id='a',title='杭州游',messages=[],updated_at=now),
            ConversationRecord(id='b',title='成都游',messages=[],updated_at=now-timedelta(hours=1)),
            ConversationRecord(id='legacy',title='旧对话行程',messages=[{'role':'assistant','content':'D1 城市漫步\n- 人民公园\nD2 返程\n- 回家'}],updated_at=now-timedelta(hours=2)),
            ConversationRecord(id='empty',title='闲聊',messages=[{'role':'assistant','content':'你好'}]),
            ConversationState(id='a',payload={'trip_id':'new','requirements':{'destination':'苏州吧'},'itinerary':snapshot}),
            ConversationState(id='b',payload={'trip_id':'second','requirements':{'destination':'重庆'},'itinerary':{**snapshot,'pending_revision':True}}),
            ConversationState(id='deleted',payload={'trip_id':'orphan','itinerary':snapshot}),
            trip('old','北京'),trip('new','杭州'),trip('second','成都'),trip('orphan','兰州'),
        ])
        await session.commit()
    app=FastAPI();fake=SimpleNamespace();app.include_router(build_router(fake));app.include_router(build_workspace_router(fake))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        response=await client.get('/api/v1/itineraries')
        assert response.status_code==200
        entries=response.json()
        assert [item['conversation_id'] for item in entries]==['a','b','legacy']
        assert entries[0]['destination']=='苏州' and entries[0]['days']==2 and entries[0]['travelers']==2
        assert entries[1]['destination']=='成都' and entries[1]['pending_revision']
        assert entries[2]['preview']==['城市漫步','返程']
        assert all('messages' not in item and 'plan' not in item for item in entries)
        detail=(await client.get('/api/v1/conversations/legacy/workspace')).json()
        assert detail['itinerary']['days'][0]['items']==['人民公园']
        assert detail['plan'] is None
        async with sessions() as session:
            assert await session.get(ConversationState,'legacy') is None
        await client.delete('/api/v1/conversations/a')
        remaining=(await client.get('/api/v1/itineraries')).json()
        assert [item['conversation_id'] for item in remaining]==['b','legacy']
    await engine.dispose()
