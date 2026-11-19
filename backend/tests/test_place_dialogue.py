from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agents.intake import classify_conversation_mode, collect_trip_intake
from app.agents.rail_search import rail_reply
from app.schemas.domain import ChatMessage


def turn(role, content):
    return ChatMessage(role=role, content=content, created_at=datetime.now(timezone(timedelta(hours=8))))


@pytest.mark.parametrize("place,correct,offered", [
    ("通州区", "江苏南通通州区", "北京通州区"),
    ("白云区", "贵阳白云区", "广州白云区"),
    ("朝阳区", "长春朝阳区", "北京朝阳区"),
    ("哈耳滨", "哈尔滨", "哈尔滨"),
    ("杭洲", "杭州", "杭州"),
    ("嵊四县", "嵊泗县", "嵊泗县"),
])
def test_place_confirmation_before_releasing_plan(place, correct, offered):
    messages = [turn("user", f"从上海去{place}玩，明天出发，三天，两人，预算三千，希望美食")]
    draft = collect_trip_intake(messages)
    assert not draft.ready and draft.missing == ["destination"] and offered in draft.reply
    messages.extend([turn("assistant", draft.reply), turn("user", "是的")])
    assert not collect_trip_intake(messages).ready
    messages.extend([turn("assistant", draft.reply), turn("user", correct + "吧")])
    assert classify_conversation_mode(messages) == "planning"
    final = collect_trip_intake(messages)
    assert final.ready and final.trip_request.destination == correct


@pytest.mark.parametrize("place", ["嵊泗县", "黟县", "成都郫都区", "𠮷字村"])
def test_input_preserves_rare_and_supplementary_han_characters(place):
    # The last example is synthetic and tests Unicode handling.
    messages = [turn("user", f"从上海去{place}玩，明天出发，三天，两人，预算三千，希望美食")]
    assert collect_trip_intake(messages).collected["destination"] == place


@pytest.mark.asyncio
async def test_rail_uses_corrected_spelling_only_after_confirmation():
    trains = AsyncMock(return_value=[])
    gateway = SimpleNamespace(trains=trains)
    messages = [turn("user", "查明天上海到杭洲的高铁")]
    reply = await rail_reply(gateway, messages)
    assert "杭州" in reply and "杭洲" in reply
    trains.assert_not_called()
    messages.extend([turn("assistant", reply), turn("user", "目的地改成杭州")])
    await rail_reply(gateway, messages)
    departure = messages[0].created_at.date() + timedelta(days=1)
    trains.assert_awaited_once_with("上海", "杭州", departure.isoformat())


def test_origin_disambiguation_keeps_destination():
    messages = [turn("user", "从白云区去上海玩，明天出发，三天，两人，预算三千，希望美食")]
    prompt = collect_trip_intake(messages)
    assert prompt.missing == ["origin"]
    messages.extend([turn("assistant", prompt.reply), turn("user", "贵阳白云区")])
    assert classify_conversation_mode(messages) == "planning"
    final = collect_trip_intake(messages)
    assert final.ready and (final.trip_request.origin, final.trip_request.destination) == ("贵阳白云区", "上海")
