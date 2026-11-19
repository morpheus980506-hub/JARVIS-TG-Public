from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
import json
import pytest
from app.agents.hotel import HotelAgent
from app.agents.budget import BudgetAgent
from app.agents.itinerary import ItineraryAgent
from app.agents.driving_schedule import driving_schedule
from app.agents.transport import TransportAgent


@pytest.mark.asyncio
async def test_local_cycling_does_not_search_intercity_tickets():
    gateway = SimpleNamespace(transport=AsyncMock())
    result = await TransportAgent().execute({
        'requirement': requirement(),
        'request': SimpleNamespace(text='从兰州新区骑自行车去栖霞湖'),
        'tool_gateway': gateway,
    })
    assert result == {'transport': [], 'transport_mode': 'not_required'}
    gateway.transport.assert_not_awaited()
from app.schemas.domain import Requirement,TripRequest,SourceFact
from app.verifier.rules import VerifierAgent
from app.orchestrator.engine import Orchestrator
from app.core.config import Settings
from app.agents.intake import request_is_driving
from app.tools.providers.amap import AmapProvider,AmapLocationMismatch
import httpx


def requirement(days=4):
    return Requirement(origin='广州',destination='北京',start_date=date(2099,11,20),days=days,travelers=2,budget_cny=4000)


@pytest.mark.parametrize('text,expected',[
    ('先自驾\n不自驾了，改坐高铁',False),('先查航班\n改为自驾',True),
    ('先自驾\n不自驾了',False),('不坐航班，我要自驾',True),('自驾到杭州，但不坐飞机',True)])
def test_latest_transport_choice_survives_combined_request_history(text,expected):
    assert request_is_driving(SimpleNamespace(text=text)) is expected


@pytest.mark.asyncio
async def test_one_day_plan_does_not_query_hotels_or_allocate_overnight_cost():
    gateway=SimpleNamespace(status=lambda:pytest.fail('One-day trips must not query hotels'))
    state={'requirement':requirement(1),'travel_gateway':gateway}
    hotel=await HotelAgent().execute(state)
    assert hotel=={'hotels':[],'hotel_mode':'not_required'}
    budget=await BudgetAgent().execute(state)
    assert next(cost.amount_cny for cost in budget['costs'] if cost.category=='hotel')==0
    plan=await ItineraryAgent().execute({'requirement':requirement(1)})
    assert not any('入住' in item for day in plan['itinerary'] for item in day.activities)


@pytest.mark.asyncio
async def test_real_hotel_candidates_do_not_fabricate_nightly_or_total_prices():
    async def search(*args):return {'provider':'fliggy','items':[{'candidate_id':'source','title':'真实酒店','price_text':'¥199起','url':'https://router.feizhu.com/test'}]}
    gateway=SimpleNamespace(status=lambda:[{'id':'fliggy','configured':True,'client_installed':True}],search=search)
    result=await HotelAgent().execute({'requirement':requirement(),'travel_gateway':gateway})
    assert result['hotel_mode']=='real'
    hotel=result['hotels'][0]
    assert not hotel.is_mock and hotel.candidate_id=='source'
    assert hotel.nightly_price_cny is None and hotel.total_price_cny is None
    assert hotel.price_text=='¥199起'


@pytest.mark.asyncio
async def test_provider_failure_never_silently_becomes_simulated_hotel_inventory():
    async def fail(*args):raise RuntimeError('private upstream error')
    gateway=SimpleNamespace(status=lambda:[{'id':'fliggy','configured':True,'client_installed':True}],search=fail)
    assert await HotelAgent().execute({'requirement':requirement(),'travel_gateway':gateway})=={'hotels':[],'hotel_mode':'unavailable'}


@pytest.mark.asyncio
async def test_road_trip_hotels_follow_each_overnight_city_and_date():
    from app.schemas.domain import DayPlan
    calls=[]
    async def search(provider,city,query):
        calls.append((city,query))
        return {'provider':provider,'items':[{'candidate_id':city,'title':city+'酒店','price_text':'¥199起','url':'https://router.feizhu.com/test'}]}
    gateway=SimpleNamespace(status=lambda:[{'id':'fliggy','configured':True,'client_installed':True}],search=search)
    state={'requirement':requirement(),'request':SimpleNamespace(text='自驾广州到北京4天'),'travel_gateway':gateway}
    assert (await HotelAgent().execute(state))['hotel_mode']=='pending_route'
    assert not calls
    from datetime import timedelta
    state['itinerary']=[DayPlan(day=i+1,date=state['requirement'].start_date+timedelta(days=i),title=title,activities=[]) for i,title in enumerate(['广州 → 长沙','长沙 → 武汉','武汉 → 郑州','郑州 → 北京'])]
    result=await HotelAgent().execute(state)
    assert result['hotel_mode']=='real'
    assert [city for city,_ in calls]==['长沙','武汉','郑州']
    assert '2099-11-21入住' in calls[1][1]
    assert all(hotel.area!='北京' for hotel in result['hotels'])


@pytest.mark.asyncio
@pytest.mark.parametrize('text,last',[('自驾广州到北京，4天，不考虑返程','北京'),('自驾广州到北京，4天，往返广州','广州')])
async def test_driving_schedule_checks_each_leg_and_does_not_assume_return(text,last):
    stops=['长沙','武汉','北京',last] if last=='广州' else ['长沙','武汉','郑州','北京']
    model=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=json.dumps({'stops':stops}))))
    amap=SimpleNamespace(driving_overview=AsyncMock(return_value={'driving_hours':7.5,'distance_km':700}))
    req=requirement()
    result=await driving_schedule({'requirement':req,'request':SimpleNamespace(text=text),'model_gateway':model,'tool_gateway':SimpleNamespace(amap=amap)})
    assert result['itinerary'][-1].title.endswith(last)
    assert len(result['itinerary'])==4
    assert any('超过6小时' in note for day in result['itinerary'] for note in day.notes)
    state={'requirement':req,'itinerary':result['itinerary'],'total_cost_cny':4000,'hotels':[],'weather':[],'transport':[],'transport_mode':'not_required'}
    report=await VerifierAgent().verify(state)
    assert any(issue.code.startswith('DRIVE_DAY') for issue in report.issues)
    assert not any(issue.code=='TRANSPORT' for issue in report.issues)


@pytest.mark.asyncio
async def test_bad_or_unavailable_driving_proposal_never_claims_verified_routes():
    model=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content='{"stops":["不存在的终点"]}')))
    result=await driving_schedule({'requirement':requirement(),'request':SimpleNamespace(text='自驾广州到北京4天'),'model_gateway':model,'tool_gateway':None})
    assert len(result['itinerary'])==4
    assert all(day.route_checks==[{'status':'unavailable'}] for day in result['itinerary'])


@pytest.mark.asyncio
async def test_driving_does_not_query_flight_or_train_tools():
    gateway=SimpleNamespace(transport=AsyncMock(side_effect=AssertionError('must not query public transport')))
    result=await TransportAgent().execute({'requirement':requirement(),'request':SimpleNamespace(text='自驾广州到北京'),'tool_gateway':gateway})
    assert result['transport_mode']=='not_required'
    gateway.transport.assert_not_called()


@pytest.mark.asyncio
async def test_weather_outside_trip_dates_is_not_verified_as_trip_weather():
    state={'requirement':requirement(),'itinerary':[],'weather':[SourceFact(name='2026-11-09 北京天气',value='晴',source_url='https://example.com')],'total_cost_cny':0}
    report=await VerifierAgent().verify(state)
    assert any(issue.code=='WEATHER_DATE' for issue in report.issues)


@pytest.mark.asyncio
async def test_geocoder_province_fallback_cannot_masquerade_as_a_verified_city_route():
    routes=[]
    def respond(request):
        if request.url.path.endswith('/geo'):
            address=request.url.params['address']
            row=({'province':'河南省','city':[],'level':'省','location':'113,34'} if address=='河南省武汉市' else
                 {'province':'北京市','city':'北京市','level':'省','location':'116,39'})
            return httpx.Response(200,json={'status':'1','geocodes':[row]})
        routes.append(request.url.path)
        return httpx.Response(200,json={'status':'1','route':{'paths':[]}})
    provider=AmapProvider('fake',transport=httpx.MockTransport(respond))
    with pytest.raises(AmapLocationMismatch):await provider.driving_overview('河南省武汉市','北京市')
    assert routes==[]


@pytest.mark.asyncio
async def test_municipality_geocode_is_accepted_when_city_matches():
    def respond(request):
        if request.url.path.endswith('/geo'):
            address=request.url.params['address']
            return httpx.Response(200,json={'status':'1','geocodes':[{'province':address,'city':address,'level':'省','location':'116,39'}]})
        return httpx.Response(200,json={'status':'1','route':{'paths':[{'distance':'10000','cost':{'duration':'600'}}]}})
    provider=AmapProvider('fake',transport=httpx.MockTransport(respond))
    result=await provider.driving_overview('北京市','天津市')
    assert result['distance_km']==10


@pytest.mark.asyncio
async def test_adjacent_road_legs_share_validated_coordinates_but_refresh_route_times(monkeypatch):
    import asyncio
    import app.tools.providers.amap as module
    addresses=[];routes=[]
    def respond(request):
        if request.url.path.endswith('/geo'):
            address=request.url.params['address'];addresses.append(address)
            return httpx.Response(200,json={'status':'1','geocodes':[{'province':'浙江省','city':address,'level':'市','location':'120,30'}]})
        routes.append(request.url.path)
        return httpx.Response(200,json={'status':'1','route':{'paths':[{'distance':'10000','cost':{'duration':'600'}}]}})
    provider=AmapProvider('fake',transport=httpx.MockTransport(respond))
    await asyncio.gather(provider.driving_overview('杭州市','宁波市'),provider.driving_overview('宁波市','绍兴市'))
    assert addresses.count('宁波市')==1 and len(addresses)==3 and len(routes)==2
    await provider.driving_overview('杭州市','宁波市')
    assert len(addresses)==3 and len(routes)==3
    future=module.monotonic()+1201
    monkeypatch.setattr(module,'monotonic',lambda:future)
    await provider.driving_overview('杭州市','宁波市')
    assert len(addresses)==5 and len(routes)==4


@pytest.mark.asyncio
async def test_confirmed_one_day_driving_plan_is_not_mislabeled_as_mock(monkeypatch):
    engine=Orchestrator(Settings(deepseek_api_key='',deepseek_model=''))
    engine.model_gateway=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content='{"stops":["北京"]}')))
    engine.tool_gateway=SimpleNamespace(
        amap=SimpleNamespace(driving_overview=AsyncMock(return_value={'driving_hours':1,'distance_km':50})),
        weather=AsyncMock(return_value=([SourceFact(name='2099-11-20 北京天气',value='晴',source_url='https://example.com/weather')],'real')),
        research=AsyncMock(return_value=([],'real')))
    # Avoid writing a persistent trip while exercising the complete planner.
    class Session:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def add(self,record):pass
        async def commit(self):pass
    monkeypatch.setattr('app.orchestrator.engine.SessionLocal',Session)
    result=await engine.plan(TripRequest(text='自驾广州到北京，单程1天',origin='广州',destination='北京',start_date=date(2099,11,20),days=1,travelers=1,budget_cny=1000,allow_mock=False))
    assert result.data_mode=='real'
    assert result.hotels==[] and result.transport==[]
    assert not any('入住' in item for day in result.itinerary for item in day.activities)


@pytest.mark.asyncio
async def test_one_day_placeholder_is_rejected_before_persisting():
    engine = Orchestrator(Settings(deepseek_api_key='', deepseek_model=''))
    engine.tool_gateway = SimpleNamespace(
        amap=None,
        weather=AsyncMock(return_value=([], 'unavailable')),
        research=AsyncMock(return_value=([], 'unavailable')),
    )
    engine._persist = AsyncMock()
    request = TripRequest(text='从兰州新区骑自行车去栖霞湖', origin='兰州新区', destination='栖霞湖',
                          start_date=date(2099, 11, 20), days=1, budget_cny=100)
    with pytest.raises(ValueError, match='可执行的一日行程'):
        await engine.plan(request)
    engine._persist.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_day_intercity_plan_can_include_a_specific_open_attraction():
    from app.schemas.domain import TransportOption

    req = requirement(1)
    depart = req.start_date.isoformat()
    result = await ItineraryAgent().execute({
        'requirement': req,
        'transport': [TransportOption(mode='train', service_number='G1', provider='test',
                                      departure_name=req.origin, arrival_name=req.destination,
                                      departure_time=f'{depart} 08:00:00', arrival_time=f'{depart} 10:00:00',
                                      source_url='https://example.com/train')],
        'research': [SourceFact(name='城市博物馆', value='地图地点',
                                source_url='https://uri.amap.com/marker?position=120,30')],
    })
    day = result['itinerary'][0]
    assert day.stops[0]['name'] == '城市博物馆'
    assert any('核对返程班次' in item for item in day.activities)


@pytest.mark.asyncio
async def test_optional_plan_summary_uses_fast_path_and_timeout_keeps_core_plan_usable(monkeypatch):
    engine=Orchestrator.__new__(Orchestrator)
    engine.settings=SimpleNamespace(deepseek_api_key='fake',deepseek_model='test')
    engine.model_gateway=SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content='简短摘要',provider='test',fallback_used=False)))
    state={'requirement':requirement(),'verification':SimpleNamespace(status=SimpleNamespace(value='WARNING'))}
    summary,trace=await engine._model_summary(state)
    assert summary=='简短摘要' and trace.status.value=='SUCCESS'
    async def timeout(awaitable,timeout):
        assert timeout<=6
        awaitable.close()
        raise TimeoutError()
    monkeypatch.setattr('app.orchestrator.engine.asyncio.wait_for',timeout)
    summary,trace=await engine._model_summary(state)
    assert '4天行程' in summary and '待确认' in summary
    assert trace.status.value=='FAILED'
