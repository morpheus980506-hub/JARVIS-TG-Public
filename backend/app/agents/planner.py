import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.agents.base import BaseAgent
from app.schemas.domain import Requirement, TripRequest
from app.agents.destination import HAN, invalid_route_place, needs_city, normalize_place, place_question


class MissingRequirementError(ValueError):
    def __init__(self, fields: list[str]) -> None:
        self.fields = fields
        super().__init__("缺少关键信息：" + "、".join(fields))


def parse_people(value: str) -> int:
    if value.isdigit():
        return int(value)
    digits = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if value in digits:
        return digits[value]
    if value.startswith("十"):
        return 10 + digits.get(value[1:], 0)
    if "十" in value:
        left, right = value.split("十", 1)
        return digits.get(left, 1) * 10 + digits.get(right, 0)
    raise ValueError(f"无法识别人数：{value}")


class PlannerAgent(BaseAgent):
    agent_id = "planner"
    name = "Planner Agent"
    description = "Extracts requirements and constructs the task DAG"
    capabilities = {"requirement_extraction", "task_planning"}

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        request: TripRequest = state["request"]
        text = request.text

        route = re.search(
            rf"从(?P<origin>[{HAN}]{{2,24}}?)出发[，, ]*(?:去|到)"
            rf"(?P<destination>[{HAN}]{{2,24}}?)(?:玩|旅行|旅游|[，, ]|\d)",
            text,
        ) or re.search(
            rf"从(?P<origin>[{HAN}]{{2,24}}?)[，, ]*(?:去|到)"
            rf"(?P<destination>[{HAN}]{{2,24}}?)(?:玩|旅行|旅游|[，, ]|\d)",
            text,
        )
        origin = request.origin or (route.group("origin") if route else None)
        destination = request.destination or (route.group("destination") if route else None)
        origin=normalize_place(origin) if origin else None
        destination=normalize_place(destination) if destination else None
        day_match = re.search(r"(\d+)\s*天", text)
        people_match = re.search(r"([一二两三四五六七八九十\d]+)\s*(?:个?人|位)", text)
        budget_match = re.search(r"预算\s*(\d+(?:\.\d+)?)\s*(?:元|块)?", text)
        date_match = re.search(
            r"(?:(\d{4})[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|号)?",
            text,
        )
        start_date = request.start_date
        if not start_date and date_match:
            year = int(date_match.group(1) or datetime.now(timezone(timedelta(hours=8))).year)
            start_date = date(year, int(date_match.group(2)), int(date_match.group(3)))
        days = request.days or (int(day_match.group(1)) if day_match else None)
        travelers = request.travelers
        if people_match and 'travelers' not in request.model_fields_set:
            travelers = parse_people(people_match.group(1))
        budget = request.budget_cny or (float(budget_match.group(1)) if budget_match else None)
        missing = [
            label
            for label, value in [
                ("出发地", origin),
                ("目的地", destination),
                ("出发日期", start_date),
                ("旅行天数", days),
                ("总预算", budget),
            ]
            if value is None
        ]
        if missing:
            raise MissingRequirementError(missing)
        for field, place in (("origin", origin), ("destination", destination)):
            if invalid_route_place(place):
                raise MissingRequirementError(["出发地" if field == "origin" else "目的地"])
            if question := place_question(place, field):
                raise ValueError(question)
        if needs_city(destination):
            raise ValueError('目的地范围较大，请先确定一个具体城市或落脚点，再生成行程。')
        if start_date < datetime.now(timezone(timedelta(hours=8))).date():
            raise ValueError("出发日期不能早于今天")
        requirement = Requirement(
            origin=origin,
            destination=destination,
            start_date=start_date,
            days=days,
            travelers=travelers,
            budget_cny=budget,
            preferences=request.preferences,
            hard_constraints=request.hard_constraints,
        )
        try:start_date+timedelta(days=requirement.days-1)
        except OverflowError:raise ValueError('旅行日期超出支持范围，请修改出发日期。') from None
        return {
            "requirement": requirement,
            "task_dag": {
                "weather": [],
                "research": [],
                "budget": ["weather", "research"],
                "itinerary": ["weather", "research", "budget"],
                "verifier": ["itinerary", "budget"],
            },
        }

