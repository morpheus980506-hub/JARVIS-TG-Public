from datetime import datetime, timedelta, timezone

import pytest

from app.agents.intake import classify_conversation_mode, collect_trip_intake, format_trip_memory
from app.schemas.domain import ChatMessage


@pytest.mark.parametrize("day, people, count", [("明儿", "就俺一个", 1), ("明夭", "咱俩", 2)])
def test_casual_answers_complete_a_trip_without_repeating_questions(day, people, count):
    now = datetime.now(timezone(timedelta(hours=8)))
    messages = []
    steps = [
        ("想出去玩给我排一下", "origin"),
        ("杭州这边", "destination"),
        ("上海吧", "start_date"),
        (day, "days"),
        ("仨天", "travelers"),
        (people, "budget_cny"),
        ("两千块钱", "preferences"),
        ("没啥要求啊", None),
    ]
    for text, expected_next in steps:
        messages.append(ChatMessage(role="user", content=text, created_at=now))
        assert classify_conversation_mode(messages) == "planning"
        result = collect_trip_intake(messages)
        assert (result.missing[0] if result.missing else None) == expected_next
        messages.append(ChatMessage(role="assistant", content=result.reply))
    request = result.trip_request
    assert result.ready and request
    assert (request.origin, request.destination) == ("杭州", "上海")
    assert request.start_date == now.date() + timedelta(days=1)
    assert (request.days, request.travelers, request.budget_cny) == (3, count, 2000)
    assert request.preferences == []


@pytest.mark.parametrize("answer", ["我家这边", "老家啊", "随便吧"])
def test_vague_departure_does_not_become_a_confirmed_city(answer):
    messages = [
        ChatMessage(role="user", content="想出去玩给我排一下"),
        ChatMessage(role="assistant", content="好的。这次旅行从哪里出发？"),
        ChatMessage(role="user", content=answer),
    ]
    result = collect_trip_intake(messages)
    assert result.missing[0] == "origin"
    assert result.collected["origin"] is None and result.collected["destination"] is None


def test_casual_budget_range_is_not_converted_to_a_single_amount():
    messages = [
        ChatMessage(role="user", content="从杭州到上海玩，明天出发，三天，两人"),
        ChatMessage(role="assistant", content="这次旅行的总预算大约是多少元？"),
        ChatMessage(role="user", content="两三千块钱吧"),
    ]
    result = collect_trip_intake(messages)
    assert result.missing[0] == "budget_cny" and result.collected["budget_cny"] is None


def test_advice_to_planning_keeps_colloquial_destination_and_duration_range():
    now = datetime.now(timezone(timedelta(hours=8)))
    messages = [
        ChatMessage(role="user", content="我打算在这个冬天上三亚旅游", created_at=now),
        ChatMessage(role="assistant", content="冬天去三亚避寒很合适。你更想偏休闲度假，还是多打卡景点？"),
    ]
    for answer, field in [
        ("休假", "days"),
        ("3～4天", "origin"),
        ("文州", "origin"),
        ("是的", "start_date"),
        ("明天", "days"),
        ("4", "travelers"),
    ]:
        messages.append(ChatMessage(role="user", content=answer, created_at=now))
        assert classify_conversation_mode(messages) == "planning"
        result = collect_trip_intake(messages)
        assert result.missing[0] == field
        assert result.collected["destination"] == "三亚"
        assert "休闲度假" in result.collected["preferences"]
        if answer in {"3～4天", "文州", "是的", "明天"}:
            assert result.collected["days_range"] == [3, 4]
            assert result.collected["days"] is None and not result.ready
        if answer == "文州":
            assert "温州吗" in result.reply
        if answer == "明天":
            assert "3～4 天" in result.reply
        messages.append(ChatMessage(role="assistant", content=result.reply))
    assert result.collected["origin"] == "温州"
    assert result.collected["days"] == 4 and "days_range" not in result.collected


def test_unconfirmed_typo_does_not_become_an_origin_when_user_adds_departure_date():
    now = datetime.now(timezone(timedelta(hours=8)))
    departure_year = now.year + 1
    messages = [
        ChatMessage(role="user", content="我打算在这个冬天上三亚旅游"),
        ChatMessage(role="assistant", content="你从哪里出发？"),
        ChatMessage(role="user", content="文州"),
        ChatMessage(role="assistant", content="你想去哪个城市或目的地？"),
        ChatMessage(role="user", content="不是，这么快就忘了？"),
    ]
    assert classify_conversation_mode(messages) == "planning"
    messages.extend([
        ChatMessage(role="assistant", content="已记下文州出发。你大概几号到三亚？"),
        ChatMessage(role="user", content=f"{departure_year % 100:02}年1于月10号出发", created_at=now),
    ])
    assert classify_conversation_mode(messages) == "planning"
    result = collect_trip_intake(messages)
    assert result.missing == ["origin"] and not result.ready
    assert result.collected["start_date"] == f"{departure_year}-01-10"
    assert result.collected["destination"] == "三亚" and result.collected["origin"] is None
    assert result.collected["pending_places"] == {"origin": "文州"}
    facts, memory = format_trip_memory(messages)
    assert facts["origin"] is None and "待确认的出发地原文：文州" in memory
    assert "温州吗" in result.reply
    messages.extend([ChatMessage(role="assistant", content=result.reply), ChatMessage(role="user", content="是的")])
    assert classify_conversation_mode(messages) == "planning"
    assert collect_trip_intake(messages).collected["origin"] == "温州"
