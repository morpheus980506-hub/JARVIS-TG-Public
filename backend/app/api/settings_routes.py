import asyncio
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.core import service_settings as store
from app.core.config import Settings, get_settings
from app.models.gateway import ModelGateway
from app.tools.gateway import ToolGateway


class ServiceUpdate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    values: dict[str,str|bool]


def build_settings_router(orchestrator):
    router=APIRouter(prefix='/api/v1/settings')
    lock=asyncio.Lock()

    def check_origin(request):
        allowed={orchestrator.settings.frontend_origin,'http://127.0.0.1:5173','http://localhost:5173',str(request.base_url).rstrip('/')}
        if request.headers.get('origin') and request.headers['origin'] not in allowed:
            raise HTTPException(status_code=403,detail='Untrusted configuration origin')

    @router.get('/services')
    async def services():
        return store.public_services(orchestrator.settings)

    @router.patch('/services/{service_id}')
    async def update_service(service_id: str,payload: ServiceUpdate,request:Request):
        check_origin(request)
        if service_id not in store.CATALOG:
            raise HTTPException(status_code=404,detail='Unknown service')
        fields={field[0]:field[3] for field in store.CATALOG[service_id][1]}
        changes={}
        for key,value in payload.values.items():
            if key not in fields:
                raise HTTPException(status_code=400,detail='Unknown service field')
            kind=fields[key]
            if kind == 'boolean':
                if not isinstance(value,bool):
                    raise HTTPException(status_code=400,detail='Expected a boolean value')
            else:
                if not isinstance(value,str) or len(value)>4096:
                    raise HTTPException(status_code=400,detail='Invalid field value')
                value=value.strip()
                if kind == 'secret' and not value:
                    continue
                if kind == 'url':
                    url=urlsplit(value)
                    if url.scheme not in {'http','https'} or not url.hostname or url.username or url.password or url.query or url.fragment:
                        raise HTTPException(status_code=400,detail='Provide an HTTP(S) service URL without credentials or query parameters')
            changes[key]=value
        async with lock:
            try:
                values={**store.read_overrides(),**changes}
                updated=Settings(**{**orchestrator.settings.model_dump(),**changes})
                models=ModelGateway(updated);tools=ToolGateway(updated)
                store.save_overrides(values)
            except (RuntimeError,OSError,ValueError):
                raise HTTPException(status_code=503,detail='Could not securely save service configuration')
            orchestrator.settings=updated
            orchestrator.model_gateway=models
            orchestrator.tool_gateway=tools
            get_settings.cache_clear()
        return {'saved':True,'restart_required':False}

    return router
