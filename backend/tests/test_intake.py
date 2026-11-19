from app.agents.intake import (
    classify_conversation_mode,
    collect_trip_intake,
    format_trip_memory,
    is_travel_advice_request,
    is_flight_query,
)
from app.schemas.domain import ChatMessage
from datetime import datetime, timedelta, timezone
import pytest


@pytest.mark.parametrize("change,expected_origin,expected_destination", [
    ("我改主意了，温州飞深圳", "温州", "深圳"),
    ("改成从温州到深圳的航班", "温州", "深圳"),
    ("我想去深圳", "北京大兴", "深圳"),
    ("目的地改为深圳", "北京大兴", "深圳"),
    ("那上海飞深圳呢？", "上海", "深圳"),
    ("那么上海飞深圳呢?", "上海", "深圳"),
    ("如果上海飞深圳怎么样？", "上海", "深圳"),
    ("上海飞深圳？", "上海", "深圳"),
])
def test_flight_route_edit_overwrites_old_route_and_survives_retry(change, expected_origin, expected_destination):
    messages = [
        ChatMessage(role="user", content="帮我查一下从北京大兴到上海虹桥的航班"),
        ChatMessage(role="assistant", content="计划哪天出发？"),
        ChatMessage(role="user", content="今天"),
        ChatMessage(role="assistant", content="北京大兴到上海虹桥查询完成。"),
        ChatMessage(role="user", content=change),
        ChatMessage(role="assistant", content="正在查询北京大兴到上海虹桥。"),
        ChatMessage(role="user", content="重新查询"),
    ]
    facts, _ = format_trip_memory(messages)
    assert facts["origin"] == expected_origin
    assert facts["destination"] == expected_destination
    assert facts["start_date"] == datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def test_flight_query_relative_date_keeps_airports_and_avoids_full_planning():
    messages = [
        ChatMessage(role="user", content="你好，帮我查一下从北京大兴到上海虹桥的航班"),
        ChatMessage(role="assistant", content="计划哪天出发？"),
        ChatMessage(role="user", content="今天"),
    ]
    facts, _ = format_trip_memory(messages)
    assert is_flight_query(messages)
    assert classify_conversation_mode(messages) == "advisor"
    assert facts["origin"] == "北京大兴"
    assert facts["destination"] == "上海虹桥"
    assert facts["start_date"] == datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def test_three_consecutive_flight_routes_use_latest_question():
    messages = [
        ChatMessage(role="user", content="查从北京大兴到上海虹桥的航班"),
        ChatMessage(role="assistant", content="哪天？"),
        ChatMessage(role="user", content="今天"),
        ChatMessage(role="user", content="我改主意了，温州飞深圳"),
        ChatMessage(role="assistant", content="温州到深圳有6条航班。"),
        ChatMessage(role="user", content="那上海飞深圳呢？"),
    ]
    facts, _ = format_trip_memory(messages)
    assert (facts["origin"], facts["destination"]) == ("上海", "深圳")


def test_intake_asks_for_missing_fields_one_at_a_time() -> None:
    result = collect_trip_intake(
        [
            ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
            ChatMessage(role="user", content="我想去成都"),
        ]
    )

    assert result.ready is False
    assert result.collected["destination"] == "成都"
    assert "从哪里出发" in result.reply


def test_intake_builds_confirmable_request_from_complete_message() -> None:
    result = collect_trip_intake(
        [
            ChatMessage(role="assistant", content="告诉我你的旅行需求。"),
            ChatMessage(
                role="user",
                content="11月20日从兰州出发，去成都玩4天，两个人，预算3500元。希望酒店交通方便。",
            ),
        ]
    )

    assert result.ready is True
    assert result.trip_request is not None
    assert result.trip_request.origin == "兰州"
    assert result.trip_request.destination == "成都"
    assert result.trip_request.travelers == 2
    assert result.trip_request.preferences


def test_intake_accepts_dot_date_in_multi_turn_conversation() -> None:
    result = collect_trip_intake(
        [
            ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
            ChatMessage(role="user", content="我想去北京玩"),
            ChatMessage(role="assistant", content="好的。这次旅行从哪里出发？"),
            ChatMessage(role="user", content="玉环市"),
            ChatMessage(role="assistant", content="计划哪天出发？请告诉我具体日期，例如 11月20日。"),
            ChatMessage(role="user", content="11.30"),
        ]
    )

    assert result.collected["origin"] == "玉环市"
    assert result.collected["destination"] == "北京"
    assert result.collected["start_date"] == "2026-11-30"
    assert "旅行几天" in result.reply


def test_intake_answers_time_question_without_starting_trip_questions() -> None:
    result = collect_trip_intake(
        [
            ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
            ChatMessage(role="user", content="晚上好，现在几点了？"),
        ]
    )

    assert result.ready is False
    assert "北京时间" in result.reply
    assert "从哪里出发" not in result.reply
    assert result.missing == []


def test_intake_recommends_destinations_instead_of_treating_request_as_city() -> None:
    result = collect_trip_intake(
        [
            ChatMessage(role="assistant", content="你想去哪个城市或目的地？"),
            ChatMessage(role="user", content="你来推荐"),
        ]
    )

    assert result.ready is False
    assert result.collected["destination"] is None
    assert result.missing == ["destination"]
    assert "杭州" in result.reply
    assert "你想去哪个城市" in result.reply


def test_open_ended_inspiration_question_uses_travel_advisor() -> None:
    messages = [
        ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
        ChatMessage(role="user", content="最近有哪些值得玩的？"),
    ]

    assert is_travel_advice_request(messages) is True


def test_concrete_trip_request_still_uses_structured_intake() -> None:
    messages = [
        ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
        ChatMessage(role="user", content="我想去北京玩4天"),
    ]

    assert is_travel_advice_request(messages) is False


def test_team_building_follow_up_stays_in_advisor_mode() -> None:
    messages = [
        ChatMessage(role="user", content="最近有哪些值得玩的？"),
        ChatMessage(
            role="assistant",
            content="可以从不同风格选择。你更偏向逛吃、人文、山水还是放松度假？",
        ),
        ChatMessage(role="user", content="找找哪里适合团建"),
    ]

    assert is_travel_advice_request(messages) is True


def test_weather_question_defaults_to_advisor_not_trip_planning() -> None:
    messages = [
        ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
        ChatMessage(role="user", content="晚上好，今天天气怎么样？"),
    ]

    assert classify_conversation_mode(messages) == "advisor"


def test_plain_greeting_is_smalltalk_not_trip_planning() -> None:
    messages = [
        ChatMessage(role="assistant", content="告诉我你大概想去哪里。"),
        ChatMessage(role="user", content="晚上好"),
    ]

    assert classify_conversation_mode(messages) == "smalltalk"


def test_are_you_there_is_smalltalk_without_search() -> None:
    messages = [
        ChatMessage(role="assistant", content="你好，我是 JARVIS。"),
        ChatMessage(role="user", content="在不？"),
    ]

    assert classify_conversation_mode(messages) == "smalltalk"
    result = collect_trip_intake(messages)
    assert "在的" in result.reply
    assert "从哪里出发" not in result.reply


def test_general_non_travel_message_uses_chat_without_travel_search() -> None:
    messages = [
        ChatMessage(role="assistant", content="你好，我是 JARVIS。"),
        ChatMessage(role="user", content="你能做什么？"),
    ]

    assert classify_conversation_mode(messages) == "chat"


def test_connection_check_is_instant_smalltalk() -> None:
    messages = [
        ChatMessage(role="assistant", content="你好，我是 JARVIS。"),
        ChatMessage(role="user", content="晚上好，收到吗？"),
    ]

    assert classify_conversation_mode(messages) == "smalltalk"
    assert "连接正常" in collect_trip_intake(messages).reply


def test_budget_short_answer_supports_ten_thousand_yuan() -> None:
    messages = [
        ChatMessage(role="user", content="11月20日从兰州出发，去成都玩4天，两个人"),
        ChatMessage(role="assistant", content="这次旅行的总预算大约是多少元？"),
        ChatMessage(role="user", content="20万"),
    ]

    result = collect_trip_intake(messages)
    assert result.collected["budget_cny"] == 200000
    assert "总预算" not in result.reply


def test_budget_short_answer_supports_natural_chinese_limit() -> None:
    messages = [
        ChatMessage(role="user", content="11月30日从玉环出发，去哈尔滨玩5天"),
        ChatMessage(role="assistant", content="一共有几位旅行者？"),
        ChatMessage(role="user", content="1位"),
        ChatMessage(role="assistant", content="这次旅行的总预算大约是多少元？"),
        ChatMessage(role="user", content="控制在两万以内"),
    ]

    result = collect_trip_intake(messages)
    assert result.collected["budget_cny"] == 20000
    assert "总预算" not in result.reply


def test_complete_request_supports_chinese_budget_amount() -> None:
    messages = [
        ChatMessage(
            role="user",
            content="11月30日从玉环出发，去哈尔滨玩5天，1位，预算控制在两万五以内",
        )
    ]

    result = collect_trip_intake(messages)
    assert result.collected["budget_cny"] == 25000


def test_trip_memory_survives_duplicate_question_and_user_challenge() -> None:
    messages = [
        ChatMessage(role="user", content="暖和一点的，我想去深圳"),
        ChatMessage(role="assistant", content="好的。这次旅行从哪里出发？"),
        ChatMessage(role="user", content="玉环市"),
        ChatMessage(role="assistant", content="计划哪天出发？请告诉我具体日期，例如11月20日。"),
        ChatMessage(role="user", content="12.01"),
        ChatMessage(role="assistant", content="准备旅行几天？"),
        ChatMessage(role="user", content="3天"),
        ChatMessage(role="assistant", content="一共有几位旅行者？"),
        ChatMessage(role="user", content="1位"),
        ChatMessage(role="assistant", content="这次旅行的总预算大约是多少元？"),
        ChatMessage(role="user", content="控制在两万以内"),
        ChatMessage(role="assistant", content="这次旅行的总预算大约是多少元？"),
        ChatMessage(role="user", content="你认真的？"),
        ChatMessage(role="assistant", content="抱歉，是我问重复了。接下来想确认旅行风格。"),
        ChatMessage(role="user", content="当地有什么特色？"),
    ]

    collected, memory = format_trip_memory(messages)
    assert collected["origin"] == "玉环市"
    assert collected["destination"] == "深圳"
    assert collected["days"] == 3
    assert collected["travelers"] == 1
    assert collected["start_date"].endswith("-12-01")
    assert collected["budget_cny"] == 20000
    assert "默认指目的地深圳" in memory
    assert classify_conversation_mode(messages) == "advisor"


def test_bare_numeric_answers_follow_active_slots() -> None:
    messages = [
        ChatMessage(role="user", content="从兰州去成都，11月20日"),
        ChatMessage(role="assistant", content="准备旅行几天？"),
        ChatMessage(role="user", content="4"),
        ChatMessage(role="assistant", content="一共有几位旅行者？"),
        ChatMessage(role="user", content="2"),
    ]

    result = collect_trip_intake(messages)
    assert result.collected["days"] == 4
    assert result.collected["travelers"] == 2
