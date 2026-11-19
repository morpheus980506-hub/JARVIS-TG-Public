from types import SimpleNamespace
from unittest.mock import AsyncMock
import json

import httpx

import pytest

from app.core.config import Settings
from app.models.gateway import ModelGateway
from app.models.providers.openai_compatible import OpenAICompatibleProvider
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage


@pytest.mark.asyncio
async def test_model_recovery_uses_only_configured_remote_api(monkeypatch):
    requested = []

    def respond(request):
        assert request.url.host == 'remote-model.example'
        model = json.loads(request.content)['model']
        requested.append(model)
        if model == 'cloud-primary' and requested.count(model) == 1:
            return httpx.Response(200, json={'choices': [{'message': {'content': 'Remote reply'}, 'finish_reason': 'stop'}]})
        return httpx.Response(503)

    client = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr('app.models.providers.openai_compatible.httpx.AsyncClient',
                        lambda **kwargs: client(transport=transport, **kwargs))
    gateway = ModelGateway(Settings(deepseek_base_url='https://remote-model.example', deepseek_api_key='test-key',
                                    deepseek_model='cloud-primary', deepseek_fast_model='cloud-fast', model_max_retries=0,
                                    model_primary_provider='ollama', ollama_base_url='http://127.0.0.1:11434'))
    messages = [{'role': 'user', 'content': 'Suggest a day trip.'}]
    result = await gateway.generate_fast(messages)
    assert result.content == 'Remote reply' and result.fallback_used
    with pytest.raises(RuntimeError, match='DeepSeek API is unavailable'):
        await gateway.generate_fast(messages)
    assert requested == ['cloud-fast', 'cloud-primary', 'cloud-fast', 'cloud-primary']


def test_reasoning_only_is_not_a_successful_answer():
    with pytest.raises(RuntimeError, match='no answer.*length'):
        OpenAICompatibleProvider._answer({'choices':[{'finish_reason':'length','message':{'content':None,'reasoning_content':'private reasoning'}}]})


@pytest.mark.asyncio
@pytest.mark.parametrize('content,finish,done,error',[
    (None,'stop',True,'no answer'),
    ('Hello',None,False,'before completion'),
    ('Hello','length',True,'incomplete'),
    ('Hello','stop',True,None),
])
async def test_stream_requires_a_real_complete_answer(monkeypatch,content,finish,done,error):
    body = 'data: ' + json.dumps({'choices':[{'delta':{'content':content,'reasoning_content':'never show this'},'finish_reason':finish}]}) + '\n\n'
    if done:
        body += 'data: [DONE]\n\n'
    client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200,text=body))
    monkeypatch.setattr('app.models.providers.openai_compatible.httpx.AsyncClient',lambda **kwargs: client(transport=transport,**kwargs))
    provider = OpenAICompatibleProvider('test','https://test.invalid','fake-key','test',1)
    if error:
        with pytest.raises(RuntimeError,match=error):
            _ = [piece async for piece in provider.stream([])]
    else:
        assert [piece async for piece in provider.stream([])] == ['Hello']


@pytest.mark.asyncio
async def test_empty_fast_stream_recovers_instead_of_returning_empty():
    gateway = ModelGateway(Settings())
    async def empty(*args, **kwargs):
        if False:
            yield ''
    gateway.fast_provider = SimpleNamespace(stream=empty)
    gateway.generate_fast = AsyncMock(return_value=SimpleNamespace(content='Recovered answer'))
    assert [chunk async for chunk in gateway.stream_fast([])] == ['Recovered answer']
    gateway.generate_fast.assert_awaited_once()


@pytest.mark.asyncio
async def test_interrupted_partial_answer_never_gets_a_second_answer_appended():
    gateway = ModelGateway(Settings())
    async def interrupted(*args, **kwargs):
        yield 'Partial'
        raise RuntimeError('Connection lost')
    gateway.fast_provider = SimpleNamespace(stream=interrupted)
    gateway.generate_fast = AsyncMock()
    pieces = []
    with pytest.raises(RuntimeError, match='partial answer'):
        async for piece in gateway.stream_fast([]):
            pieces.append(piece)
    assert pieces == ['Partial']
    gateway.generate_fast.assert_not_awaited()


@pytest.mark.asyncio
async def test_team_trip_advice_streams_without_standard_reasoning_request():
    engine = Orchestrator.__new__(Orchestrator)
    engine.settings = SimpleNamespace(deepseek_fast_model='test')
    captured = {}
    async def stream(messages, **kwargs):
        captured.update(kwargs)
        yield '建议先按出发城市和人数筛选团建目的地。'
    engine.model_gateway = SimpleNamespace(stream_fast=stream, generate=AsyncMock())
    engine.tool_gateway = SimpleNamespace(tavily=None,amap=None)
    callback = AsyncMock()
    result = await engine.travel_advice_general([ChatMessage(role='user',content='团建，你觉得上哪好？')], token_callback=callback)
    assert '团建' in result
    callback.assert_awaited_once_with(result)
    engine.model_gateway.generate.assert_not_awaited()
    assert captured['max_tokens'] == 700
