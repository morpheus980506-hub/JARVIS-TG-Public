from datetime import date

import pytest

from app.agents.planner import MissingRequirementError, PlannerAgent
from app.schemas.domain import TripRequest


@pytest.mark.asyncio
async def test_planner_extracts_chinese_requirement() -> None:
    state = {
        "request": TripRequest(
            text="11月20日从兰州出发，去成都玩4天，两个人，预算3500元。",
        )
    }
    result = await PlannerAgent().execute(state)
    requirement = result["requirement"]
    assert requirement.origin == "兰州"
    assert requirement.destination == "成都"
    assert requirement.start_date == date(2026, 11, 20)
    assert requirement.days == 4
    assert requirement.travelers == 2
    assert requirement.budget_cny == 3500


@pytest.mark.asyncio
async def test_planner_rejects_missing_transaction_critical_fields() -> None:
    with pytest.raises(MissingRequirementError):
        await PlannerAgent().execute({"request": TripRequest(text="帮我规划一次旅行")})

