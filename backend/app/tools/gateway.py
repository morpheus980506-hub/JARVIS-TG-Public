import asyncio
import logging
from time import monotonic
from datetime import datetime, timezone
from typing import Any

from app.core.config import Settings
from app.schemas.domain import SourceFact, TransportOption
from app.tools.providers.amap import AmapProvider
from app.tools.providers.open_meteo import OpenMeteoProvider
from app.tools.providers.qweather import QWeatherProvider
from app.tools.providers.tavily import TavilyProvider
from app.tools.providers.variflight import VariFlightMcpProvider
from app.tools.providers.didi import DidiProvider
from app.tools.providers.web_search import WEB_SEARCH_TIMEOUT, BraveSearchProvider, ExaProvider, WebSearch

logger = logging.getLogger(__name__)


class ToolGateway:
    def __init__(self, settings: Settings) -> None:
        self.didi=DidiProvider(settings.didi_mcp_key) if settings.didi_mcp_key else None
        self._airport_cache: dict[str, tuple[float, dict]] = {}
        timeout = settings.tool_timeout_seconds
        self.open_meteo = OpenMeteoProvider(timeout=timeout) if settings.open_meteo_enabled else None
        self.qweather = (
            QWeatherProvider(
                settings.qweather_api_key,
                settings.qweather_api_host,
                timeout=timeout,
            )
            if settings.qweather_api_key and settings.qweather_api_host
            else None
        )
        self.amap = (
            AmapProvider(
                settings.amap_api_key,
                settings.amap_base_url,
                timeout=timeout,
            )
            if settings.amap_api_key
            else None
        )
        self.tavily = (
            TavilyProvider(
                settings.tavily_api_key,
                settings.tavily_base_url,
                timeout=timeout,
            )
            if settings.tavily_api_key
            else None
        )
        self.brave_search = BraveSearchProvider(settings.brave_search_api_key) if settings.brave_search_api_key else None
        self.exa = ExaProvider(settings.exa_api_key) if settings.exa_api_key else None
        search_providers = [provider for provider in (self.tavily, self.brave_search, self.exa) if provider]
        self.web_search = WebSearch(search_providers, timeout=min(timeout, WEB_SEARCH_TIMEOUT)) if search_providers else None
        self.variflight = (
            VariFlightMcpProvider(
                settings.variflight_mcp_key,
                settings.variflight_mcp_url,
                timeout=max(timeout, 20),
            )
            if settings.variflight_mcp_key
            else None
        )

    async def weather(
        self, location: str, days: int, allow_mock: bool
    ) -> tuple[list[SourceFact], str]:
        for provider in (self.qweather, self.open_meteo):
            if provider is None:
                continue
            try:
                facts = await provider.forecast(location, days)
                if facts:
                    return facts, "real"
            except Exception as exc:
                logger.warning("weather provider %s failed: %s", provider.name, type(exc).__name__)
        if not allow_mock:
            return [], "unavailable"
        return [
            SourceFact(
                name=f"{location}天气占位数据",
                value="外部天气服务暂不可用；演示模式按温和天气规划，请出发前复核。",
                source_url="mock://weather/unavailable",
                fetched_at=datetime.now(timezone.utc),
                is_mock=True,
            )
        ], "mock"

    async def research(
        self, destination: str, allow_mock: bool, max_results: int = 6, *, indoor: bool = False
    ) -> tuple[list[SourceFact], str]:
        jobs: list[tuple[str, Any]] = []
        if self.amap:
            jobs.append(
                (
                    "amap",
                    self.amap.search_poi(
                        "博物馆|美术馆|科技馆|展览馆" if indoor else "景点|博物馆",
                        destination, max_results=min(max_results, max_results // 2 + 2) if indoor else max_results // 2,
                    ),
                )
            )
        if self.web_search:
            jobs.append(
                (
                    "web_search",
                    self.web_search.search(
                        f"{destination} 旅游 景点 开放时间 特色美食 官方",
                        max_results=max_results // 2,
                    ),
                )
            )

        facts: list[SourceFact] = []
        if jobs:
            results = await asyncio.gather(
                *(job for _, job in jobs), return_exceptions=True
            )
            for (name, _), result in zip(jobs, results, strict=True):
                if isinstance(result, Exception):
                    logger.warning("research provider %s failed: %s", name, type(result).__name__)
                else:
                    facts.extend(result)
        if facts:
            return facts[:max_results], "real"
        if not allow_mock:
            return [], "unavailable"
        return [
            SourceFact(
                name="目的地研究状态",
                value=f"{destination} 的景点和餐饮信息目前为演示候选，需配置高德或 Tavily 后实时核验。",
                source_url="mock://research/destination-candidates",
                fetched_at=datetime.now(timezone.utc),
                is_mock=True,
            )
        ], "mock"

    async def transport(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        allow_mock: bool,
        max_each: int = 5,
    ) -> tuple[list[TransportOption], str]:
        options: list[TransportOption] = []
        if self.variflight:
            train_result, dep_result, arr_result = await asyncio.gather(
                self.variflight.call_tool(
                    "domesticDirectTrainSearch",
                    {
                        "depDate": departure_date,
                        "depCityName": origin,
                        "arrCityName": destination,
                    },
                ),
                self.variflight.call_tool(
                    "searchAirport", {"name": origin, "region": "CN"}
                ),
                self.variflight.call_tool(
                    "searchAirport", {"name": destination, "region": "CN"}
                ),
                return_exceptions=True,
            )
            if isinstance(train_result, Exception):
                logger.warning("train search failed: %s", type(train_result).__name__)
            else:
                options.extend(self._train_options(train_result, max_each))

            dep_codes = self._airport_codes(dep_result)
            arr_codes = self._airport_codes(arr_result)
            if dep_codes and arr_codes:
                try:
                    flight_result = await self.variflight.call_tool(
                        "getFlightList",
                        {
                            "date": departure_date,
                            "dep": ",".join(dep_codes),
                            "arr": ",".join(arr_codes),
                        },
                    )
                    options.extend(self._flight_options(flight_result, max_each))
                except Exception as exc:
                    logger.warning("flight search failed: %s", type(exc).__name__)

        if options:
            return options, "real"
        if not allow_mock:
            return [], "unavailable"
        return [
            TransportOption(
                mode="unknown",
                service_number="MOCK",
                provider="mock",
                departure_name=origin,
                arrival_name=destination,
                departure_time=f"{departure_date} 09:00:00",
                arrival_time=f"{departure_date} 12:00:00",
                availability="演示数据",
                status="需配置合规交通 Provider",
                source_url="mock://transport/unavailable",
                is_mock=True,
            )
        ], "mock"

    async def trains(self, origin: str, destination: str, departure_date: str) -> list[TransportOption]:
        if not self.variflight:
            raise RuntimeError("Rail search provider is not configured")
        result = await self.variflight.call_tool(
            "domesticDirectTrainSearch",
            {"depDate": departure_date, "depCityName": origin, "arrCityName": destination},
        )
        options = self._train_options(result, 100)
        return sorted(
            (option for option in options if option.departure_time.startswith(departure_date)
             and option.service_number != "未知车次"),
            key=lambda option: option.departure_time,
        )

    async def flights(self, origin: str, destination: str, departure_date: str) -> list[TransportOption]:
        if not self.variflight:
            raise RuntimeError("Flight provider is not configured")
        dep_result, arr_result = await asyncio.gather(
            self._flight_airport(origin),
            self._flight_airport(destination),
        )
        dep_codes = self._airport_codes(dep_result)
        arr_codes = self._airport_codes(arr_result)
        if not dep_codes or not arr_codes:
            raise ValueError("无法解析指定机场，请补充机场全名或三字码。")
        result = await self.variflight.call_tool("getFlightList", {
            "date": departure_date, "dep": ",".join(dep_codes), "arr": ",".join(arr_codes),
        })
        items = (result.get("structuredContent") or {}).get("items", [])
        # The upstream may expand airport queries to all airports in a city.
        items = [item for item in items if item.get("dep") in dep_codes and item.get("arr") in arr_codes]
        # Filter before sorting/limiting: completed flights must not crowd out
        # upcoming departures. Delays remain visible even after scheduled time.
        items = [item for item in items if self._flight_pending(item)]
        return self._flight_options({"structuredContent": {"items": items}}, 30)

    async def _flight_airport(self, name: str) -> dict:
        cached = self._airport_cache.get(name)
        if cached and monotonic() - cached[0] < 86400:
            return cached[1]
        result = await self.variflight.call_tool("searchAirport", {"name": name, "region": "CN"})
        if self._airport_codes(result):
            if len(self._airport_cache) >= 256:
                self._airport_cache.pop(next(iter(self._airport_cache)))
            self._airport_cache[name] = (monotonic(), result)
        return result

    @staticmethod
    def _flight_pending(item: dict) -> bool:
        status = str(item.get("flightStatus") or item.get("status") or "").lower().strip()
        if any(word in status for word in ("登机", "取消", "已起飞", "已到达", "已落地", "备降", "返航", "boarding", "cancel", "departed", "arrived", "landed", "airborne")):
            return False
        if status in {"起飞", "到达", "落地"}:
            return False
        return not bool(item.get("departureActualTime") or item.get("arrivalActualTime"))

    @staticmethod
    def _airport_codes(result: Any) -> list[str]:
        if isinstance(result, Exception):
            return []
        items = (result.get("structuredContent") or {}).get("items", [])
        codes: list[str] = []
        for item in items:
            if item.get("type") == "airport" and item.get("code"):
                code = str(item["code"])
                if code not in codes:
                    codes.append(code)
        return codes

    @staticmethod
    def _train_options(result: dict[str, Any], limit: int) -> list[TransportOption]:
        item = (result.get("structuredContent") or {}).get("item") or {}
        plans = item.get("plans") or []
        plans = sorted(
            plans,
            key=lambda plan: (
                plan.get("duration_min") or 10**9,
                plan.get("price") or 10**9,
            ),
        )[:limit]
        output: list[TransportOption] = []
        for plan in plans:
            ticket_count = sum(
                max(int(seat.get("count") or 0), 0)
                for seat in (plan.get("tickets") or {}).values()
                if isinstance(seat, dict)
            )
            output.append(
                TransportOption(
                    mode="train",
                    service_number=str(plan.get("train_no") or "未知车次"),
                    provider="variflight_mcp",
                    departure_name=str(plan.get("dep_station_name") or ""),
                    arrival_name=str(plan.get("arr_station_name") or ""),
                    departure_time=str(plan.get("dep_time") or ""),
                    arrival_time=str(plan.get("arr_time") or ""),
                    duration_minutes=plan.get("duration_min"),
                    price_cny=plan.get("price"),
                    availability=f"可售余票约 {ticket_count}" if ticket_count else "余票待核验",
                    status="可查询",
                    source_url="https://cmcp.variflight.com/",
                )
            )
        return output

    @staticmethod
    def _flight_options(result: dict[str, Any], limit: int) -> list[TransportOption]:
        items = (result.get("structuredContent") or {}).get("items", [])
        items = sorted(items, key=lambda item: item.get("departurePlanTime") or "")[:limit]
        output: list[TransportOption] = []
        for item in items:
            departure = str(item.get("departurePlanTime") or "")
            arrival = str(item.get("arrivalPlanTime") or "")
            duration: int | None = None
            try:
                duration = int(
                    (datetime.fromisoformat(arrival) - datetime.fromisoformat(departure)).total_seconds()
                    // 60
                )
            except (TypeError, ValueError):
                pass
            output.append(
                TransportOption(
                    mode="flight",
                    service_number=str(item.get("fnum") or "未知航班"),
                    provider="variflight_mcp",
                    departure_name=str(item.get("depAirport") or item.get("dep") or ""),
                    arrival_name=str(item.get("arrAirport") or item.get("arr") or ""),
                    departure_time=departure,
                    arrival_time=arrival,
                    duration_minutes=duration,
                    availability="票价及库存需二次核验",
                    status=str(item.get("flightStatus") or item.get("status") or "计划"),
                    source_url="https://cmcp.variflight.com/",
                )
            )
        return output

    async def health(self) -> dict[str, dict[str, bool]]:
        providers = {
            "open_meteo": self.open_meteo,
            "qweather": self.qweather,
            "amap": self.amap,
            "tavily": self.tavily,
            "brave_search": self.brave_search,
            "exa": self.exa,
            "variflight_mcp": self.variflight,
        }
        configured = [provider is not None for provider in providers.values()]
        checks = await asyncio.gather(
            *(
                provider.health_check() if provider else _false()
                for provider in providers.values()
            ),
            return_exceptions=True,
        )
        return {
            name: {
                "configured": is_configured,
                "healthy": bool(check) if not isinstance(check, Exception) else False,
            }
            for (name, _), is_configured, check in zip(
                providers.items(), configured, checks, strict=True
            )
        }


async def _false() -> bool:
    return False
