from typing import Any

from app.agents.base import BaseAgent
from app.agents.recommendation_checks import indoor_only


class ResearchAgent(BaseAgent):
    agent_id = "research"
    name = "Research Agent"
    description = "Collects destination facts with provenance"
    capabilities = {"destination_research", "attraction_research"}
    tool_permissions = {"weather", "search"}

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        requirement = state["requirement"]
        gateway = state["tool_gateway"]
        facts, mode = await gateway.research(
            requirement.destination,
            state["request"].allow_mock,
            **({"indoor": True} if indoor_only("；".join(requirement.preferences + requirement.hard_constraints)) else {}),
        )
        return {"research": facts, "research_mode": mode}

