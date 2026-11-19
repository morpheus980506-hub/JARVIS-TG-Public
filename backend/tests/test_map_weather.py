import httpx
import asyncio
import pytest
from datetime import datetime, timedelta
from pydantic import ValidationError

from app.tools.providers.map_weather import MapWeatherProvider, WeatherBounds


@pytest.mark.asyncio
async def test_forecast_grid_is_real_batched_cached_and_preserves_units():
    calls = []
    times = [(datetime(2026,11,8,1) + timedelta(hours=offset)).isoformat(timespec='minutes') for offset in range(25)]
    def handle(request):
        calls.append(request)
        assert request.url.params['wind_speed_unit'] == 'ms'
        assert request.url.params['forecast_hours'] == '25'
        count = len(request.url.params['latitude'].split(','))
        assert count >= 4
        return httpx.Response(200,json=[{'hourly':{'time':times,
            'precipitation':[0.2]*25,'cloud_cover':[70]*25,'wind_speed_10m':[3.5]*25,'wind_direction_10m':[90]*25}} for _ in range(count)])
    provider = MapWeatherProvider(transport=httpx.MockTransport(handle))
    bounds = WeatherBounds(west=103.8,east=104,south=36,north=36.2)
    first = await provider.forecast(bounds)
    assert len(first['points']) >= 4
    assert first['hours'][0] == '2026-11-08T01:00Z'
    assert len(first['hours']) == 25
    assert first['points'][0]['precipitation'][0] == 0.2
    assert first['points'][0]['wind_speed_10m'][0] == 3.5
    assert await provider.forecast(bounds) is first
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_missing_weather_is_an_error_not_fake_clear_skies():
    provider = MapWeatherProvider(transport=httpx.MockTransport(lambda request: httpx.Response(200,json=[])))
    with pytest.raises(ValueError,match='Incomplete'):
        await provider.forecast(WeatherBounds(west=103,east=104,south=35,north=36))
    assert not provider.cache


@pytest.mark.parametrize('values',[
    {'west':104,'east':103,'south':35,'north':36},
    {'west':103,'east':104,'south':36,'north':35},
    {'west':float('nan'),'east':104,'south':35,'north':36},
    {'west':103,'east':104,'south':35,'north':90},
])
def test_invalid_forecast_bounds_are_rejected(values):
    with pytest.raises(ValidationError):
        WeatherBounds(**values)


def forecast_body(count=16):
    times = [(datetime(2026,11,8,1) + timedelta(hours=offset)).isoformat(timespec='minutes') for offset in range(25)]
    return [{'hourly':{'time':times,'precipitation':[.2]*25,'cloud_cover':[70]*25,
                      'wind_speed_10m':[3.5]*25,'wind_direction_10m':[90]*25}} for _ in range(count)]


@pytest.mark.asyncio
async def test_panning_preserves_geographic_sample_locations():
    def handle(request):
        return httpx.Response(200,json=forecast_body(len(request.url.params['latitude'].split(','))))
    provider=MapWeatherProvider(transport=httpx.MockTransport(handle))
    a=await provider.forecast(WeatherBounds(west=103,east=104,south=35,north=36,grid_step=.5))
    b=await provider.forecast(WeatherBounds(west=103.1,east=104.1,south=35.1,north=36.1,grid_step=.5))
    assert a['grid_step'] == b['grid_step'] == .5
    points_a={(p['longitude'],p['latitude']) for p in a['points']}
    points_b={(p['longitude'],p['latitude']) for p in b['points']}
    assert points_a <= points_b
    assert all(lng*2 == int(lng*2) and lat*2 == int(lat*2) for lng,lat in points_b)


@pytest.mark.asyncio
async def test_identical_requests_coalesce_while_different_areas_run_concurrently():
    calls=[]
    both_started=asyncio.Event()
    release=asyncio.Event()
    async def handle(request):
        calls.append(request)
        if len(calls) == 2:
            both_started.set()
        await release.wait()
        return httpx.Response(200,json=forecast_body(len(request.url.params['latitude'].split(','))))
    provider=MapWeatherProvider(transport=httpx.MockTransport(handle))
    a=WeatherBounds(west=103,east=104,south=35,north=36)
    b=WeatherBounds(west=113,east=114,south=25,north=26)
    tasks=[asyncio.create_task(provider.forecast(a)) for _ in range(5)]
    tasks.append(asyncio.create_task(provider.forecast(b)))
    try:
        await asyncio.wait_for(both_started.wait(),1)
        assert len(calls) == 2
    finally:
        release.set()
    results=await asyncio.gather(*tasks)
    assert all(result is results[0] for result in results[:5])
    assert results[-1]['bounds'] != results[0]['bounds']
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_cancelling_one_waiter_does_not_cancel_shared_weather_request():
    started=asyncio.Event()
    release=asyncio.Event()
    calls=[]
    async def handle(request):
        calls.append(request)
        started.set()
        await release.wait()
        return httpx.Response(200,json=forecast_body(len(request.url.params['latitude'].split(','))))
    provider=MapWeatherProvider(transport=httpx.MockTransport(handle))
    bounds=WeatherBounds(west=103,east=104,south=35,north=36)
    first=asyncio.create_task(provider.forecast(bounds))
    await started.wait()
    second=asyncio.create_task(provider.forecast(bounds))
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    result=await second
    assert await provider.forecast(bounds) is result
    assert len(calls) == 1
