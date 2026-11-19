import sys
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.settings_routes import build_settings_router
from app.core.config import Settings
from app.core import service_settings as store


@pytest.fixture
def configured_app(monkeypatch):
    saved={}
    monkeypatch.setattr(store,'read_overrides',lambda:dict(saved))
    def save(values):
        saved.clear();saved.update(values)
    monkeypatch.setattr(store,'save_overrides',save)
    engine=SimpleNamespace(settings=Settings(deepseek_api_key='old-fake-secret',deepseek_model='test',deepseek_fast_model='test'))
    app=FastAPI();app.include_router(build_settings_router(engine))
    return TestClient(app),engine,saved


def test_api_settings_never_return_keys_and_omit_url_credentials(configured_app):
    client,engine,_=configured_app
    engine.settings.deepseek_base_url='https://test:private@test.invalid/v1?token=hidden'
    response=client.get('/api/v1/settings/services')
    assert response.status_code==200
    assert 'old-fake-secret' not in response.text
    assert 'private' not in response.text and 'hidden' not in response.text
    model=response.json()[0]
    assert model['configured']
    assert next(f for f in model['fields'] if f['kind']=='secret')['configured']
    assert 'value' not in next(f for f in model['fields'] if f['kind']=='secret')


def test_saving_real_configuration_updates_gateway_and_keeps_blank_keys(configured_app):
    client,engine,saved=configured_app
    response=client.patch('/api/v1/settings/services/deepseek',json={'values':{'deepseek_api_key':' new-fake-secret ','deepseek_fast_model':'new-model'}})
    assert response.status_code==200
    assert engine.model_gateway.fast_provider.api_key=='new-fake-secret'
    assert engine.model_gateway.fast_provider.model=='new-model'
    assert saved['deepseek_api_key']=='new-fake-secret'
    response=client.patch('/api/v1/settings/services/deepseek',json={'values':{'deepseek_api_key':''}})
    assert response.status_code==200
    assert engine.settings.deepseek_api_key=='new-fake-secret'
    assert 'new-fake-secret' not in client.get('/api/v1/settings/services').text


def test_untrusted_origins_and_unrelated_fields_cannot_change_settings(configured_app):
    client,engine,saved=configured_app
    assert client.patch('/api/v1/settings/services/deepseek',headers={'Origin':'https://untrusted.invalid'},json={'values':{'deepseek_api_key':'bad'}}).status_code==403
    assert client.patch('/api/v1/settings/services/deepseek',json={'values':{'database_url':'bad'}}).status_code==400
    assert client.patch('/api/v1/settings/services/deepseek',json={'values':{'deepseek_base_url':'https://key:password@test.invalid'}}).status_code==400
    assert saved=={}
    assert engine.settings.deepseek_api_key=='old-fake-secret'


def test_secure_storage_failure_does_not_activate_unsaved_credentials(configured_app,monkeypatch):
    client,engine,_=configured_app
    def fail(values):
        raise RuntimeError('Cannot encrypt')
    monkeypatch.setattr(store,'save_overrides',fail)
    response=client.patch('/api/v1/settings/services/deepseek',json={'values':{'deepseek_api_key':'new-fake-secret'}})
    assert response.status_code==503
    assert engine.settings.deepseek_api_key=='old-fake-secret'


def test_didi_key_activates_provider_without_returning_secret(configured_app):
    client,engine,saved=configured_app
    response=client.patch('/api/v1/settings/services/didi',json={'values':{'didi_mcp_key':'fake-didi-secret'}})
    assert response.status_code==200
    assert engine.tool_gateway.didi.api_key=='fake-didi-secret'
    assert saved['didi_mcp_key']=='fake-didi-secret'
    services=client.get('/api/v1/settings/services')
    assert 'fake-didi-secret' not in services.text
    assert next(s for s in services.json() if s['id']=='didi')['configured']


@pytest.mark.parametrize('service,field',[('fliggy','fliggy_api_key'),('meituan','meituan_ht_token')])
def test_travel_keys_are_saved_but_never_returned(configured_app,service,field):
    client,engine,saved=configured_app
    assert client.patch('/api/v1/settings/services/'+service,json={'values':{field:'fake-travel-secret'}}).status_code==200
    assert getattr(engine.settings,field)=='fake-travel-secret'
    assert saved[field]=='fake-travel-secret'
    assert 'fake-travel-secret' not in client.get('/api/v1/settings/services').text


@pytest.mark.skipif(sys.platform!='win32',reason='Windows user protection')
def test_windows_store_is_encrypted_and_can_be_reloaded(tmp_path):
    path=tmp_path/'service-settings.bin'
    values={'tavily_api_key':'fake-qa-secret'}
    store.save_overrides(values,path)
    assert b'fake-qa-secret' not in path.read_bytes()
    assert store.read_overrides(path)==values
