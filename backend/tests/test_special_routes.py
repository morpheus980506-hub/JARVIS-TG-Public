from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.routes import build_router
from app.tools.providers.amap import AmapProvider


@pytest.mark.parametrize('mode,path',[('motorcycle','motor'),('electric','electrobike')])
@pytest.mark.asyncio
async def test_special_route_uses_dedicated_amap_endpoint(mode,path):
    def handle(request):
        assert request.url.path == '/v5/direction/'+path
        return httpx.Response(200,json={'status':'1','route':{'paths':[]}})
    provider=AmapProvider('fake-key',transport=httpx.MockTransport(handle))
    await provider.route('103,36','104,37',mode)


@pytest.mark.parametrize('mode',['motorcycle','electric'])
def test_special_route_api_normalizes_path_and_uses_requested_vehicle(mode):
    provider=SimpleNamespace(route=AsyncMock(return_value={'route':{'paths':[{'distance':'1200','cost':{'duration':'300'},'steps':[{'polyline':'103,36;104,37','instruction':'继续直行'}]}]}}))
    app=FastAPI(); app.include_router(build_router(SimpleNamespace(tool_gateway=SimpleNamespace(amap=provider))))
    response=TestClient(app).post('/api/v1/map/route',json={'mode':mode,'origin':[103,36],'destination':[104,37]})
    assert response.status_code == 200
    assert response.json()['path'] == [[103,36],[104,37]]
    assert provider.route.call_args.args[-1] == mode
    assert response.json()['time'] == '300'


def test_missing_motorcycle_privileges_return_actionable_error_not_a_bicycle_route():
    provider=SimpleNamespace(route=AsyncMock(side_effect=RuntimeError('Amap API error 10012: INSUFFICIENT_PRIVILEGES')))
    app=FastAPI();app.include_router(build_router(SimpleNamespace(tool_gateway=SimpleNamespace(amap=provider))))
    response=TestClient(app).post('/api/v1/map/route',json={'mode':'motorcycle','origin':[103,36],'destination':[104,37]})
    assert response.status_code == 403
    assert '权限' in response.json()['detail']
