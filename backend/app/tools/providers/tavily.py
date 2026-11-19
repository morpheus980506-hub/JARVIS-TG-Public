from datetime import datetime, timezone

import httpx

from app.schemas.domain import SourceFact
from app.tools.providers.base import SearchProvider


class TavilyProvider(SearchProvider):
    name = "tavily"

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.tavily.com",
        timeout: float = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport

    async def search(self, query: str, max_results: int = 5) -> list[SourceFact]:
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self.transport,
            headers={"Authorization": f"Bearer {self.api_key}"},
        ) as client:
            response = await client.post(
                f"{self.base_url}/search",
                json={
                    "query": query,
                    "search_depth": "basic",
                    "topic": "general",
                    "max_results": min(max_results, 10),
                    "include_answer": False,
                    "include_raw_content": False,
                    "include_published_date": True,
                    "safe_search": True,
                },
            )
            response.raise_for_status()
            body = response.json()
        fetched_at = datetime.now(timezone.utc)
        return [
            SourceFact(
                name=str(item.get("title") or "搜索结果"),
                value=str(item.get("content") or "").strip(),
                source_url=str(item.get("url") or ""),
                fetched_at=fetched_at,
            )
            for item in body.get("results", [])[:max_results]
            if item.get("url")
        ]

    async def health_check(self) -> bool:
        if not self.api_key:
            return False
        try:
            async with httpx.AsyncClient(
                timeout=min(self.timeout, 5),
                transport=self.transport,
                headers={"Authorization": f"Bearer {self.api_key}"},
            ) as client:
                response = await client.post(
                    f"{self.base_url}/search",
                    json={"query": "成都旅游", "max_results": 1, "search_depth": "basic"},
                )
                return response.status_code == 200
        except httpx.HTTPError:
            return False
