import asyncio
import json
from datetime import date,timedelta
from types import SimpleNamespace
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.api.workspace_routes import build_workspace_router
from app.api.routes import build_router
from app.database.db import Base,ConversationRecord,ConversationState,TripRecord
from app.agents.hotel import HotelAgent
from app.agents.base import BaseAgent
from app.schemas.domain import Requirement,DayPlan
from app.tools.providers.travel_search import TravelSearchError
from app.database.conversation_locks import conversation_lock


@pytest.mark.asyncio
async def test_conversation_and_workspace_updates_share_lock_without_blocking_other_chats(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add_all([ConversationRecord(id='a',title='A',messages=[]),ConversationRecord(id='b',title='B',messages=[]),
                        ConversationState(id='a',payload={'selections':[{'id':'chosen','unit_price_cny':100,'quantity':1,'category':'hotel','note':''}]})])
        await session.commit()
    app=FastAPI();orchestrator=SimpleNamespace()
    app.include_router(build_router(orchestrator));app.include_router(build_workspace_router(orchestrator))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        async with conversation_lock('a'):
            rename=asyncio.create_task(client.patch('/api/v1/conversations/a',json={'title':'Renamed'}))
            edit=asyncio.create_task(client.patch('/api/v1/conversations/a/workspace/selections/chosen',json={'category':'hotel','unit_price_cny':125,'quantity':2}))
            other=await asyncio.wait_for(client.patch('/api/v1/conversations/b',json={'title':'Independent'}),1)
            assert other.status_code==200 and not rename.done() and not edit.done()
        responses=await asyncio.gather(rename,edit)
        assert all(response.status_code==200 for response in responses)
        async with sessions() as session:
            state=await session.get(ConversationState,'a')
            assert state.payload['custom_title'] is True
            assert state.payload['selections'][0]['unit_price_cny']==125
            assert (await session.get(ConversationRecord,'a')).title=='Renamed'
    await engine.dispose()


@pytest.mark.asyncio
async def test_saved_estimate_edits_survive_expiry_preserve_source_and_require_explicit_review(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:');sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.workspace_routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    plan={'trip_id':'p','requirement':{'start_date':'2099-11-20','budget_cny':1000,'days':2,'travelers':2,'destination':'杭州'},
          'itinerary':[{'day':1,'title':'杭州','activities':['西湖'],'date':'2099-11-20','notes':[]},{'day':2,'title':'杭州','activities':['休息'],'date':'2099-11-21','notes':[]}],
          'costs':[{'category':'hotel','description':'住宿','amount_cny':300,'is_estimate':True}],'verification':{'status':'PASS','issues':[]}}
    async with sessions() as session:
        session.add_all([ConversationRecord(id='a',messages=[],title='A'),ConversationRecord(id='b',messages=[],title='B'),TripRecord(id='p',trace_id='trace',request_text='test',payload=plan)])
        await session.commit()
    class Gateway:
        expired=False
        def candidate(self,id):
            if self.expired:raise TravelSearchError('expired')
            return {'candidate_id':id,'title':'原酒店','provider':'fliggy','city':'杭州','price_text':'199元起','url':'https://router.feizhu.com/test','tags':[]}
    gateway=Gateway();app=FastAPI();app.include_router(build_workspace_router(SimpleNamespace(travel_gateway=gateway)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        assert (await client.put('/api/v1/conversations/a/workspace/plan',json={'trip_id':'p'})).status_code==200
        payload={'candidate_id':'source','category':'hotel','unit_price_cny':100,'quantity':2}
        view=(await client.post('/api/v1/conversations/a/workspace/selections',json=payload)).json();id=view['selections'][0]['id']
        gateway.expired=True
        async with sessions() as session:
            record=await session.get(ConversationState,'a');record.payload={**record.payload,'requirements':{'start_date':'2099-11-25'}};await session.commit()
        cost={'category':'hotel','unit_price_cny':123.45,'quantity':3,'note':'重新估算'}
        response=await client.patch(f'/api/v1/conversations/a/workspace/selections/{id}',json=cost)
        assert response.status_code==200
        view=response.json();item=view['selections'][0]
        assert view['budget']['selected_total_cny']==370.35
        assert view['plan']['costs'][0]['amount_cny']==370.35
        assert item['needs_review'] and item['title']=='原酒店' and item['price_text']=='199元起'
        assert (await client.patch(f'/api/v1/conversations/b/workspace/selections/{id}',json=cost)).status_code==404
        assert (await client.patch(f'/api/v1/conversations/a/workspace/selections/{id}',json={**cost,'url':'https://evil.invalid'})).status_code==422
        assert (await client.patch(f'/api/v1/conversations/a/workspace/selections/{id}',json={**cost,'quantity':0})).status_code==422
        reviewed=(await client.patch(f'/api/v1/conversations/a/workspace/selections/{id}',json={**cost,'review_confirmed':True})).json()
        assert not reviewed['selections'][0]['needs_review'] and reviewed['selections'][0]['reviewed_at']
        restored=(await client.get('/api/v1/conversations/a/workspace')).json()
        assert restored['selections'][0]['note']=='重新估算' and restored['budget']['selected_total_cny']==370.35
    await engine.dispose()


def req():return Requirement(origin='广州',destination='北京',start_date=date(2099,11,20),days=3,travelers=2,budget_cny=4000)


@pytest.mark.asyncio
async def test_slow_hotel_slot_does_not_discard_completed_candidates(monkeypatch):
    monkeypatch.setattr('app.agents.hotel.ROAD_QUERY_TIMEOUT',0.02)
    stopped=asyncio.Event()
    async def search(provider,city,query):
        if city=='武汉':
            try:await asyncio.Event().wait()
            finally:stopped.set()
        return {'provider':provider,'items':[{'candidate_id':city,'title':city+'酒店','price_text':'199元起','url':'https://router.feizhu.com/test'}]}
    gateway=SimpleNamespace(status=lambda:[{'id':'fliggy','configured':True,'client_installed':True}],search=search)
    requirement=req()
    days=[DayPlan(day=i+1,date=requirement.start_date+timedelta(days=i),title=title,activities=[]) for i,title in enumerate(['广州 → 长沙','长沙 → 武汉','武汉 → 北京'])]
    result=await HotelAgent().execute({'requirement':requirement,'request':SimpleNamespace(text='自驾广州到北京3天'),'itinerary':days,'travel_gateway':gateway})
    assert result['hotel_mode']=='partial'
    assert [hotel.area for hotel in result['hotels']]==['长沙']
    await asyncio.wait_for(stopped.wait(),0.5)


@pytest.mark.asyncio
async def test_hotel_search_uses_other_configured_provider_when_first_is_unavailable():
    calls=[]
    async def search(provider,city,query):
        calls.append(provider)
        if provider=='fliggy':raise TravelSearchError('auth')
        return {'provider':provider,'items':[{'candidate_id':'other','title':'候选','price_text':'200元起','url':'https://dpurl.cn/test'}]}
    gateway=SimpleNamespace(status=lambda:[{'id':id,'configured':True,'client_installed':True} for id in ['fliggy','meituan']],search=search)
    result=await HotelAgent().execute({'requirement':req(),'travel_gateway':gateway})
    assert calls==['fliggy','meituan']
    assert result['hotel_mode']=='real' and result['hotels'][0].provider=='meituan'


@pytest.mark.asyncio
async def test_plan_stream_disconnect_cancels_generation_without_emitting_a_result():
    cancelled=asyncio.Event();disconnected=asyncio.Event();chunks=[]
    async def plan(payload,progress):
        try:
            await progress({'stage':'planner','status':'RUNNING','message':'准备中'})
            await asyncio.Event().wait()
        finally:cancelled.set()
    app=FastAPI();app.include_router(build_router(SimpleNamespace(plan=plan)))
    body=json.dumps({'text':'测试规划'}).encode();sent=False
    async def receive():
        nonlocal sent
        if not sent:sent=True;return {'type':'http.request','body':body,'more_body':False}
        await disconnected.wait();return {'type':'http.disconnect'}
    async def send(message):
        if message['type']=='http.response.body' and message.get('body'):
            chunks.append(message['body']);disconnected.set()
    scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.0'},'http_version':'1.1','method':'POST','scheme':'http','path':'/api/v1/trips/plan/stream','raw_path':b'/api/v1/trips/plan/stream','query_string':b'','root_path':'','headers':[(b'content-type',b'application/json')],'client':('127.0.0.1',1234),'server':('test',80)}
    await asyncio.wait_for(app(scope,receive,send),1)
    await asyncio.wait_for(cancelled.wait(),0.5)
    assert chunks and b'"result"' not in b''.join(chunks)


@pytest.mark.asyncio
async def test_agent_http_errors_do_not_expose_key_bearing_urls():
    class FailedAgent(BaseAgent):
        agent_id='test';name='Test';capabilities=set()
        async def execute(self,state):
            request=httpx.Request('GET','https://example.com/?key=fake-private-secret')
            response=httpx.Response(500,request=request)
            response.raise_for_status()
    trace=await FailedAgent().run({})
    assert trace.error=='HTTPStatusError'
    assert 'fake-private-secret' not in trace.model_dump_json()
