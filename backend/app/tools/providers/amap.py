from datetime import datetime, timezone
from typing import Any

import httpx
import re
import asyncio
from urllib.parse import urlencode
from time import monotonic

from app.schemas.domain import SourceFact


class AmapLocationMismatch(ValueError):
    """Geocoder returned a broader or different administrative area."""


class AmapProvider:
    name = "amap"

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://restapi.amap.com",
        timeout: float = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport
        self._request_lock=asyncio.Lock()
        self._next_request=0.0
        self._coordinate_cache={}
        self._coordinate_locks={}

    async def _pace(self):
        if self.transport is not None:return
        async with self._request_lock:
            delay=self._next_request-monotonic()
            if delay>0:await asyncio.sleep(delay)
            self._next_request=monotonic()+0.5

    async def search_poi(
        self,
        keywords: str,
        region: str,
        max_results: int = 5,
        types: str | None = None,
        location: tuple[float,float] | None = None,
    ) -> list[SourceFact]:
        await self._pace()
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport
        ) as client:
            response = await client.get(
                f"{self.base_url}/v5/place/{'around' if location else 'text'}",
                params={
                    "key": self.api_key,
                    "keywords": keywords,
                    **({"region": region, "city_limit": "true"} if region else {}),
                    "page_size": min(max_results, 25),
                    "show_fields": "business",
                    **({'types':types} if types else {}),
                    **({'location':f'{location[0]:.6f},{location[1]:.6f}','radius':3000,'sortrule':'distance'} if location else {}),
                },
            )
            response.raise_for_status()
            body = response.json()
        self._ensure_success(body)
        fetched_at = datetime.now(timezone.utc)
        facts: list[SourceFact] = []
        for poi in body.get("pois", [])[:max_results]:
            business = poi.get("business") or {}
            full_address = "".join(dict.fromkeys(
                part for key in ("pname", "cityname", "adname", "address")
                if isinstance(part := poi.get(key), str) and part
            ))
            address = full_address or "地址未提供"
            rating = business.get("rating")
            detail = f"地址：{address}"
            if rating:
                detail += f"；高德评分：{rating}"
            facts.append(
                SourceFact(
                    name=str(poi.get("name") or keywords),
                    value=detail,
                    source_url='https://uri.amap.com/marker?'+urlencode({'position':poi.get('location',''),'name':poi.get('name','')}),
                    fetched_at=fetched_at,
                    place_type=poi.get('typecode') or None,
                    address=full_address or None,
                    opening_hours=business.get("opentime_week") if isinstance(business.get("opentime_week"), str) else None,
                )
            )
        return facts

    async def route(
        self,
        origin: str,
        destination: str,
        mode: str = "walking",
        **params: Any,
    ) -> dict[str, Any]:
        endpoints = {
            "driving": "/v5/direction/driving",
            "walking": "/v5/direction/walking",
            "bicycling": "/v5/direction/bicycling",
            "electric": "/v5/direction/electrobike",
            "motorcycle": "/v5/direction/motor",
        }
        if mode not in endpoints:
            raise ValueError(f"Unsupported Amap route mode: {mode}")
        request_params = {
            "key": self.api_key,
            "origin": origin,
            "destination": destination,
            **params,
        }
        await self._pace()
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport
        ) as client:
            response = await client.get(
                f"{self.base_url}{endpoints[mode]}", params=request_params
            )
            response.raise_for_status()
            body = response.json()
        self._ensure_success(body)
        return body

    async def geocode(self, address: str, *, city: str | None = None) -> list[dict]:
        params = {"key": self.api_key, "address": address}
        if city:
            params["city"] = city
        await self._pace()
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            response = await client.get(f"{self.base_url}/v3/geocode/geo", params=params)
            response.raise_for_status()
        body = response.json()
        self._ensure_success(body)
        return body.get("geocodes") or []

    async def driving_overview(self, origin: str, destination: str) -> dict[str, Any]:
        async def locate_uncached(address: str) -> str:
            candidates = await self.geocode(address)
            if not candidates or not candidates[0].get("location"):
                raise ValueError("无法定位自驾起终点")
            candidate=candidates[0]
            requested_province=re.match(r'(.+?(?:省|自治区|特别行政区))',address)
            if requested_province and candidate.get('province')!=requested_province.group(1):
                raise AmapLocationMismatch('请求省份与地图返回不一致')
            city_part=address[len(requested_province.group(1)):] if requested_province else address
            requested_city=re.match(r'([\u4e00-\u9fff]{2,15}?市)',city_part)
            actual_city=candidate.get('city')
            if requested_city and actual_city!=requested_city.group(1):
                raise AmapLocationMismatch('请求城市未被地图定位到')
            if candidate.get('level')=='省' and not actual_city:
                raise AmapLocationMismatch('地图只返回了省级位置，不能作为城市路程核验')
            return candidate['location']

        async def locate(address):
            async with self._coordinate_locks.setdefault(address,asyncio.Lock()):
                cached=self._coordinate_cache.get(address)
                if cached and cached[0]>monotonic():return cached[1]
                value=await locate_uncached(address)
                self._coordinate_cache[address]=(monotonic()+1200,value)
                if len(self._coordinate_cache)>256:self._coordinate_cache.pop(next(iter(self._coordinate_cache)))
                return value

        start, end = await asyncio.gather(locate(origin), locate(destination))
        body = await self.route(start, end, mode="driving", show_fields="cost")
        paths = (body.get("route") or {}).get("paths") or []
        if not paths:
            raise ValueError("未返回自驾路线")
        path = paths[0]
        return {"origin": origin, "destination": destination,
                "distance_km": round(float(path["distance"]) / 1000),
                "driving_hours": round(float((path.get("cost") or {})["duration"]) / 3600, 1),
                "source": "高德驾车路线；城市中心点估算，不含游玩、用餐和休息时间"}

    async def health_check(self) -> bool:
        if not self.api_key:
            return False
        try:
            async with httpx.AsyncClient(
                timeout=min(self.timeout, 5), transport=self.transport
            ) as client:
                response = await client.get(
                    f"{self.base_url}/v3/config/district",
                    params={"key": self.api_key, "keywords": "中国", "subdistrict": 0},
                )
                return response.status_code == 200 and response.json().get("status") == "1"
        except (httpx.HTTPError, ValueError):
            return False

    @staticmethod
    def _ensure_success(body: dict[str, Any]) -> None:
        if body.get("status") != "1":
            raise RuntimeError(
                f"Amap API error {body.get('infocode', 'unknown')}: "
                f"{body.get('info', 'unknown error')}"
            )
