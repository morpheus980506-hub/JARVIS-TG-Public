import asyncio
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from app.agents.destination import invalid_route_place
from app.tools.providers.travel_search import TravelSearchGateway, TravelSearchError
from app.tools.providers.variflight import VariFlightQuotaError


class TravelQuery(BaseModel):
    model_config=ConfigDict(str_strip_whitespace=True,extra='forbid')
    city:str=Field(min_length=1,max_length=80)
    query:str=Field(min_length=2,max_length=2000)


class RailQuery(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin: str = Field(min_length=1, max_length=40)
    destination: str = Field(min_length=1, max_length=40)
    departure_date: date


def build_travel_router(orchestrator):
    router=APIRouter(prefix='/api/v1/travel')
    gateway=getattr(orchestrator,'travel_gateway',None) or TravelSearchGateway(orchestrator.settings)

    def current():
        gateway.settings=orchestrator.settings
        return gateway

    @router.get('/services')
    async def services():return current().status()

    @router.post('/rail')
    async def rail(payload: RailQuery):
        china_today = datetime.now(timezone(timedelta(hours=8))).date()
        if payload.departure_date < china_today or payload.origin == payload.destination:
            raise HTTPException(status_code=422, detail={'code': 'invalid_route'})
        tools = orchestrator.tool_gateway
        if tools.variflight is None:
            raise HTTPException(status_code=503, detail={'code': 'not_configured'})
        try:
            options = await asyncio.wait_for(
                tools.trains(payload.origin, payload.destination, payload.departure_date.isoformat()), timeout=24,
            )
        except TimeoutError:
            raise HTTPException(status_code=504, detail={'code': 'timeout'}) from None
        except VariFlightQuotaError:
            raise HTTPException(status_code=503, detail={'code': 'quota'}) from None
        except Exception:
            raise HTTPException(status_code=502, detail={'code': 'upstream'}) from None
        return {
            'provider': 'variflight_mcp',
            'options': [option.model_dump(mode='json') for option in options],
        }

    @router.post('/search/{provider}')
    async def search(provider:str,payload:TravelQuery,request:Request):
        if request.headers.get('origin') and request.headers['origin'] not in {
            orchestrator.settings.frontend_origin,'http://127.0.0.1:5173','http://localhost:5173',str(request.base_url).rstrip('/')}:
            raise HTTPException(status_code=403,detail='Untrusted search origin')
        if invalid_route_place(payload.city):
            raise HTTPException(status_code=422, detail={'code': 'invalid_city'})
        try:return await current().search(provider,payload.city,payload.query)
        except TravelSearchError as exc:
            status={'unsupported':404,'not_configured':503,'client_missing':503,'timeout':504,'auth':401}.get(exc.code,502)
            raise HTTPException(status_code=status,detail={'code':exc.code}) from None

    return router
