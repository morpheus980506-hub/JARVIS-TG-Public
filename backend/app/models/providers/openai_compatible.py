import json
from typing import Any, AsyncIterator

import httpx

from app.models.providers.base import ModelProvider, ModelResult


class OpenAICompatibleProvider(ModelProvider):
    def __init__(self, name: str, base_url: str, api_key: str, model: str, timeout: float) -> None:
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model)

    async def list_models(self) -> list[str]:
        if not self.api_key:
            return []
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            return [item["id"] for item in response.json().get("data", [])]

    async def generate(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        if not self.configured:
            raise RuntimeError(f"{self.name} is not configured")
        payload = {"model": self.model, "messages": messages, **kwargs}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
        return ModelResult(
            content=self._answer(body),
            provider=self.name,
            model=body.get("model", self.model),
            raw=body,
        )

    @staticmethod
    def _answer(body: dict) -> str:
        choice = body['choices'][0]
        content = choice.get('message', {}).get('content') or ''
        if not content.strip():
            # Reasoning is not a user-facing answer. Let the gateway recover.
            raise RuntimeError(f"Model returned no answer (finish_reason={choice.get('finish_reason', 'unknown')})")
        return content

    async def stream(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> AsyncIterator[str]:
        if not self.configured:
            raise RuntimeError(f"{self.name} is not configured")
        payload = {"model": self.model, "messages": messages, "stream": True, **kwargs}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            ) as response:
                response.raise_for_status()
                received = False
                finished = False
                finish_reason = None
                async for line in response.aiter_lines():
                    if line == 'data: [DONE]':
                        finished = True
                        break
                    if not line.startswith("data: "):
                        continue
                    body = json.loads(line[6:])
                    choices = body.get("choices") or []
                    if not choices:
                        continue
                    content = choices[0].get("delta", {}).get("content") or ""
                    if content:
                        received = received or bool(content.strip())
                        yield content
                    if choices[0].get('finish_reason'):
                        finished = True
                        finish_reason = choices[0]['finish_reason']
                if not received:
                    raise RuntimeError('Model stream returned no answer')
                if not finished:
                    raise RuntimeError('Model stream ended before completion')
                if finish_reason in {'length', 'content_filter'}:
                    raise RuntimeError(f'Model stream incomplete (finish_reason={finish_reason})')

    async def health_check(self) -> bool:
        try:
            return self.configured and bool(await self.list_models())
        except (httpx.HTTPError, KeyError, ValueError):
            return False

    def get_capabilities(self) -> set[str]:
        return {"generate", "stream", "structured_output", "tool_call"}

