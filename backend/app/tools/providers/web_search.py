import asyncio
import logging
import re
from dataclasses import dataclass
from html import unescape
from urllib.parse import urlsplit

import httpx

from app.schemas.domain import SourceFact
from app.tools.providers.base import SearchProvider

logger = logging.getLogger(__name__)
WEB_SEARCH_TIMEOUT = 12


def plain_text(value: str, limit: int) -> str:
    return " ".join(re.sub(r"<[^>]*>", "", unescape(value)).split())[:limit]


class BraveSearchProvider(SearchProvider):
    name = "Brave Search"

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key
        self.transport = transport

    async def search(self, query: str, max_results: int = 5) -> list[SourceFact]:
        params = {"q": query, "count": max_results, "safesearch": "moderate"}
        if re.search(r"[\u3400-\u9fff]", query):
            params["search_lang"] = "zh-hans"
        async with httpx.AsyncClient(timeout=8, transport=self.transport) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params=params,
                headers={"X-Subscription-Token": self.api_key},
            )
            response.raise_for_status()
            return [
                SourceFact(name=str(item.get("title") or ""), value=str(item.get("description") or ""),
                           source_url=str(item.get("url") or ""))
                for item in (response.json().get("web") or {}).get("results", [])
            ]

    async def health_check(self) -> bool:
        await asyncio.wait_for(self.search("Brave Search", 1), timeout=5)
        return True


class ExaProvider(SearchProvider):
    name = "Exa"

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key
        self.transport = transport

    async def search(self, query: str, max_results: int = 5) -> list[SourceFact]:
        async with httpx.AsyncClient(timeout=8, transport=self.transport) as client:
            response = await client.post(
                "https://api.exa.ai/search",
                headers={"x-api-key": self.api_key},
                json={"query": query, "numResults": max_results, "type": "auto", "contents": {"highlights": True}},
            )
            response.raise_for_status()
            return [
                SourceFact(name=str(item.get("title") or ""),
                           value=" ".join(item.get("highlights") or []), source_url=str(item.get("url") or ""))
                for item in response.json().get("results", [])
            ]

    async def health_check(self) -> bool:
        await asyncio.wait_for(self.search("Exa Search", 1), timeout=5)
        return True


@dataclass
class WebSearchResult:
    provider: str | None
    facts: list[SourceFact]
    status: str


class WebSearch:
    def __init__(self, providers: list[SearchProvider], timeout: float = WEB_SEARCH_TIMEOUT):
        self.providers = providers
        self.timeout = timeout

    async def lookup(self, query: str, max_results: int = 5) -> WebSearchResult:
        if not self.providers:
            return WebSearchResult(None, [], "not_configured")
        max_results = max(1, min(max_results, 10))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.timeout
        empty_provider = None
        for index, provider in enumerate(self.providers):
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            # Leave time for a backup even when the first provider stalls.
            budget = remaining if index == len(self.providers) - 1 else remaining / 2
            try:
                results = await asyncio.wait_for(provider.search(query, max_results), timeout=budget)
            except Exception as error:
                logger.warning("Search provider %s failed: %s", provider.name, type(error).__name__)
                continue
            facts = []
            seen = set()
            for fact in results:
                url = fact.source_url.strip()
                try:
                    parsed = urlsplit(url)
                    valid = parsed.scheme in {"http", "https"} and parsed.hostname and parsed.username is None
                except ValueError:
                    continue
                if not valid or url in seen or fact.is_mock or any(char.isspace() for char in url):
                    continue
                seen.add(url)
                facts.append(fact.model_copy(update={
                    "name": plain_text(fact.name, 200) or parsed.hostname,
                    "value": plain_text(fact.value, 600),
                    "source_url": url,
                }))
                if len(facts) == max_results:
                    return WebSearchResult(provider.name, facts, "ok")
            if facts:
                return WebSearchResult(provider.name, facts, "ok")
            empty_provider = provider.name
        return WebSearchResult(empty_provider, [], "empty" if empty_provider else "unavailable")

    async def search(self, query: str, max_results: int = 5) -> list[SourceFact]:
        if max_results < 1:
            return []
        return (await self.lookup(query, max_results)).facts
