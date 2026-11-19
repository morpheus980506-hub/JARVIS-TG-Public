from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.agents.base import BaseAgent
from app.schemas.domain import CostItem


def money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class BudgetAgent(BaseAgent):
    agent_id = "budget"
    name = "Budget Agent"
    description = "Calculates the budget with deterministic decimal arithmetic"
    capabilities = {"budget_calculation", "cost_optimization"}

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        req = state["requirement"]
        budget = Decimal(str(req.budget_cny))
        ratios = {
            "transport": Decimal("0.28"),
            "hotel": Decimal("0.32"),
            "food": Decimal("0.20"),
            "tickets": Decimal("0.10"),
            "reserve": Decimal("0.10"),
        }
        if req.days<=1:ratios['hotel']=Decimal('0')
        labels = {
            "transport": "往返及市内交通预算",
            "hotel": "住宿预算",
            "food": "餐饮预算",
            "tickets": "门票与活动预算",
            "reserve": "应急预留",
        }
        costs = [
            CostItem(category=key, description=labels[key], amount_cny=money(budget * ratio))
            for key, ratio in ratios.items()
        ]
        total = money(sum((Decimal(str(item.amount_cny)) for item in costs), Decimal("0")))
        return {"costs": costs, "total_cost_cny": total, "remaining_budget_cny": money(budget - Decimal(str(total)))}

