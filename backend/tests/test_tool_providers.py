import json

import httpx
import pytest

from app.tools.providers.amap import AmapProvider
from app.tools.providers.qweather import QWeatherProvider
from app.tools.providers.tavily import TavilyProvider
from app.tools.providers.variflight import VariFlightMcpProvider
from app.core.config import Settings
from app.tools.gateway import ToolGateway


@pytest.mark.parametrize("status", ["起飞", "已起飞", "到达", "已到达", "取消", "提前取消", "cancelled", "departed", "arrived", "开始登机", "正在登机", "催促登机", "登机结束", "boarding", "boarding closed"])
def test_completed_or_cancelled_flights_are_hidden(status):
    assert not ToolGateway._flight_pending({"flightStatus": status})


def test_delayed_flight_stays_visible_but_actual_departure_is_hidden():
    assert ToolGateway._flight_pending({"flightStatus": "延误", "departurePlanTime": "2026-11-07 05:00:00"})
    assert not ToolGateway._flight_pending({"flightStatus": "计划", "departureActualTime": "2026-11-07 06:00:00"})


@pytest.mark.asyncio
async def test_filter_precedes_limit_and_only_airport_lookups_are_cached():
    class Provider:
        def __init__(self):
            self.airport_calls = 0
            self.flight_calls = 0

        async def call_tool(self, name, arguments):
            if name == "searchAirport":
                self.airport_calls += 1
                code = "PKX" if arguments["name"] == "北京大兴" else "SHA"
                return {"structuredContent": {"items": [{"type": "airport", "code": code}]}}
            self.flight_calls += 1
            completed = [{"dep": "PKX", "arr": "SHA", "fnum": str(i), "flightStatus": "到达"} for i in range(40)]
            upcoming = {"dep": "PKX", "arr": "SHA", "fnum": "UPCOMING", "flightStatus": "计划"}
            return {"structuredContent": {"items": completed + [upcoming]}}

    gateway = ToolGateway(Settings())
    gateway.variflight = Provider()
    for _ in range(2):
        result = await gateway.flights("北京大兴", "上海虹桥", "2026-11-07")
        assert [flight.service_number for flight in result] == ["UPCOMING"]
    assert gateway.variflight.airport_calls == 2
    assert gateway.variflight.flight_calls == 2


@pytest.mark.asyncio
async def test_flight_query_filters_city_expansion_and_propagates_connection_errors():
    class Provider:
        async def call_tool(self, name, arguments):
            if name == "searchAirport":
                code = "PKX" if arguments["name"] == "北京大兴" else "SHA"
                return {"structuredContent": {"items": [{"type": "airport", "code": code}]}}
            assert name == "getFlightList"
            return {"structuredContent": {"items": [
                {"fnum": "TEST1", "dep": "PKX", "arr": "SHA"},
                {"fnum": "TEST2", "dep": "PKX", "arr": "PVG"},
            ]}}

    gateway = ToolGateway(Settings())
    gateway.variflight = Provider()
    options = await gateway.flights("北京大兴", "上海虹桥", "2026-11-07")
    assert [option.service_number for option in options] == ["TEST1"]

    class OfflineProvider:
        async def call_tool(self, name, arguments):
            raise httpx.ConnectError("offline")

    gateway.variflight = OfflineProvider()
    with pytest.raises(httpx.ConnectError):
        await gateway.flights("北京大兴", "上海虹桥", "2026-11-07")


@pytest.mark.asyncio
async def test_amap_poi_search_maps_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v5/place/text"
        assert request.url.params["key"] == "amap-key"
        return httpx.Response(
            200,
            json={
                "status": "1",
                "pois": [
                    {
                        "name": "测试博物馆",
                        "address": "测试路1号",
                        "location": "104.1,30.6",
                        "business": {"rating": "4.8"},
                    }
                ],
            },
        )

    provider = AmapProvider("amap-key", transport=httpx.MockTransport(handler))
    facts = await provider.search_poi("博物馆", "成都")
    assert facts[0].name == "测试博物馆"
    assert "4.8" in facts[0].value
    assert not facts[0].is_mock


@pytest.mark.asyncio
async def test_qweather_forecast_uses_dedicated_host_and_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-QW-Api-Key"] == "weather-key"
        if request.url.path == "/geo/v2/city/lookup":
            return httpx.Response(
                200,
                json={
                    "code": "200",
                    "location": [
                        {"name": "成都", "lat": "30.67", "lon": "104.07"}
                    ],
                },
            )
        assert request.url.path == "/weather/v1/daily/30.67/104.07"
        return httpx.Response(
            200,
            json={
                "metadata": {
                    "attributions": ["https://developer.qweather.com/attribution.html"]
                },
                "days": [
                    {
                        "forecastStartTime": "2026-11-20T00:00+08:00",
                        "daytime": {
                            "condition": {"text": "晴"},
                            "temperatureMax": {"value": 20},
                            "precipitation": {"probability": 0.1},
                        },
                        "nighttime": {"temperatureMin": {"value": 10}},
                    }
                ],
            },
        )

    provider = QWeatherProvider(
        "weather-key",
        "demo.qweatherapi.com",
        transport=httpx.MockTransport(handler),
    )
    facts = await provider.forecast("成都", 4)
    assert facts[0].name.startswith("2026-11-20 成都")
    assert "10–20°C" in facts[0].value
    assert "10%" in facts[0].value


@pytest.mark.asyncio
async def test_tavily_search_preserves_source_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tavily-key"
        payload = json.loads(request.content)
        assert payload["safe_search"] is True
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "成都文旅官方信息",
                        "url": "https://example.gov.cn/chengdu",
                        "content": "景点开放信息",
                    }
                ]
            },
        )

    provider = TavilyProvider(
        "tavily-key", transport=httpx.MockTransport(handler)
    )
    facts = await provider.search("成都旅游")
    assert facts[0].source_url == "https://example.gov.cn/chengdu"
    assert facts[0].value == "景点开放信息"


@pytest.mark.asyncio
async def test_variflight_mcp_initialization_supports_event_stream() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer mcp-key"
        return httpx.Response(
            200,
            headers={
                "content-type": "text/event-stream",
                "mcp-session-id": "session-1",
            },
            text='event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n\n',
        )

    provider = VariFlightMcpProvider(
        "mcp-key",
        "https://example.com/mcp",
        transport=httpx.MockTransport(handler),
    )
    body, session_id = await provider.initialize()
    assert body["result"]["protocolVersion"] == "2025-06-18"
    assert session_id == "session-1"


@pytest.mark.asyncio
async def test_transport_gateway_normalizes_train_and_flight_results() -> None:
    class FakeVariFlight:
        async def call_tool(self, name: str, arguments: dict) -> dict:
            if name == "domesticDirectTrainSearch":
                return {
                    "structuredContent": {
                        "item": {
                            "plans": [
                                {
                                    "train_no": "D100",
                                    "dep_station_name": "兰州",
                                    "arr_station_name": "成都东",
                                    "dep_time": "2026-11-20 07:00:00",
                                    "arr_time": "2026-11-20 14:00:00",
                                    "duration_min": 420,
                                    "price": 256,
                                    "tickets": {"二等座": {"count": 10}},
                                }
                            ]
                        }
                    }
                }
            if name == "searchAirport":
                code = "LHW" if arguments["name"] == "兰州" else "TFU"
                return {
                    "structuredContent": {
                        "items": [{"type": "airport", "code": code}]
                    }
                }
            if name == "getFlightList":
                assert arguments["dep"] == "LHW"
                assert arguments["arr"] == "TFU"
                return {
                    "structuredContent": {
                        "items": [
                            {
                                "fnum": "3U100",
                                "depAirport": "兰州中川",
                                "arrAirport": "成都天府",
                                "departurePlanTime": "2026-11-20 09:00:00",
                                "arrivalPlanTime": "2026-11-20 10:40:00",
                                "flightStatus": "计划",
                            }
                        ]
                    }
                }
            raise AssertionError(name)

    gateway = ToolGateway(
        Settings(
            open_meteo_enabled=False,
            amap_api_key="",
            qweather_api_key="",
            qweather_api_host="",
            tavily_api_key="",
            variflight_mcp_key="",
        )
    )
    gateway.variflight = FakeVariFlight()
    options, mode = await gateway.transport(
        "兰州", "成都", "2026-11-20", allow_mock=False
    )
    assert mode == "real"
    assert {item.mode for item in options} == {"train", "flight"}
    train = next(item for item in options if item.mode == "train")
    flight = next(item for item in options if item.mode == "flight")
    assert train.price_cny == 256
    assert train.availability == "可售余票约 10"
    assert flight.duration_minutes == 100
    assert not any(item.is_mock for item in options)
