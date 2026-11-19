from app.agents.base import BaseAgent
from app.agents.registry import AgentRegistry


class CapabilityRouter:
    def __init__(self, registry: AgentRegistry) -> None:
        self.registry = registry

    def select(self, capability: str) -> BaseAgent:
        candidates = self.registry.match(capability)
        if not candidates:
            raise LookupError(f"No agent supports capability: {capability}")
        return sorted(candidates, key=lambda agent: (agent.timeout_seconds, agent.agent_id))[0]

