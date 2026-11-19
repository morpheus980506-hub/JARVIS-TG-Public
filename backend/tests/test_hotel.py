from datetime import date

import pytest

from app.agents.hotel import HotelAgent
from app.schemas.domain import Requirement


@pytest.mark.asyncio
async def test_hotel_candidates_are_mock_and_within_budget_allocation() -> None:
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

    result = await HotelAgent().execute(state)

    assert result["hotel_mode"] == "mock"
    assert len(result["hotels"]) == 3
    assert all(hotel.is_mock for hotel in result["hotels"])
    assert all("模拟" in hotel.name for hotel in result["hotels"])
    assert max(hotel.total_price_cny for hotel in result["hotels"]) <= 3500 * 0.32 * 1.05
