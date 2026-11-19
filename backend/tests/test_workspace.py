import json
from types import SimpleNamespace
from copy import deepcopy
from decimal import Decimal
import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.database.db import Base,ConversationRecord,ConversationState,TripRecord
from app.api.workspace_routes import build_workspace_router,budget_summary
from app.tools.providers.travel_search import TravelSearchError


@pytest.mark.asyncio
async def test_invalid_saved_draft_has_recovery_state_and_cannot_be_exported(monkeypatch):
    from fastapi import FastAPI

    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal', sessions)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add_all([
            ConversationRecord(id='legacy', title='骑行', messages=[]),
            ConversationState(id='legacy', payload={'trip_id':'legacy-plan'}),
            TripRecord(id='legacy-plan', trace_id='trace', request_text='骑行', payload={
                'requirement': {'origin':'我在兰州新区', 'destination':'骑自行车', 'days':1},
            }),
        ])
        await session.commit()
    app = FastAPI()
    app.include_router(build_workspace_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        workspace = (await client.get('/api/v1/conversations/legacy/workspace')).json()
        assert workspace['invalid_itinerary'] and workspace['plan'] is None and workspace['itinerary'] is None
        assert (await client.get('/api/v1/conversations/legacy/workspace/export')).status_code == 422
    await engine.dispose()


def test_budget_uses_decimal_and_does_not_invent_a_limit():
    summary=budget_summary([{'category':'hotel','unit_price_cny':0.1,'quantity':3}])
    assert summary['selected_total_cny']==0.3 and summary['remaining_cny'] is None
    assert budget_summary([{'category':'hotel','unit_price_cny':20,'quantity':3}],50)['remaining_cny']==-10


@pytest.mark.asyncio
async def test_workspace_restores_selections_revisions_costs_and_isolates_conversations(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    plan={'trip_id':'trip','requirement':{'start_date':'2099-11-20','budget_cny':1000,'days':2,'destination':'杭州'},
          'itinerary':[{'day':1,'date':'2099-11-20','title':'杭州','activities':['西湖'],'notes':[]}],
          'costs':[{'category':'hotel','description':'住宿','amount_cny':320,'is_estimate':True},{'category':'food','description':'餐饮','amount_cny':200,'is_estimate':True}],
          'total_cost_cny':520,'remaining_budget_cny':480,'verification':{'status':'PASS','issues':[]}}
    async with sessions() as session:
        session.add_all([ConversationRecord(id='a',title='A',messages=[]),ConversationRecord(id='b',title='B',messages=[]),TripRecord(id='trip',trace_id='trace',request_text='test',payload=deepcopy(plan))]);await session.commit()
    class Gateway:
        expired=False
        def candidate(self,id):
            if self.expired or id!='candidate':raise TravelSearchError('expired')
            return {'candidate_id':id,'provider':'fliggy','title':'酒店候选','price_text':'起价','url':'https://router.feizhu.com/test','tags':[]}
    gateway=Gateway()
    from fastapi import FastAPI
    app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace(travel_gateway=gateway)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        assert (await client.get('/api/v1/conversations/missing/workspace')).status_code==404
        payload={'candidate_id':'candidate','category':'hotel','unit_price_cny':'0.10','quantity':3}
        first=(await client.post('/api/v1/conversations/a/workspace/selections',json=payload)).json()
        selection_id=first['selections'][0]['id']
        assert first['budget']['selected_total_cny']==0.3
        second=(await client.post('/api/v1/conversations/a/workspace/selections',json={**payload,'unit_price_cny':600})).json()
        assert len(second['selections'])==1 and second['selections'][0]['id']==selection_id
        assert (await client.get('/api/v1/conversations/b/workspace')).json()['selections']==[]
        attached=(await client.put('/api/v1/conversations/a/workspace/plan',json={'trip_id':'trip'})).json()
        assert attached['plan']['total_cost_cny']==2000
        assert attached['plan']['remaining_budget_cny']==-1000
        assert attached['plan']['verification']['status']=='WARNING'
        async with sessions() as session:
            original=await session.get(TripRecord,'trip');assert original.payload['costs'][0]['amount_cny']==320
            record=await session.get(ConversationState,'a')
            record.payload={**record.payload,'itinerary':{'days':[{'day':1,'title':'调整后','items':['博物馆']}],'updated_at':'test'}}
            await session.commit()
        restored=(await client.get('/api/v1/conversations/a/workspace')).json()
        assert restored['plan']['itinerary'][0]['activities']==['博物馆']
        async with sessions() as session:
            record=await session.get(ConversationState,'a')
            record.payload={**record.payload,'requirements':{'start_date':'2099-11-25'}}
            await session.commit()
        changed=(await client.get('/api/v1/conversations/a/workspace')).json()
        assert changed['selections'][0]['needs_review'] is True
        assert changed['budget']['selected_total_cny']==1800
        gateway.expired=True
        assert (await client.post('/api/v1/conversations/a/workspace/selections',json=payload)).status_code==410
        assert (await client.get('/api/v1/conversations/a/workspace')).json()['selections'][0]['title']=='酒店候选'
        exported=await client.get('/api/v1/conversations/a/workspace/export')
        assert '博物馆' in exported.text and '酒店候选' in exported.text and '1800.00' in exported.text
        removed=(await client.delete(f'/api/v1/conversations/a/workspace/selections/{selection_id}')).json()
        assert removed['selections']==[] and removed['plan']['costs'][0]['amount_cny']==320
    await engine.dispose()


@pytest.mark.asyncio
async def test_route_reviews_warn_on_long_days_and_expire_after_revision(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add(ConversationRecord(id='a',messages=[],title='A'))
        session.add(ConversationState(id='a',payload={'itinerary':{'days':[{'day':1,'title':'武汉→北京','items':['赶路']}],'updated_at':'one'}}));await session.commit()
    async def drive(origin,destination):return {'driving_hours':12,'distance_km':1150}
    from fastapi import FastAPI
    app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace(tool_gateway=SimpleNamespace(amap=SimpleNamespace(driving_overview=drive)))))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        reviewed=(await client.post('/api/v1/conversations/a/workspace/check-routes')).json()
        assert reviewed['route_review']['days'][0]['rest_minutes']==120
        assert '超过6小时' in reviewed['route_review']['days'][0]['warning']
        async with sessions() as session:
            record=await session.get(ConversationState,'a');record.payload={**record.payload,'itinerary':{'days':[{'day':1,'title':'武汉→郑州','items':['轻松']}],'updated_at':'two'}};await session.commit()
        assert (await client.get('/api/v1/conversations/a/workspace')).json()['route_review'] is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_weather_refresh_failure_preserves_last_forecast_and_date_edits_recheck_coverage(monkeypatch):
    from fastapi import FastAPI
    from app.schemas.domain import SourceFact
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    plan={'trip_id':'weather-trip','requirement':{'start_date':'2099-11-20','budget_cny':1000,'days':2,'destination':'杭州'},
          'itinerary':[],'costs':[],'verification':{'status':'PASS','issues':[]}}
    async with sessions() as session:
        session.add(ConversationRecord(id='weather',title='Weather',messages=[]))
        session.add(TripRecord(id='weather-trip',trace_id='trace',request_text='test',payload=plan))
        session.add(ConversationState(id='weather',payload={'trip_id':'weather-trip'}));await session.commit()
    class Gateway:
        fail=False
        async def weather(self,*args):
            assert args[-1] is False
            if self.fail:raise RuntimeError('private upstream failure')
            return [SourceFact(name='2099-11-20 杭州天气',value='晴',source_url='https://example.com/weather')],'real'
    gateway=Gateway();app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace(tool_gateway=gateway)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        initial=(await client.post('/api/v1/conversations/weather/workspace/refresh-weather')).json()
        assert initial['weather_review']['covers_departure']
        gateway.fail=True
        assert (await client.post('/api/v1/conversations/weather/workspace/refresh-weather')).status_code==503
        assert (await client.get('/api/v1/conversations/weather/workspace')).json()['weather_review']==initial['weather_review']
        async with sessions() as session:
            record=await session.get(ConversationState,'weather');record.payload={**record.payload,'requirements':{'start_date':'2099-11-25'}};await session.commit()
        assert not (await client.get('/api/v1/conversations/weather/workspace')).json()['weather_review']['covers_departure']
        assert (await client.get('/api/v1/conversations/weather/workspace',headers={'Origin':'https://untrusted.invalid'})).status_code==403
    await engine.dispose()
