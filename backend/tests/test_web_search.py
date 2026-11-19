import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api.routes import build_router
from app.agents.web_relevance import travel_web_query
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage, SourceFact
from app.tools.providers.tavily import TavilyProvider
from app.tools.providers.web_search import BraveSearchProvider, ExaProvider, WebSearch


@pytest.mark.asyncio
async def test_general_web_search_filters_wrong_places_and_unrelated_topics_before_reply():
    facts = [
        SourceFact(name="东北振兴发展座谈会", value="提到东北的旅游行业。", source_url="https://news.example/economy"),
        SourceFact(name="日本东北抗战遗址", value="日本当地旅行资料。", source_url="https://japan.example/history"),
        SourceFact(name="白山抗联遗址参观资料", value="东北抗战纪念设施。", source_url="https://history.example/baishan"),
    ]
    search = AsyncMock(return_value=facts)
    engine = Orchestrator.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(web_search=SimpleNamespace(search=search))

    async def deep_stream(prompt, **kwargs):
        assert "history.example" in prompt[0]["content"]
        assert "news.example" not in prompt[0]["content"]
        yield "可以看抗联遗址。"

    engine.model_gateway = SimpleNamespace(stream_deep=deep_stream)
    messages = [ChatMessage(role="user", content="我想去东北旅游"),
                ChatMessage(role="assistant", content="你比较想看什么？"),
                ChatMessage(role="user", content="抗日战争遗址"),
                ChatMessage(role="assistant", content="可以看几处不同类型的遗址。"),
                ChatMessage(role="user", content="可以再具体一点吗？")]
    events = []

    async def token(content):
        events.append(content)

    reply = await engine.travel_advice_general(messages, token_callback=token, chat_options=True, deep_thinking=True)
    assert search.call_args.args[0] == "东北 抗日战争遗址"
    assert "history.example" in reply and "news.example" not in reply and "japan.example" not in reply
    # A different larger region with the same name must not become a local source.
    assert len(events) == 2


@pytest.mark.parametrize("latest", ["为什么还是这个结果？", "好，查", "休假", "就我一个人去"])
def test_web_search_does_not_query_turn_management_or_simple_answers(latest):
    messages = [ChatMessage(role="user", content="我想查东北抗战遗址"),
                ChatMessage(role="assistant", content="你打算哪天去？"),
                ChatMessage(role="user", content=latest)]
    assert travel_web_query(messages, "东北") is None


@pytest.mark.asyncio
async def test_chat_search_uses_backups_and_returns_safe_cited_results():
    calls = []

    def upstream(request):
        calls.append(request.url.host)
        if request.url.host == "api.tavily.com":
            return httpx.Response(429)
        if request.url.host == "api.search.brave.com":
            assert request.headers["x-subscription-token"] == "brave-test"
            assert request.url.params["search_lang"] == "zh-hans"
            assert request.url.params["q"] == "哈尔滨博物馆"
            return httpx.Response(200, json={"web": {"results": []}})
        assert request.url.host == "api.exa.ai"
        assert request.headers["x-api-key"] == "exa-test"
        assert b'"highlights":true' in request.content
        return httpx.Response(200, json={"results": [
            {"title": "Bad link", "url": "javascript:alert(1)"},
            {"title": "<b>哈尔滨博物馆</b>", "url": "https://museum.example/",
             "highlights": ["<b>开放</b> &amp; 预约"]},
            {"title": "Duplicate", "url": "https://museum.example/"},
        ]})

    mock = httpx.MockTransport(upstream)
    search = WebSearch([
        TavilyProvider("tavily-test", transport=mock),
        BraveSearchProvider("brave-test", transport=mock),
        ExaProvider("exa-test", transport=mock),
    ])
    result = await search.lookup("哈尔滨博物馆")
    assert result.status == "ok" and result.provider == "Exa"
    assert len(result.facts) == 1
    fact = result.facts[0]
    assert fact.name == "哈尔滨博物馆"
    assert fact.value == "开放 & 预约"
    assert fact.source_url == "https://museum.example/"
    assert calls == ["api.tavily.com", "api.search.brave.com", "api.exa.ai"]


@pytest.mark.asyncio
@pytest.mark.parametrize("web_search", [True, False, None])
async def test_chat_options_drive_streaming_reply_and_include_sources(web_search):
    import json

    fact = SourceFact(name="City museum", value="Book a time slot.", source_url="https://museum.example/")
    search = AsyncMock(return_value=[fact])

    async def deep_stream(prompt, **kwargs):
        assert ("Book a time slot." in prompt[0]["content"]) is (web_search is not False)
        yield "Here is the final answer."

    engine = Orchestrator.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(web_search=SimpleNamespace(search=search))
    engine.model_gateway = SimpleNamespace(stream_deep=deep_stream)
    app = FastAPI()
    app.include_router(build_router(engine))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/trips/intake/stream", json={
            "language": "en",
            "messages": [{"role": "user", "content": "Where is the museum visitor announcement?",
                          **({} if web_search is None else {"web_search": web_search, "deep_thinking": True})}],
        })
    events = [json.loads(line) for line in response.text.splitlines()]
    assert any(event.get("stage") == "deep_thinking" for event in events)
    deltas = "".join(event["content"] for event in events if event["type"] == "delta")
    reply = events[-1]["intake"]["reply"]
    assert reply == deltas
    assert reply.startswith("Here is the final answer.")
    assert ("[City museum](https://museum.example/)" in reply) is (web_search is not False)
    assert search.await_count == int(web_search is not False)


@pytest.mark.asyncio
@pytest.mark.parametrize("web_search,deep_thinking", [(False, False), (False, True), (True, False), (True, True)])
async def test_cycling_lookup_runs_independently_of_chat_options(web_search, deep_thinking):
    import json

    stop = SourceFact(name="天坛公园", value="测试地点",
                      source_url="https://uri.amap.com/marker?position=116.41,39.88")
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "北京市东城区东长安街1号", "location": "116.41,39.91"}]),
        search_poi=AsyncMock(return_value=[stop]),
        route=AsyncMock(return_value={"route": {"paths": [{"distance": "3300", "cost": {"duration": "720"}}]}}),
    )
    engine = Orchestrator.__new__(Orchestrator)
    notice = SourceFact(name="通行公告", value="公开资料", source_url="https://notice.example/")
    engine.tool_gateway = SimpleNamespace(amap=amap, web_search=SimpleNamespace(search=AsyncMock(return_value=[notice])))
    app = FastAPI()
    app.include_router(build_router(engine))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/trips/intake/stream", json={"messages": [
            {"role": "user", "content": "自行车骑行，从北京市东城区东长安街1号到天坛公园"},
            {"role": "assistant", "content": "我没有地图访问能力。"},
            {"role": "user", "content": "你确定没法用地图？", "web_search": web_search, "deep_thinking": deep_thinking},
        ]})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert any(event.get("stage") == "cycling_route" for event in events)
    assert "3.3 公里" in events[-1]["intake"]["reply"]
    assert amap.route.await_count == 2
    search = engine.tool_gateway.web_search.search
    assert search.await_count == int(web_search)
    assert ("https://notice.example/" in events[-1]["intake"]["reply"]) is web_search
    if web_search:
        assert "东长安街1号" not in search.call_args.args[0]


@pytest.mark.asyncio
async def test_chat_options_do_not_bypass_collecting_explicit_trip_requirements():
    engine = Orchestrator.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace()
    app = FastAPI()
    app.include_router(build_router(engine))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/trips/intake", json={"messages": [{
            "role": "user", "content": "帮我规划从杭州去哈尔滨旅行，明天出发，3天，2人，总预算5000元，吃素",
            "web_search": True, "deep_thinking": True,
        }]})
    result = response.json()
    assert result["ready"] and result["trip_request"]["budget_cny"] == 5000


@pytest.mark.asyncio
async def test_slow_primary_does_not_consume_backup_time():
    async def slow(*args):
        await asyncio.sleep(10)

    primary = SimpleNamespace(name="primary", search=AsyncMock(side_effect=slow))
    fact = SourceFact(name="Museum", value="Hours", source_url="https://museum.example")
    backup = SimpleNamespace(name="backup", search=AsyncMock(return_value=[fact]))
    result = await WebSearch([primary, backup], timeout=0.15).lookup("museum")
    assert result.provider == "backup" and len(result.facts) == 1


@pytest.mark.asyncio
async def test_brave_maps_web_snippets_and_links():
    def upstream(request):
        assert request.method == "GET"
        assert request.url.path == "/res/v1/web/search"
        return httpx.Response(200, json={"web": {"results": [
            {"title": "City museum", "description": "<strong>Hours</strong> and tickets",
             "url": "https://museum.example/hours"},
        ]}})

    search = WebSearch([BraveSearchProvider("brave-test", transport=httpx.MockTransport(upstream))])
    result = await search.lookup("museum hours")
    assert result.provider == "Brave Search"
    assert result.facts[0].value == "Hours and tickets"
    assert result.facts[0].source_url == "https://museum.example/hours"


@pytest.mark.asyncio
async def test_primary_success_does_not_call_backup():
    fact = SourceFact(name="Museum", value="Hours", source_url="https://museum.example")
    primary = SimpleNamespace(name="primary", search=AsyncMock(return_value=[fact]))
    backup = SimpleNamespace(name="backup", search=AsyncMock())
    result = await WebSearch([primary, backup]).lookup("museum")
    assert result.status == "ok" and result.provider == "primary"
    backup.search.assert_not_awaited()
