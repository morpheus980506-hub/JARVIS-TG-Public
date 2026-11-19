from typing import Any
import re

from app.agents.base import BaseAgent
from app.agents.intake import request_is_driving


class TransportAgent(BaseAgent):
    agent_id = "transport"
    name = "Transport Agent"
    description = "Queries compliant rail and flight providers and normalizes candidates"
    capabilities = {"intercity_transport", "flight_search", "train_search"}
    tool_permissions = {"variflight_mcp"}
    timeout_seconds = 90
    max_retries = 1

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        requirement = state["requirement"]
        if request_is_driving(state['request']):
            return {'transport':[],'transport_mode':'not_required'}
        text = state['request'].text
        if re.search(r'骑行|骑自行车|骑车|骑电动|骑摩托|\bcycling\b', text, re.I) and not re.search(
            r'高铁|火车|航班|飞机|机票|铁路|\b(?:flight|train|rail)\b', text, re.I,
        ):
            return {'transport': [], 'transport_mode': 'not_required'}
        options, mode = await state["tool_gateway"].transport(
            requirement.origin,
            requirement.destination,
            requirement.start_date.isoformat(),
            state["request"].allow_mock,
        )
        return {"transport": options, "transport_mode": mode}
