from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.agents.intake import classify_conversation_mode, is_flight_query
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage
from app.tools.providers.amap import AmapProvider


def driving_messages():
    return [ChatMessage(role="user", content="帮我查从广州到北京的航班"),
            ChatMessage(role="assistant", content="已查询航班。"),
            ChatMessage(role="user", content="我改主意了，我要自驾"),
            ChatMessage(role="assistant", content="需要几天？"),
            ChatMessage(role="user", content="4天，我想边走边玩"),
            ChatMessage(role="assistant", content="可以分段。"),
            ChatMessage(role="user", content="全部细化")]


@pytest.mark.asyncio
async def test_driving_switch_keeps_context_and_uses_verified_distance_with_detail_budget():
    messages = driving_messages()
    assert not is_flight_query(messages)
    assert classify_conversation_mode(messages) == "advisor"
    engine = Orchestrator.__new__(Orchestrator)
    engine.settings = SimpleNamespace(deepseek_fast_model="test")
    engine.model_gateway = SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(
        content="详细行程", model="test")))
    engine.tool_gateway = SimpleNamespace(tavily=None, amap=SimpleNamespace(driving_overview=AsyncMock(
        return_value={"distance_km": 2100, "driving_hours": 24})))
    assert await engine.travel_advice(messages) == "详细行程"
    engine.tool_gateway.amap.driving_overview.assert_awaited_once_with("广州", "北京")
    args, kwargs = engine.model_gateway.generate_fast.call_args
    assert "2100" in args[0][0]["content"]
    assert "最后一天塞1000多公里" in args[0][0]["content"]
    assert kwargs["max_tokens"] == 2000


@pytest.mark.asyncio
async def test_amap_driving_overview_geocodes_places_and_normalizes_route():
    def handler(request):
        if request.url.path == "/v3/geocode/geo":
            return httpx.Response(200, json={"status": "1", "geocodes": [{"location": "113,23" if request.url.params["address"] == "广州" else "116,40"}]})
        assert request.url.params["origin"] == "113,23"
        assert request.url.params["destination"] == "116,40"
        return httpx.Response(200, json={"status": "1", "route": {"paths": [{"distance": "2100000", "cost": {"duration": "86400"}}]}})
    provider = AmapProvider("test", transport=httpx.MockTransport(handler))
    result = await provider.driving_overview("广州", "北京")
    assert result["distance_km"] == 2100
    assert result["driving_hours"] == 24


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["empty", "exception", "stream_empty"])
async def test_seven_day_followup_keeps_route_on_failure_and_never_suggests_other_destinations(failure):
    engine = Orchestrator.__new__(Orchestrator)
    engine.settings = SimpleNamespace(deepseek_fast_model="test")
    generator = AsyncMock(return_value=SimpleNamespace(content="", model="test"))
    if failure == "exception":
        generator.side_effect = RuntimeError("upstream unavailable")
    async def empty_stream(*args, **kwargs):
        if False:
            yield ""
    engine.model_gateway = SimpleNamespace(generate_fast=generator, stream_fast=empty_stream)
    engine.tool_gateway = SimpleNamespace(tavily=None, amap=None)
    messages = [ChatMessage(role="user", content="我打算从兰州开车到玉环"),
                ChatMessage(role="assistant", content="你大概计划用几天走完？"),
                ChatMessage(role="user", content="行，7天，你来安排")]
    events = []
    async def progress(event):
        events.append(event)
    reply = await engine.travel_advice(messages, progress=progress,
        token_callback=AsyncMock() if failure == "stream_empty" else None)
    assert "兰州 → 玉环" in reply
    assert "7天" in reply
    assert "失败" in reply
    assert "成都" not in reply and "人文" not in reply
    assert events[-1]["status"] == "FAILED"
    if failure != "stream_empty":
        _, kwargs = generator.call_args
        assert kwargs["max_tokens"] >= 2450
