import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.didi_routes import build_didi_router, safe_app_link
from app.tools.providers.didi import DidiError, DidiProvider


@pytest.mark.asyncio
async def test_mcp_handshake_and_sse_response_ignore_progress():
    calls=[]
    def handle(request):
        assert request.url.params['key']=='fake-secret'
        payload=json.loads(request.content);calls.append(payload)
        if payload['method']=='notifications/initialized':
            assert request.headers['mcp-session-id']=='session-test'
            return httpx.Response(202)
        if payload['method']=='initialize':
            return httpx.Response(200,headers={'mcp-session-id':'session-test'},json={'id':payload['id'],'result':{'protocolVersion':'2025-06-18'}})
        response={'id':payload['id'],'result':{'structuredContent':{'items':[]}}}
        return httpx.Response(200,headers={'Content-Type':'text/event-stream'},text='data: {"method":"notifications/progress"}\n\ndata: '+json.dumps(response)+'\n\n')
    provider=DidiProvider('fake-secret',transport=httpx.MockTransport(handle))
    result=await provider.call_tool('taxi_estimate',{'from_lng':'103.8'})
    assert result=={'structuredContent':{'items':[]}}
    assert [c['method'] for c in calls]==['initialize','notifications/initialized','tools/call']
    assert calls[-1]['params']=={'name':'taxi_estimate','arguments':{'from_lng':'103.8'}}


@pytest.mark.asyncio
@pytest.mark.parametrize('name',['taxi_create_order','taxi_cancel_order','unknown'])
async def test_transaction_tools_are_never_available(name):
    def handle(request):pytest.fail('Unsupported tool must not reach DiDi')
    with pytest.raises(DidiError,match='unsupported'):
        await DidiProvider('fake',transport=httpx.MockTransport(handle)).call_tool(name,{})


@pytest.mark.asyncio
@pytest.mark.parametrize('status',[401,500])
async def test_http_errors_do_not_expose_key(status):
    provider=DidiProvider('fake-private-key',transport=httpx.MockTransport(lambda request:httpx.Response(status)))
    with pytest.raises(DidiError) as caught:
        await provider.call_tool('maps_textsearch',{})
    assert 'fake-private-key' not in str(caught.value)
    assert 'https://' not in str(caught.value)
    assert caught.value.code==('auth' if status==401 else 'unavailable')


class FakeDiDi:
    api_key='fake-private-key'
    def __init__(self):self.calls=[];self.link='diditaxi://page/ride?test=1';self.bad_quote=False
    async def call_tool(self,name,args):
        self.calls.append((name,args))
        if name=='maps_textsearch':
            return {'content':[{'type':'text','text':json.dumps([{'display_name':args['keywords'],'address_all':'测试地址','city':args['city'],'location':{'lng':103.834,'lat':36.061}}])}]}
        if name=='taxi_estimate':
            return {'structuredContent':[] if self.bad_quote else {'traceId':'private','items':[{'productCategory':'fast','productName':'快车','priceText':'约20元'}]}}
        if name=='taxi_generate_ride_app_link':return {'content':[{'type':'text','text':self.link}]}
        pytest.fail('Unexpected DiDi tool: '+name)


@pytest.fixture
def didi_app():
    service=FakeDiDi();engine=SimpleNamespace(tool_gateway=SimpleNamespace(didi=service))
    app=FastAPI();app.include_router(build_didi_router(engine))
    return TestClient(app),service,engine


def places(client):
    start=client.post('/api/v1/didi/places',json={'city':'兰州市','keywords':'兰州西站'})
    end=client.post('/api/v1/didi/places',json={'city':'兰州市','keywords':'中山桥'})
    assert start.status_code==end.status_code==200
    return {'origin_id':start.json()[0]['id'],'destination_id':end.json()[0]['id']}


def test_no_key_explains_setup_without_claiming_connection(didi_app):
    client,_,engine=didi_app;engine.tool_gateway.didi=None
    assert client.get('/api/v1/didi/status').json()=={'configured':False,'mode':'app_handoff'}
    assert client.post('/api/v1/didi/places',json={'city':'兰州市','keywords':'车站'}).status_code==503


def test_explicit_places_quote_and_app_handoff(didi_app):
    client,service,_=didi_app
    quote=client.post('/api/v1/didi/estimate',json=places(client))
    assert quote.status_code==200
    assert 'traceId' not in quote.text and service.api_key not in quote.text
    assert quote.json()['items']==[{'product_category':'fast','name':'快车','price':'约20元'}]
    name,args=service.calls[-1]
    assert name=='taxi_estimate'
    assert args=={'from_lng':'103.834','from_lat':'36.061','from_name':'兰州西站','to_lng':'103.834','to_lat':'36.061','to_name':'中山桥'}
    payload={'quote_id':quote.json()['id'],'product_category':'fast'}
    assert client.post('/api/v1/didi/app-link',json={**payload,'product_category':'luxury'}).status_code==400
    assert client.post('/api/v1/didi/app-link',json=payload).json()=={'url':service.link}
    assert service.calls[-1][0]=='taxi_generate_ride_app_link'
    assert service.calls[-1][1]['product_category']=='fast'
    assert not any('order' in name for name,_ in service.calls)
    assert client.post('/api/v1/didi/order',json={}).status_code==404


def test_quotes_expire_and_key_changes_invalidate_places(didi_app,monkeypatch):
    client,service,_=didi_app
    ids=places(client)
    quote=client.post('/api/v1/didi/estimate',json=ids).json()
    import app.api.didi_routes as routes
    now=routes.monotonic();monkeypatch.setattr(routes,'monotonic',lambda:now+121)
    assert client.post('/api/v1/didi/app-link',json={'quote_id':quote['id'],'product_category':'fast'}).status_code==410
    service.api_key='another-fake-key'
    assert client.post('/api/v1/didi/estimate',json=ids).status_code==410


def test_invalid_quote_data_and_untrusted_link_are_handled(didi_app):
    client,service,_=didi_app;ids=places(client)
    service.bad_quote=True
    assert client.post('/api/v1/didi/estimate',json=ids).status_code==502
    service.bad_quote=False
    quote=client.post('/api/v1/didi/estimate',json=ids).json()
    service.link='https://untrusted.invalid/ride'
    assert client.post('/api/v1/didi/app-link',json={'quote_id':quote['id'],'product_category':'fast'}).status_code==502
    assert client.post('/api/v1/didi/estimate',json={**ids,'origin_id':'invented'}).status_code==410


@pytest.mark.parametrize('url',['javascript:alert(1)','https://didichuxing.com.evil.invalid/ride','https://user:password@didichuxing.com/ride','https://[invalid','https://evil.invalid/ride'])
def test_external_links_are_rejected(url):
    assert not safe_app_link(url)
