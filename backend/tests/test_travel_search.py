import json
import subprocess
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.travel_routes import build_travel_router
from app.core.config import Settings
from app.tools.providers.travel_search import TravelSearchGateway, TravelSearchError, parse_fliggy, safe_travel_link


def fliggy_response():
    return {'status':0,'data':{'itemList':[{'info':{'title':'测试酒店','price':'每晚约500元','tags':['近地铁'],
        'jumpUrl':'https://h5.fliggy.com/hotel/test'}},{'info':{'title':'无报价酒店','jumpUrl':'javascript:alert(1)'}}]},'systemMessage':'价格以详情页为准'}


def test_fliggy_results_keep_vendor_prices_and_do_not_invent_missing_values():
    result=parse_fliggy(json.dumps(fliggy_response()))
    assert len(result['items'])==2
    assert result['items'][0]['price_text']=='每晚约500元'
    assert result['items'][0]['url']=='https://h5.fliggy.com/hotel/test'
    assert result['items'][1]['price_text']=='' and result['items'][1]['url'] is None
    assert result['notice']=='价格以详情页为准'


@pytest.mark.parametrize('raw',['not json','[]','{"tool":"fliggy_search","arguments":{}}','{"status":1}','{"data":null}','{"data":{"itemList":{}}}'])
def test_fliggy_malformed_or_error_responses_fail_cleanly(raw):
    with pytest.raises(TravelSearchError):parse_fliggy(raw)


@pytest.mark.parametrize('url',['javascript:alert(1)','https://fliggy.com.evil.invalid','https://user:secret@h5.fliggy.com','https://[bad','https://evil.invalid'])
def test_travel_links_reject_untrusted_destinations(url):
    assert safe_travel_link(url,'fliggy') is None


def test_live_fliggy_router_domain_is_allowed_without_allowing_lookalikes():
    assert safe_travel_link('https://router.feizhu.com/route?test=1','fliggy')=='https://router.feizhu.com/route?test=1'
    assert safe_travel_link('https://router.feizhu.com.evil.invalid/route','fliggy') is None
    assert safe_travel_link('https://router.feizhu.com/route','meituan') is None


def test_meituan_legacy_short_links_are_upgraded_to_https_only_for_the_known_host():
    assert safe_travel_link('http://dpurl.cn/example?test=1','meituan')=='https://dpurl.cn/example?test=1'
    assert safe_travel_link('http://dpurl.cn.evil.invalid/example','meituan') is None
    assert safe_travel_link('http://dpurl.cn/example','fliggy') is None


@pytest.mark.asyncio
@pytest.mark.parametrize('provider',['fliggy','meituan'])
async def test_official_clients_receive_key_only_in_environment_and_query_as_data(provider,monkeypatch):
    import app.tools.providers.travel_search as module
    monkeypatch.setenv('UNRELATED_SECRET','must-not-pass')
    monkeypatch.setattr(module.shutil,'which',lambda name:'test-node')
    monkeypatch.setattr(module.Path,'is_file',lambda path:True)
    calls=[]
    def run(args,**kwargs):
        calls.append((args,kwargs))
        return subprocess.CompletedProcess(args,0,json.dumps(fliggy_response()).encode() if provider=='fliggy' else b'result fake-meituan-secret',b'')
    gateway=TravelSearchGateway(Settings(fliggy_api_key='fake-fliggy-secret',meituan_ht_token='fake-meituan-secret'),runner=run)
    query='杭州酒店 $(do-not-run) `do-not-run`; --anything'
    result=await gateway.search(provider,'兰州',query)
    args,options=calls[0]
    assert args[0]=='test-node'
    assert not options['shell']
    assert 'UNRELATED_SECRET' not in options['env']
    assert 'fake-fliggy-secret' not in ' '.join(args) and 'fake-meituan-secret' not in ' '.join(args)
    if provider=='fliggy':
        assert args[-1]=='兰州：'+query
        assert options['env']['FLYAI_API_KEY']=='fake-fliggy-secret'
        assert 'MEITUAN_HT_TOKEN' not in options['env']
    else:
        assert args[args.index('--query')+1]==query
        assert options['env']['MEITUAN_HT_TOKEN']=='fake-meituan-secret'
        assert result['text']=='result [redacted]'
    assert result['provider']==provider


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['timeout','auth','upstream'])
async def test_errors_do_not_return_stdout_stderr_or_secrets(failure,monkeypatch):
    import app.tools.providers.travel_search as module
    monkeypatch.setattr(module.shutil,'which',lambda name:'test-node')
    monkeypatch.setattr(module.Path,'is_file',lambda path:True)
    def run(args,**kwargs):
        if failure=='timeout':raise subprocess.TimeoutExpired(args,1,output=b'private')
        return subprocess.CompletedProcess(args,3 if failure=='auth' else 1,b'private',b'fake-secret signed_url')
    gateway=TravelSearchGateway(Settings(meituan_ht_token='fake-secret'),runner=run)
    with pytest.raises(TravelSearchError) as caught:await gateway.search('meituan','兰州','杭州酒店')
    assert caught.value.code==failure
    assert 'private' not in str(caught.value) and 'fake-secret' not in str(caught.value)


def test_search_routes_require_configuration_validate_inputs_and_reject_other_origins():
    engine=SimpleNamespace(settings=Settings(fliggy_api_key='',meituan_ht_token=''))
    app=FastAPI();app.include_router(build_travel_router(engine));client=TestClient(app)
    status=client.get('/api/v1/travel/services').json()
    assert [row['id'] for row in status]==['fliggy','meituan']
    assert not any(row['configured'] for row in status)
    payload={'city':'兰州','query':'杭州酒店'}
    assert client.post('/api/v1/travel/search/fliggy',json=payload).status_code==503
    assert client.post('/api/v1/travel/search/create_order',json=payload).status_code==404
    assert client.post('/api/v1/travel/search/meituan',json={'city':'  ','query':'酒店'}).status_code==422
    invalid = client.post('/api/v1/travel/search/meituan',json={'city':'骑自行车','query':'酒店'})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'invalid_city'
    assert client.post('/api/v1/travel/search/meituan',json=payload,headers={'Origin':'https://untrusted.invalid'}).status_code==403


def test_saved_credentials_are_used_on_the_next_search(monkeypatch):
    import app.tools.providers.travel_search as module
    monkeypatch.setattr(module.shutil,'which',lambda name:'test-node')
    monkeypatch.setattr(module.Path,'is_file',lambda path:True)
    def run(args,**kwargs):
        assert kwargs['env']['MEITUAN_HT_TOKEN']=='new-fake-key'
        return subprocess.CompletedProcess(args,0,b'vendor answer',b'')
    monkeypatch.setattr(module.subprocess,'run',run)
    engine=SimpleNamespace(settings=Settings(fliggy_api_key='',meituan_ht_token=''))
    app=FastAPI();app.include_router(build_travel_router(engine));client=TestClient(app)
    engine.settings=Settings(meituan_ht_token='new-fake-key')
    result=client.post('/api/v1/travel/search/meituan',json={'city':'兰州','query':'杭州酒店'})
    assert result.status_code==200 and result.json()['text']=='vendor answer'


@pytest.mark.asyncio
async def test_cancelled_requests_keep_their_capacity_until_the_worker_finishes():
    import asyncio
    from threading import Event
    gateway=TravelSearchGateway(Settings())
    loop=asyncio.get_running_loop();started=asyncio.Queue()
    gates={name:Event() for name in ['one','two','three']}
    def worker(provider,city,query):
        loop.call_soon_threadsafe(started.put_nowait,query)
        gates[query].wait(timeout=2)
        return {'query':query}
    gateway._search=worker
    tasks=[]
    try:
        first=asyncio.create_task(gateway.search('fliggy','杭州','one'));tasks.append(first)
        second=asyncio.create_task(gateway.search('fliggy','杭州','two'));tasks.append(second)
        assert {await started.get(),await started.get()}=={'one','two'}
        first.cancel()
        third=asyncio.create_task(gateway.search('fliggy','杭州','three'));tasks.append(third)
        await asyncio.sleep(0.02)
        assert started.empty()
        gates['one'].set()
        with pytest.raises(asyncio.CancelledError):await first
        assert await asyncio.wait_for(started.get(),1)=='three'
    finally:
        for gate in gates.values():gate.set()
        await asyncio.gather(*tasks,return_exceptions=True)
