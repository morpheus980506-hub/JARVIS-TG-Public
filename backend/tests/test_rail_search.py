from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api.travel_routes import build_travel_router
from app.api.routes import build_router
from app.agents.intake import format_trip_memory
from app.agents.rail_search import rail_reply
from app.core.config import Settings
from app.schemas.domain import ChatMessage, TransportOption
from app.tools.gateway import ToolGateway


@pytest.mark.asyncio
async def test_rail_search_calls_only_the_direct_train_tool_and_filters_dates():
    settings = Settings()
    gateway = ToolGateway(settings)
    today = datetime.now(timezone(timedelta(hours=8))).date()
    departure = (today + timedelta(days=1)).isoformat()
    train = {
        "train_no": "G103",
        "dep_station_name": "北京南",
        "arr_station_name": "上海虹桥",
        "dep_time": f"{departure} 09:00:00",
        "arr_time": f"{departure} 13:00:00",
    }
    different_day = {**train, "train_no": "G105", "dep_time": f"{today.isoformat()} 09:00:00"}
    call_tool = AsyncMock(return_value={"structuredContent": {"item": {"plans": [train, different_day]}}})
    gateway.variflight = SimpleNamespace(call_tool=call_tool)
    app = FastAPI()
    app.include_router(build_travel_router(SimpleNamespace(settings=settings, tool_gateway=gateway)))

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        query = {"origin": " 北京 ", "destination": "上海", "departure_date": departure}
        response = await client.post("/api/v1/travel/rail", json=query)
        assert response.status_code == 200
        result = response.json()
        assert result["provider"] == "variflight_mcp"
        assert [option["service_number"] for option in result["options"]] == ["G103"]
        assert (await client.post("/api/v1/travel/rail", json={**query, "destination": "北京"})).status_code == 422

    call_tool.assert_awaited_once_with("domesticDirectTrainSearch", {
        "depDate": departure, "depCityName": "北京", "arrCityName": "上海",
    })


@pytest.mark.asyncio
async def test_chat_rail_followup_uses_the_confirmed_route_with_reply_options_enabled():
    today = datetime.now(timezone(timedelta(hours=8))).date()
    departure = (today + timedelta(days=1)).isoformat()
    option = TransportOption(mode="train", service_number="G103", provider="variflight_mcp",
                             departure_name="北京南", arrival_name="上海虹桥",
                             departure_time=f"{departure} 09:00", arrival_time=f"{departure} 13:00",
                             source_url="https://cmcp.variflight.com/")
    trains = AsyncMock(return_value=[option])
    app = FastAPI()
    app.include_router(build_router(SimpleNamespace(tool_gateway=SimpleNamespace(trains=trains))))
    messages = [
        {"role": "user", "content": "从温州去哈尔滨旅行，3天"},
        {"role": "assistant", "content": "准备哪一天出发？"},
        {"role": "user", "content": "查北京到上海的高铁", "web_search": True, "deep_thinking": True},
    ]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = (await client.post("/api/v1/trips/intake", json={"messages": messages})).json()
        assert "哪一天" in first["reply"]
        trains.assert_not_awaited()
        messages.extend([
            {"role": "assistant", "content": first["reply"]},
            {"role": "user", "content": "明天", "web_search": True, "deep_thinking": True},
        ])
        reply = (await client.post("/api/v1/trips/intake", json={"messages": messages})).json()["reply"]
    trains.assert_awaited_once_with("北京", "上海", departure)
    assert "G103" in reply and "kyfw.12306.cn" in reply
    facts, _ = format_trip_memory([ChatMessage.model_validate(message) for message in messages])
    assert facts["destination"] == "哈尔滨" and facts["start_date"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("message, expected_route", [
    ("出发地改成杭州", ("杭州", "上海")),
    ("到达地改为苏州", ("北京", "苏州")),
    ("反过来呢", ("上海", "北京")),
    ("日期先不定", None),
    ("取消查询", None),
    ("查明天北京到上海往返高铁", None),
])
async def test_rail_slot_edits_do_not_modify_the_saved_trip(message, expected_route):
    today = datetime.now(timezone(timedelta(hours=8))).date()
    departure = (today + timedelta(days=1)).isoformat()
    history = [
        ChatMessage(role="user", content="从温州去哈尔滨旅行，3天"),
        ChatMessage(role="assistant", content="准备哪一天出发？"),
        ChatMessage(role="user", content=f"查{departure}北京到上海的高铁"),
        ChatMessage(role="assistant", content="**铁路查询**\n\n北京 → 上海"),
        ChatMessage(role="user", content=message),
    ]
    trains = AsyncMock(return_value=[])
    reply = await rail_reply(SimpleNamespace(trains=trains), history)
    assert reply
    if expected_route:
        trains.assert_awaited_once_with(*expected_route, departure)
    else:
        trains.assert_not_called()
    facts, _ = format_trip_memory(history)
    assert (facts["origin"], facts["destination"], facts["start_date"]) == ("温州", "哈尔滨", None)


@pytest.mark.asyncio
async def test_rail_date_cleared_then_retry_does_not_query_stale_date():
    history = [
        ChatMessage(role="user", content="查明天北京到上海的高铁"),
        ChatMessage(role="assistant", content="**铁路查询**\n\n北京 → 上海"),
        ChatMessage(role="user", content="日期先不定"),
        ChatMessage(role="assistant", content="**铁路查询**\n\n你想查哪一天出发的直达车次？"),
        ChatMessage(role="user", content="重试"),
    ]
    trains = AsyncMock(return_value=[])
    reply = await rail_reply(SimpleNamespace(trains=trains), history)
    assert "哪一天" in reply
    trains.assert_not_called()
