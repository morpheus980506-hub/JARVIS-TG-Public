from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass(slots=True)
class ModelResult:
    content: str
    provider: str
    model: str
    raw: dict[str, Any] = field(default_factory=dict)
    fallback_used: bool = False


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def generate(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        raise NotImplementedError

    async def stream(self, messages: list[dict[str, str]], **kwargs: Any) -> AsyncIterator[str]:
        raise NotImplementedError(f"{self.name} does not implement streaming")
        yield ""

    async def structured_output(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        return await self.generate(messages, response_format={"type": "json_object"}, **kwargs)

    async def tool_call(self, messages: list[dict[str, str]], **kwargs: Any) -> ModelResult:
        return await self.generate(messages, **kwargs)

    @abstractmethod
    async def health_check(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def get_capabilities(self) -> set[str]:
        raise NotImplementedError

