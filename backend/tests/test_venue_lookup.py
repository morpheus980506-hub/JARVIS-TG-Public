import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api.routes import build_router
from app.agents.venue_lookup import venue_reply, wants_venue_lookup
from app.schemas.domain import ChatMessage, SourceFact


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmation", [None, "好", "好，查", "那你查呀", "为什么还是这个结果？", "结果呢？"])
async def test_concrete_venue_followup_queries_itinerary_stops_and_waits_for_stay_dates(confirmation):
    async def search_poi(query, area, **kwargs):
        return [
            SourceFact(name=f"{area}{query}候选", value=f"地址：吉林省{area}中心路",
                       source_url="https://uri.amap.com/marker?position=126.8,42.4"),
            SourceFact(name="外地结果", value="地址：日本某处",
                       source_url="https://uri.amap.com/marker?position=132.8,36.4"),
        ]

    amap = SimpleNamespace(search_poi=AsyncMock(side_effect=search_poi))
    platforms = SimpleNamespace(
        status=lambda: [dict(id=name, configured=True, client_installed=True) for name in ("fliggy", "meituan")],
        search=AsyncMock(return_value={"items": [
            {"title": "靖宇中心酒店", "price_text": "每晚 ¥300", "url": "https://router.feizhu.com/test"},
        ]}),
    )
    advisor = AsyncMock()
    app = FastAPI()
    app.include_router(build_router(SimpleNamespace(
        tool_gateway=SimpleNamespace(amap=amap), travel_gateway=platforms, travel_advice=advisor,
    )))
    messages = [
        {"role": "user", "content": "我打算去东北玩"},
        {"role": "user", "content": "OK，通化-白山"},
        {"role": "assistant", "content": "### D1 通化市区—靖宇\n- 下午：乘车往靖宇县，宿县城中心\n### D2 靖宇周边"},
        {"role": "user", "content": "我需要具体是住宿酒店和餐厅"},
    ]
    if confirmation:
        messages += [
            {"role": "assistant", "content": "需要我现在用高德地图按“靖宇县城中心酒店”“靖宇县东北菜”“通化烈士陵园附近餐厅”查具体名称和位置吗？"},
            {"role": "user", "content": confirmation if confirmation in ("好", "好，查") else "好"},
        ]
    if confirmation not in (None, "好", "好，查"):
        messages += [
            {"role": "assistant", "content": "好的，我现在用高德地图查一下。\n- 靖宇县城酒店\n- 靖宇县东北菜/铁锅炖\n- 通化杨靖宇烈士陵园附近餐厅\n我执行查询后再把可用的店名和位置给你。"},
            {"role": "user", "content": "那你查呀"},
        ]
    if confirmation in ("为什么还是这个结果？", "结果呢？"):
        messages += [
            {"role": "assistant", "content": "好，我现在查这3类点位：\n- 靖宇县城酒店\n- 靖宇铁锅炖/东北菜\n- 通化杨靖宇烈士陵园附近餐厅\n结果出来后，我会把具体店名、位置列给你。稍等。"},
            {"role": "user", "content": confirmation},
        ]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        stream = (await client.post("/api/v1/trips/intake/stream", json={"messages": messages})).raise_for_status()
        events = [json.loads(line) for line in stream.text.splitlines()]
        assert [(event["type"], event.get("status")) for event in events if event.get("stage") == "advice_places" or event["type"] == "result"] == [
            ("progress", "RUNNING"), ("progress", "SUCCESS"), ("result", None),
        ]
        first = events[-1]["intake"]["reply"]
        assert "通化餐厅候选" in first
        if confirmation:
            assert "通化烈士陵园附近" in first and "靖宇县东北菜候选" in first
            assert any(call.kwargs.get("location") == (126.8, 42.4) for call in amap.search_poi.await_args_list)
        else:
            assert "靖宇县酒店候选" in first and "靖宇餐厅候选" in first
        assert "外地结果" not in first and "入住和退房日期" in first
        assert amap.search_poi.await_count == (4 if confirmation else 3)
        assert "靖宇中心酒店" in first and "每晚 ¥300" not in first
        assert {call.args[:2] for call in platforms.search.await_args_list} == {("fliggy", "靖宇县"), ("meituan", "靖宇县")}
        assert all("入住日期尚未确认" in call.args[2] for call in platforms.search.await_args_list)
        platforms.search.reset_mock()
        start = datetime.now(timezone(timedelta(hours=8))).date() + timedelta(days=20)
        end = start + timedelta(days=1)
        messages += [
            {"role": "assistant", "content": first},
            {"role": "user", "content": f"{start.isoformat()}入住，{end.isoformat()}退房"},
        ]
        second = (await client.post("/api/v1/trips/intake", json={"messages": messages})).raise_for_status().json()["reply"]
        assert "靖宇中心酒店" in second and "每晚 ¥300" in second
        assert {call.args[:2] for call in platforms.search.await_args_list} == {("fliggy", "靖宇县"), ("meituan", "靖宇县")}
        assert all(str(start) in call.args[2] and str(end) in call.args[2] for call in platforms.search.await_args_list)
    advisor.assert_not_awaited()


def test_short_confirmation_without_a_map_offer_does_not_run_venue_lookup():
    messages = [
        ChatMessage(role="assistant", content="如果你想住在酒店附近，可以散步去餐厅。这个节奏合适吗？"),
        ChatMessage(role="user", content="好"),
    ]
    assert not wants_venue_lookup(messages)


@pytest.mark.parametrize("followup", ["好", "为什么还是这个结果？", "结果呢？"])
def test_acknowledging_completed_results_does_not_restart_the_previous_search(followup):
    messages = [
        ChatMessage(role="assistant", content="需要我用高德地图查酒店和附近餐厅吗？"),
        ChatMessage(role="user", content="好"),
        ChatMessage(role="assistant", content="酒店和餐厅已查完：[查看酒店](https://uri.amap.com/marker)"),
        ChatMessage(role="user", content=followup),
    ]
    assert not wants_venue_lookup(messages)


def test_pending_venue_lookup_does_not_replace_an_unrelated_request():
    messages = [
        ChatMessage(role="assistant", content="需要我现在用高德地图查酒店和附近餐厅吗？"),
        ChatMessage(role="user", content="现在三亚天气怎么样？"),
    ]
    assert not wants_venue_lookup(messages)


@pytest.mark.asyncio
async def test_dining_fallback_only_shows_local_public_store_pages():
    web = SimpleNamespace(search=AsyncMock(return_value=[
        SourceFact(name="靖宇某餐厅", value="地址：靖宇县", source_url="https://www.dianping.com/shop/Example"),
        SourceFact(name="异地餐厅", value="地址：上海", source_url="https://www.dianping.com/shop/Other"),
        SourceFact(name="靖宇攻略", value="酒店与餐厅", source_url="https://www.dianping.com/search/keyword/1"),
    ]))
    engine = SimpleNamespace(tool_gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=AsyncMock(return_value=[])), web_search=web))
    messages = [ChatMessage(role="user", content="推荐具体酒店和餐厅")]
    result = await venue_reply(engine, messages, {"destination": "靖宇县"}, "zh")
    assert "[靖宇某餐厅](https://www.dianping.com/shop/Example)" in result
    assert "异地餐厅" not in result and "靖宇攻略" not in result
    assert "公开大众点评店铺页" in result


@pytest.mark.asyncio
async def test_confirming_station_hotel_offer_overrides_old_overnight_stop():
    async def search_poi(query, area, **kwargs):
        assert area == "通化"
        if query == "通化火车站":
            return [SourceFact(name="通化站", value="地址：吉林省通化市",
                               source_url="https://uri.amap.com/marker?position=126.0,42.0")]
        assert query == "酒店" and kwargs["location"] == (126, 42)
        return [SourceFact(name="通化站快捷酒店", value="地址：通化市建设大街",
                           source_url="https://uri.amap.com/marker?position=126.01,42.0")]

    providers = SimpleNamespace(
        status=lambda: [dict(id=name, configured=True, client_installed=True) for name in ("fliggy", "meituan")],
        search=AsyncMock(return_value={"items": [
            {"title": "通化站快捷酒店", "url": "https://router.feizhu.com/example"},
        ]}),
    )
    engine = SimpleNamespace(tool_gateway=SimpleNamespace(amap=SimpleNamespace(search_poi=search_poi)), travel_gateway=providers)
    messages = [
        ChatMessage(role="user", content="我打算去东北玩"),
        ChatMessage(role="assistant", content="### D1 通化市区—靖宇\n- 下午：乘车往靖宇县，宿县城中心"),
        ChatMessage(role="user", content="价格会不会比较高？"),
        ChatMessage(role="assistant", content="需要我按“通化火车站周边、经济舒适型”帮你查酒店吗？"),
        ChatMessage(role="user", content="好"),
    ]
    assert wants_venue_lookup(messages)
    progress = AsyncMock()
    reply = await venue_reply(engine, messages, {"destination": "东北"}, "zh", progress)
    assert "通化火车站附近" in reply and "餐厅" not in reply and "靖宇县" not in reply
    assert {call.args[:2] for call in providers.search.await_args_list} == {("fliggy", "通化"), ("meituan", "通化")}
    assert all("通化火车站周边" in call.args[2] and "经济舒适型" in call.args[2] for call in providers.search.await_args_list)
    assert any("通化火车站周边酒店" in call.args[0]["message"] for call in progress.await_args_list)
    messages.extend([
        ChatMessage(role="assistant", content=reply),
        ChatMessage(role="user", content="2099-11-18入住，2099-11-19退房"),
    ])
    await venue_reply(engine, messages, {"destination": "东北"}, "zh")
    assert all("2099-11-18入住" in call.args[2] and call.args[1] == "通化" for call in providers.search.await_args_list[-2:])
