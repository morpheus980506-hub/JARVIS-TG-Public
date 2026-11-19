from datetime import datetime, timezone
from typing import Any

import httpx

from app.schemas.domain import SourceFact
from app.tools.providers.base import WeatherProvider


class QWeatherProvider(WeatherProvider):
    name = "qweather"

    def __init__(
        self,
        api_key: str,
        api_host: str,
        timeout: float = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        host = api_host.strip().rstrip("/")
        self.base_url = host if host.startswith("http") else f"https://{host}"
        self.timeout = timeout
        self.transport = transport

    async def forecast(self, location: str, days: int) -> list[SourceFact]:
        headers = {"X-QW-Api-Key": self.api_key, "Accept-Encoding": "gzip"}
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport, headers=headers
        ) as client:
            lookup = await client.get(
                f"{self.base_url}/geo/v2/city/lookup",
                params={"location": location, "range": "cn", "number": 1, "lang": "zh"},
            )
            lookup.raise_for_status()
            location_body = lookup.json()
            self._ensure_legacy_success(location_body)
            matches = location_body.get("location", [])
            if not matches:
                raise ValueError(f"无法定位目的地：{location}")
            place = matches[0]
            response = await client.get(
                f"{self.base_url}/weather/v1/daily/{place['lat']}/{place['lon']}",
                params={"days": min(days, 10), "localTime": "true", "lang": "zh"},
            )
            response.raise_for_status()
            body = response.json()

        fetched_at = datetime.now(timezone.utc)
        facts: list[SourceFact] = []
        attributions = (body.get("metadata") or {}).get("attributions") or [
            "https://www.qweather.com/"
        ]
        for item in body.get("days", []):
            daytime = item.get("daytime") or {}
            nighttime = item.get("nighttime") or {}
            condition = (daytime.get("condition") or {}).get("text") or "天气信息"
            maximum = self._nested_value(daytime, "temperatureMax")
            minimum = self._nested_value(nighttime, "temperatureMin")
            precipitation = (daytime.get("precipitation") or {}).get("probability")
            date_value = str(item.get("forecastStartTime", ""))[:10]
            value = f"{condition}，{minimum}–{maximum}°C"
            if precipitation is not None:
                probability = float(precipitation)
                value += f"，降水概率 {probability * 100:.0f}%"
            facts.append(
                SourceFact(
                    name=f"{date_value} {place['name']}天气",
                    value=value,
                    source_url=str(attributions[0]),
                    fetched_at=fetched_at,
                )
            )
        if not facts:
            raise RuntimeError("QWeather returned no daily forecast")
        return facts

    async def health_check(self) -> bool:
        if not self.api_key or not self.base_url:
            return False
        try:
            async with httpx.AsyncClient(
                timeout=min(self.timeout, 5),
                transport=self.transport,
                headers={"X-QW-Api-Key": self.api_key},
            ) as client:
                response = await client.get(
                    f"{self.base_url}/geo/v2/city/lookup",
                    params={"location": "北京", "number": 1},
                )
                return response.status_code == 200 and bool(response.json().get("location"))
        except (httpx.HTTPError, ValueError):
            return False

    @staticmethod
    def _nested_value(item: dict[str, Any], key: str) -> Any:
        value = item.get(key) or {}
        return value.get("value", "?")

    @staticmethod
    def _ensure_legacy_success(body: dict[str, Any]) -> None:
        code = body.get("code")
        if code is not None and str(code) != "200":
            raise RuntimeError(f"QWeather API error: {code}")
