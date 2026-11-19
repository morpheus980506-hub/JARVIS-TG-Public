"""DiDi MCP: location search, estimates and user-confirmed App handoff only."""
import asyncio
import json
from uuid import uuid4

import httpx
from app.core.version import VERSION


class DidiError(RuntimeError):
    def __init__(self,code='unavailable'):
        self.code=code
        super().__init__('DiDi service '+code)


class DidiProvider:
    url='https://mcp.didichuxing.com/mcp-servers'
    allowed={'maps_textsearch','taxi_estimate','taxi_generate_ride_app_link'}

    def __init__(self,api_key,timeout=20,transport=None):
        self.api_key=api_key
        self.timeout=timeout
        self.transport=transport
        self.session=None
        self.initialized=False
        self.lock=asyncio.Lock()

    async def rpc(self,method,params,notification=False):
        request_id=uuid4().hex
        headers={'Accept':'application/json, text/event-stream','Content-Type':'application/json','MCP-Protocol-Version':'2025-06-18'}
        if self.session:
            headers['Mcp-Session-Id']=self.session
        payload={'jsonrpc':'2.0','method':method,'params':params}
        if not notification:
            payload['id']=request_id
        try:
            async with httpx.AsyncClient(timeout=self.timeout,transport=self.transport,trust_env=False) as client:
                async with client.stream('POST',self.url,params={'key':self.api_key},headers=headers,json=payload) as response:
                    if response.status_code in {401,403}:
                        raise DidiError('auth')
                    response.raise_for_status()
                    if response.headers.get('mcp-session-id'):
                        self.session=response.headers['mcp-session-id']
                    if notification:
                        return {}
                    if 'text/event-stream' in response.headers.get('content-type',''):
                        data=[]
                        async for line in response.aiter_lines():
                            if line.startswith('data:'):
                                data.append(line[5:].strip())
                            elif not line and data:
                                try:
                                    body=json.loads('\n'.join(data))
                                except ValueError:
                                    data=[];continue
                                data=[]
                                if isinstance(body,dict) and body.get('id') == request_id:
                                    return body
                        if data:
                            body=json.loads('\n'.join(data))
                            if isinstance(body,dict) and body.get('id') == request_id:
                                return body
                        raise DidiError()
                    body=json.loads(await response.aread())
                    if not isinstance(body,dict) or body.get('id') != request_id:raise DidiError()
                    return body
        except httpx.HTTPError:
            # httpx exceptions include the request URL; do not propagate a key-bearing URL.
            raise DidiError() from None

    async def call_tool(self,name,arguments):
        if name not in self.allowed:
            raise DidiError('unsupported')
        if not self.api_key:
            raise DidiError('not_configured')
        async with self.lock:
            if not self.initialized:
                body=await self.rpc('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'jarvis-tg','version':VERSION}})
                if body.get('error',{}).get('code') == -32002:
                    raise DidiError('auth')
                if 'error' in body and body['error'].get('code') != -32601:
                    raise DidiError()
                if 'error' not in body:
                    await self.rpc('notifications/initialized',{},True)
                self.initialized=True
        body=await self.rpc('tools/call',{'name':name,'arguments':arguments})
        if 'error' in body:
            raise DidiError('auth' if body['error'].get('code') == -32002 else 'unavailable')
        result=body.get('result',{})
        if not isinstance(result,dict):raise DidiError()
        if result.get('isError'):
            raise DidiError()
        return result
