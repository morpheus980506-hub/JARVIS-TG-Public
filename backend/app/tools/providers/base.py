from abc import ABC, abstractmethod

from app.schemas.domain import SourceFact


class WeatherProvider(ABC):
    name: str

    @abstractmethod
    async def forecast(self, location: str, days: int) -> list[SourceFact]:
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> bool:
        raise NotImplementedError


class SearchProvider(ABC):
    name: str

    @abstractmethod
    async def search(self, query: str, max_results: int = 5) -> list[SourceFact]:
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> bool:
        raise NotImplementedError

