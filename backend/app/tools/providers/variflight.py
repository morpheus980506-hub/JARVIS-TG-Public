from typing import Any

import httpx
from app.core.version import VERSION


class VariFlightQuotaError(RuntimeError):
    pass


class VariFlightMcpProvider:
    name = "variflight_mcp"
    protocol_version = "2025-06-18"

    def __init__(
        self,
        api_key: str,
        url: str,
        timeout: float = 20,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.url = url
        self.timeout = timeout
        self.transport = transport

    def _headers(self, session_id: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        return headers

    async def initialize(self) -> tuple[dict[str, Any], str | None]:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": self.protocol_version,
                "capabilities": {},
                "clientInfo": {"name": "jarvis-tg", "version": VERSION},
            },
        }
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport, trust_env=False
        ) as client:
            response = await client.post(self.url, headers=self._headers(), json=payload)
            response.raise_for_status()
        return self._json_response(response), response.headers.get("mcp-session-id")

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        _, session_id = await self.initialize()
        payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport, trust_env=False
        ) as client:
            await client.post(
                self.url,
                headers=self._headers(session_id),
                json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            )
            response = await client.post(
                self.url, headers=self._headers(session_id), json=payload
            )
            response.raise_for_status()
        body = self._json_response(response)
        if "error" in body:
            raise RuntimeError(f"VariFlight MCP error: {body['error']}")
        result = body.get("result", {})
        if result.get("isError"):
            messages = (item.get("text", "") for item in result.get("content", []) if isinstance(item, dict))
            if any(any(phrase in str(message) for phrase in ("积分不足", "额度不足", "余额不足")) for message in messages):
                raise VariFlightQuotaError("VariFlight query quota exhausted")
            raise RuntimeError("VariFlight tool returned an error")
        return result

    async def list_tools(self) -> list[dict[str, Any]]:
        _, session_id = await self.initialize()
        payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        }
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport, trust_env=False
        ) as client:
            await client.post(
                self.url,
                headers=self._headers(session_id),
                json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            )
            response = await client.post(
                self.url, headers=self._headers(session_id), json=payload
            )
            response.raise_for_status()
        body = self._json_response(response)
        if "error" in body:
            raise RuntimeError(f"VariFlight MCP error: {body['error']}")
        return body.get("result", {}).get("tools", [])

    async def health_check(self) -> bool:
        if not self.api_key:
            return False
        try:
            body, _ = await self.initialize()
            return "result" in body and "error" not in body
        except (httpx.HTTPError, ValueError):
            return False

    @staticmethod
    def _json_response(response: httpx.Response) -> dict[str, Any]:
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            return response.json()
        for line in response.text.splitlines():
            if line.startswith("data:"):
                import json

                return json.loads(line[5:].strip())
        raise ValueError("MCP server returned an empty event stream")
