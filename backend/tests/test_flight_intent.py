import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agents.flight_intent import resolve_flight_intent, confirmed_date
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage


def test_latest_explicit_date_overrides_old_relative_date_and_can_be_cleared():
    messages = [ChatMessage(role="user", content="今天"),
                ChatMessage(role="user", content="改为12月1日")]
    assert confirmed_date(messages, date(2026, 11, 7)) == date(2026, 12, 1)
    messages.append(ChatMessage(role="user", content="日期还没定"))
    assert confirmed_date(messages, date(2026, 11, 7)) is None


@pytest.mark.asyncio
async def test_fast_path_does_not_include_today_or_request_prefix_in_airport_name():
    gateway = SimpleNamespace(generate_fast=AsyncMock(side_effect=RuntimeError("offline")))
    result = await resolve_flight_intent([ChatMessage(role="user", content="今天北京飞深圳")], gateway)
    assert (result.origin, result.destination) == ("北京", "深圳")
    gateway.generate_fast.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("output", [
    "not json",
    '{"action":"lookup","origin":"北京","destination":"纽约"}',
    '{"action":"lookup","origin":"上海","destination":"深圳","departure_date":"2026-13-44"}',
    '{"action":"lookup","origin":"上海","destination":"上海"}',
])
async def test_invalid_or_ungrounded_state_never_reuses_old_route(output):
    gateway = SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=output)))
    decision = await resolve_flight_intent([ChatMessage(role="user", content="上海和深圳，反过来呢")], gateway)
    assert decision.action == "clarify"
    assert decision.question


@pytest.mark.asyncio
async def test_model_failure_requires_clarification():
    gateway = SimpleNamespace(generate_fast=AsyncMock(side_effect=RuntimeError("offline")))
    decision = await resolve_flight_intent([ChatMessage(role="user", content="换个地方")], gateway)
    assert decision.action == "clarify"


@pytest.mark.asyncio
async def test_complete_route_date_answer_and_retry_skip_model_without_reusing_rejected_route():
    gateway = SimpleNamespace(generate_fast=AsyncMock(side_effect=RuntimeError("offline")))
    messages = [ChatMessage(role="user", content="北京飞深圳")]
    result = await resolve_flight_intent(messages, gateway)
    assert result.departure_date is None
    messages.append(ChatMessage(role="user", content="今天"))
    result = await resolve_flight_intent(messages, gateway)
    assert result.departure_date is not None
    messages.append(ChatMessage(role="user", content="重新查询"))
    result = await resolve_flight_intent(messages, gateway)
    assert (result.origin, result.destination) == ("北京", "深圳")
    gateway.generate_fast.assert_not_awaited()
    messages.append(ChatMessage(role="user", content="不是北京了，还没想好哪里出发"))
    result = await resolve_flight_intent(messages, gateway)
    assert result.action == "clarify"
    messages.append(ChatMessage(role="user", content="重新查询"))
    result = await resolve_flight_intent(messages, gateway)
    assert result.action == "clarify"


@pytest.mark.asyncio
async def test_service_failure_allows_only_explicit_new_complete_route():
    gateway = SimpleNamespace(generate_fast=AsyncMock(side_effect=RuntimeError("offline")))
    base = [ChatMessage(role="user", content="今天温州飞深圳")]
    decision = await resolve_flight_intent(base + [ChatMessage(role="user", content="那上海飞深圳呢？")], gateway)
    assert (decision.action, decision.origin, decision.destination) == ("lookup", "上海", "深圳")
    assert decision._source == "explicit_route_fast_path"
    gateway.generate_fast.assert_not_awaited()
    for text in ["反过来呢", "不是温州出发了", "上海或者杭州出发", "重查"]:
        decision = await resolve_flight_intent(base + [ChatMessage(role="user", content=text)], gateway)
        assert decision.action == "clarify"
        assert "没有执行查询" in decision.question


@pytest.mark.asyncio
async def test_valid_edit_drives_actual_tool_arguments_and_ambiguity_skips_tool():
    messages = [ChatMessage(role="user", content="北京飞上海，深圳也可以"),
                ChatMessage(role="user", content="改深圳吧")]
    gateway = SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(content=json.dumps({
        "action": "lookup", "origin": "上海", "destination": "深圳", "departure_date": "2026-12-01",
    }))))
    decision = await resolve_flight_intent(messages, gateway)
    assert decision.departure_date == date(2026, 12, 1)
    engine = Orchestrator.__new__(Orchestrator)
    engine.model_gateway = gateway
    engine.tool_gateway = SimpleNamespace(flights=AsyncMock(return_value=[]))
    await engine.travel_advice(messages)
    engine.tool_gateway.flights.assert_awaited_once_with("上海", "深圳", "2026-12-01")
    gateway.generate_fast.return_value.content = '{"action":"clarify","question":"上海还是杭州出发？"}'
    engine.tool_gateway.flights.reset_mock()
    assert await engine.travel_advice(messages) == "上海还是杭州出发？"
    engine.tool_gateway.flights.assert_not_awaited()


@pytest.mark.asyncio
async def test_topic_change_does_not_trigger_flight_query():
    engine = Orchestrator.__new__(Orchestrator)
    engine.model_gateway = SimpleNamespace(generate_fast=AsyncMock(return_value=SimpleNamespace(
        content='{"action":"general"}',
    )))
    engine.tool_gateway = SimpleNamespace(flights=AsyncMock())
    engine.travel_advice_general = AsyncMock(return_value="深圳的美食……")
    messages = [ChatMessage(role="user", content="查上海飞深圳航班"),
                ChatMessage(role="user", content="当地有什么好吃的？")]
    assert await engine.travel_advice(messages) == "深圳的美食……"
    engine.tool_gateway.flights.assert_not_awaited()
