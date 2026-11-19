import asyncio
import logging
import time
from collections import deque
from typing import Any, AsyncIterator

from app.core.config import Settings
from app.models.providers.base import ModelProvider, ModelResult
from app.models.providers.openai_compatible import OpenAICompatibleProvider

logger = logging.getLogger(__name__)


class ModelGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.providers: dict[str, ModelProvider] = {
            "deepseek": OpenAICompatibleProvider(
                "deepseek",
                settings.deepseek_base_url,
                settings.deepseek_api_key,
                settings.deepseek_model,
                settings.model_timeout_seconds,
            ),
        }
        self.fast_provider = OpenAICompatibleProvider(
            "deepseek_fast",
            settings.deepseek_base_url,
            settings.deepseek_api_key,
            settings.deepseek_fast_model,
            settings.model_timeout_seconds,
        )
        self._semaphore = asyncio.Semaphore(settings.model_max_concurrency)
        self._failures: deque[float] = deque(maxlen=5)
        self._circuit_open_until = 0.0

    async def generate(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        primary = self.providers["deepseek"]
        if not primary.configured:
            raise RuntimeError("DeepSeek API is not configured")
        async with self._semaphore:
            if time.monotonic() >= self._circuit_open_until:
                for attempt in range(self.settings.model_max_retries + 1):
                    try:
                        return await primary.generate(messages, **kwargs)
                    except Exception as exc:
                        logger.warning("DeepSeek API attempt %s failed: %s", attempt + 1, type(exc).__name__)
                        self._failures.append(time.monotonic())
                        if attempt < self.settings.model_max_retries:
                            await asyncio.sleep(0.25 * (2**attempt))
                if len(self._failures) >= 3:
                    self._circuit_open_until = time.monotonic() + 30

            raise RuntimeError("DeepSeek API is unavailable")

    async def health(self) -> dict[str, bool]:
        pairs = await asyncio.gather(
            *[provider.health_check() for provider in self.providers.values()],
            return_exceptions=True,
        )
        return {
            name: value if isinstance(value, bool) else False
            for name, value in zip(self.providers, pairs)
        }

    async def generate_fast(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        kwargs = {
            "thinking": {"type": "disabled"},
            "reasoning_effort": "none",
            **kwargs,
        }
        try:
            async with self._semaphore:
                result = await self.fast_provider.generate(messages, **kwargs)
                if not result.content or not result.content.strip():
                    raise RuntimeError('Fast model returned no answer')
                return result
        except Exception as exc:
            logger.warning("DeepSeek fast model failed, trying the primary API model: %s", type(exc).__name__)
        result = await self.generate(messages, **kwargs)
        result.fallback_used = True
        return result

    async def stream_fast(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> AsyncIterator[str]:
        kwargs = {
            "thinking": {"type": "disabled"},
            "reasoning_effort": "none",
            **kwargs,
        }
        received = False
        try:
            async with self._semaphore:
                async for chunk in self.fast_provider.stream(messages, **kwargs):
                    received = received or bool(chunk.strip())
                    yield chunk
            if received:
                return
            raise RuntimeError('Fast model stream returned no answer')
        except Exception as exc:
            if received:
                # Never append a restarted answer to already visible partial text.
                raise RuntimeError('Model stream interrupted after partial answer') from exc
            logger.warning("DeepSeek stream failed, requesting a complete response: %s", type(exc).__name__)
        result = await self.generate_fast(messages, **kwargs)
        if result.content:
            yield result.content

    def _deep_provider(self) -> OpenAICompatibleProvider:
        primary = self.providers["deepseek"]
        if isinstance(primary, OpenAICompatibleProvider) and primary.configured:
            return primary
        if self.fast_provider.configured:
            return self.fast_provider
        raise RuntimeError("DeepSeek thinking mode is not configured")

    async def generate_deep(self, messages: list[dict[str, str]], *, max_tokens: int) -> ModelResult:
        async with self._semaphore:
            return await self._deep_provider().generate(
                messages, thinking={"type": "enabled"}, reasoning_effort="high", max_tokens=max(8192, max_tokens),
            )

    async def stream_deep(self, messages: list[dict[str, str]], *, max_tokens: int) -> AsyncIterator[str]:
        async with self._semaphore:
            async for chunk in self._deep_provider().stream(
                messages, thinking={"type": "enabled"}, reasoning_effort="high", max_tokens=max(8192, max_tokens),
            ):
                yield chunk

