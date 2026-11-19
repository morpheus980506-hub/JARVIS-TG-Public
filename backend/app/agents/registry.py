from app.agents.base import BaseAgent


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {}

    def register(self, agent: BaseAgent) -> None:
        if agent.agent_id in self._agents:
            raise ValueError(f"Duplicate agent id: {agent.agent_id}")
        self._agents[agent.agent_id] = agent

    def unregister(self, agent_id: str) -> None:
        self._agents.pop(agent_id, None)

    def get(self, agent_id: str) -> BaseAgent:
        return self._agents[agent_id]

    def match(self, capability: str) -> list[BaseAgent]:
        return [agent for agent in self._agents.values() if capability in agent.capabilities]

    def list(self) -> list[BaseAgent]:
        return list(self._agents.values())

