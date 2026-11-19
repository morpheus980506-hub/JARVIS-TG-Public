from datetime import datetime, timezone

import httpx

from app.schemas.domain import SourceFact
from app.tools.providers.base import WeatherProvider


WEATHER_CODES = {
    0: "晴",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "强毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    81: "较强阵雨",
    82: "强阵雨",
    95: "雷暴",
}


class OpenMeteoProvider(WeatherProvider):
    name = "open_meteo"
    geocoding_url = "https://geocoding-api.open-meteo.com/v1/search"
    forecast_url = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, timeout: float = 10) -> None:
        self.timeout = timeout

    async def forecast(self, location: str, days: int) -> list[SourceFact]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            geocode = await client.get(
                self.geocoding_url,
                params={"name": location, "count": 1, "language": "zh", "format": "json"},
            )
            geocode.raise_for_status()
            results = geocode.json().get("results", [])
            if not results:
                raise ValueError(f"无法定位目的地：{location}")
            place = results[0]
            response = await client.get(
                self.forecast_url,
                params={
                    "latitude": place["latitude"],
                    "longitude": place["longitude"],
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                    "timezone": "auto",
                    "forecast_days": min(days, 16),
                },
            )
            response.raise_for_status()
            body = response.json()
        daily = body["daily"]
        fetched_at = datetime.now(timezone.utc)
        facts = []
        for index, date_value in enumerate(daily["time"]):
            code = daily["weather_code"][index]
            summary = WEATHER_CODES.get(code, f"天气代码 {code}")
            value = (
                f"{summary}，{daily['temperature_2m_min'][index]}–"
                f"{daily['temperature_2m_max'][index]}°C，"
                f"最高降水概率 {daily['precipitation_probability_max'][index]}%"
            )
            facts.append(
                SourceFact(
                    name=f"{date_value} {place['name']}天气",
                    value=value,
                    source_url=str(response.url),
                    fetched_at=fetched_at,
                )
            )
        return facts

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                response = await client.get(self.geocoding_url, params={"name": "成都", "count": 1})
                return response.status_code == 200
        except httpx.HTTPError:
            return False

