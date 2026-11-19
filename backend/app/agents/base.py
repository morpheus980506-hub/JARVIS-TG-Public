from abc import ABC, abstractmethod
from datetime import datetime, timezone
from time import perf_counter
from typing import Any
import httpx

from app.schemas.domain import AgentStatus, AgentTrace


class BaseAgent(ABC):
    agent_id: str
    name: str
    description: str
    capabilities: set[str]
    tool_permissions: set[str] = set()
    timeout_seconds: float = 30
    max_retries: int = 1

    @abstractmethod
    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    async def run(self, state: dict[str, Any], input_summary: str = "") -> AgentTrace:
        start = datetime.now(timezone.utc)
        clock = perf_counter()
        trace = AgentTrace(
            agent_id=self.agent_id,
            agent_name=self.name,
            status=AgentStatus.RUNNING,
            started_at=start,
            input_summary=input_summary,
        )
        try:
            result = await self.execute(state)
            state.update(result)
            trace.status = AgentStatus.SUCCESS
            trace.output_summary = ", ".join(result.keys()) or "completed"
        except Exception as exc:
            trace.status = AgentStatus.FAILED
            trace.error = type(exc).__name__ if isinstance(exc,httpx.HTTPError) else str(exc)
        trace.finished_at = datetime.now(timezone.utc)
        trace.duration_ms = int((perf_counter() - clock) * 1000)
        return trace

