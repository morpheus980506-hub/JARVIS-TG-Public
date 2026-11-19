from datetime import date

import pytest

from app.agents.budget import BudgetAgent
from app.schemas.domain import Requirement


@pytest.mark.asyncio
async def test_budget_is_deterministic_and_balanced() -> None:
    state = {
        "requirement": Requirement(
            origin="兰州",
            destination="成都",
            start_date=date(2026, 11, 20),
            days=4,
            travelers=2,
            budget_cny=3500,
        )
    }
    result = await BudgetAgent().execute(state)
    assert result["total_cost_cny"] == 3500
    assert sum(item.amount_cny for item in result["costs"]) == 3500

