"""Small, cached forecast grid for map overlays. Never substitute mock weather."""
import asyncio
from math import isfinite, ceil, floor, log2
from datetime import datetime, timezone
from time import monotonic

import httpx
from pydantic import BaseModel, Field, model_validator


class WeatherBounds(BaseModel):
    grid_step: float | None = Field(default=None, ge=.125, le=32)
    west: float = Field(ge=-180, le=180, allow_inf_nan=False)
    east: float = Field(ge=-180, le=180, allow_inf_nan=False)
    south: float = Field(ge=-85, le=85, allow_inf_nan=False)
    north: float = Field(ge=-85, le=85, allow_inf_nan=False)

    @model_validator(mode='after')
    def ordered(self):
        if self.east <= self.west or self.north <= self.south:
            raise ValueError('Bounds must be ordered and cannot cross the date line')
        return self


class MapWeatherProvider:
    url = 'https://api.open-meteo.com/v1/forecast'

    def __init__(self, timeout=15, transport=None):
        self.timeout = timeout
        self.transport = transport
        self.cache = {}
        self.inflight = {}
        self.semaphore = asyncio.Semaphore(3)

    async def forecast(self, bounds: WeatherBounds) -> dict:
        # Samples are anchored to geographic coordinates, never to viewport edges.
        step = bounds.grid_step or max(.125,min(32,2**ceil(log2(max(.00001,round(bounds.east-bounds.west,5))/3))))
        step = max(.125,min(32,2**round(log2(step))))
        box = WeatherBounds(grid_step=step,west=max(-180,floor(bounds.west/step)*step),
                            east=min(180,ceil(bounds.east/step)*step),
                            south=max(-85,floor(bounds.south/step)*step),
                            north=min(85,ceil(bounds.north/step)*step))
        key = tuple(box.model_dump().values())
        cached = self.cache.get(key)
        if cached and monotonic() - cached[0] < 600:
            return cached[1]
        task = self.inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._fetch(box, key))
            self.inflight[key] = task
            # A disconnected requester must not cancel work shared by others.
            def completed(done):
                self.inflight.pop(key, None)
                if not done.cancelled():
                    done.exception()
            task.add_done_callback(completed)
        return await asyncio.shield(task)

    async def _fetch(self, box: WeatherBounds, key: tuple) -> dict:
        async with self.semaphore:
            step = box.grid_step
            xs = sorted({max(-180,min(180,i*step)) for i in range(floor(box.west/step),ceil(box.east/step)+1)})
            ys = sorted({max(-85,min(85,i*step)) for i in range(floor(box.south/step),ceil(box.north/step)+1)})
            points = [(lat,lng) for lat in ys for lng in xs]
            if len(points)>256:
                raise ValueError('Forecast region too tall; zoom out or use a wider viewport')
            fields = ['precipitation', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m']
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = await client.get(self.url, params={
                    'latitude': ','.join(str(p[0]) for p in points),
                    'longitude': ','.join(str(p[1]) for p in points),
                    'hourly': ','.join(fields), 'forecast_hours': 25,
                    'wind_speed_unit': 'ms', 'timezone': 'GMT',
                })
                response.raise_for_status()
                data = response.json()
            if not isinstance(data, list) or len(data) != len(points):
                raise ValueError('Incomplete forecast grid')
            hours = data[0].get('hourly', {}).get('time', [])
            if len(hours) < 25:
                raise ValueError('Forecast does not cover the requested 24 hours')
            values = []
            for (latitude, longitude), item in zip(points, data):
                hourly = item.get('hourly', {})
                if hourly.get('time') != hours or any(len(hourly.get(field, [])) != len(hours) for field in fields):
                    raise ValueError('Forecast time axes do not match')
                for field in fields:
                    if any(value is not None and (not isinstance(value, (int, float)) or not isfinite(value) or value < 0) for value in hourly[field]):
                        raise ValueError('Invalid forecast value')
                values.append({'latitude': latitude, 'longitude': longitude,
                               **{field: hourly[field] for field in fields}})
            result = {'bounds': box.model_dump(exclude={'grid_step'}), 'grid_step':step,'hours': [time + 'Z' for time in hours],
                      'points': values, 'source': 'Open-Meteo', 'source_url': 'https://open-meteo.com/',
                      'fetched_at': datetime.now(timezone.utc).isoformat()}
            if len(self.cache) >= 32:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = (monotonic(), result)
            return result
