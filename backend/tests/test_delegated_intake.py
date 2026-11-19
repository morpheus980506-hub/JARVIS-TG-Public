from app.agents.intake import classify_conversation_mode, collect_trip_intake
from app.schemas.domain import ChatMessage


def test_delegated_trip_decisions_progress_without_inventing_party_size_or_budget():
    messages = []
    steps = [
        ("想出去玩给我排一下", "origin", "从哪里"),
        ("你定吧", "origin", "从哪里"),
        ("杭州", "destination", "哪个城市"),
        ("都行", "destination", "绍兴"),
        ("听你的", "start_date", "有空吗"),
        ("好", "days", "几天"),
        ("随你", "days", "两天"),
        ("就这样", "travelers", "几位"),
        ("你看着办", "travelers", "有人同行"),
        ("就我一个", "budget_cny", "总预算"),
        ("你定", "budget_cny", "上限"),
        ("两千块钱", "preferences", "偏好"),
        ("都行", None, "生成行程"),
    ]
    for text, field, reply_part in steps:
        messages.append(ChatMessage(role="user", content=text))
        assert classify_conversation_mode(messages) == "planning"
        result = collect_trip_intake(messages)
        assert (result.missing[0] if result.missing else None) == field
        assert reply_part in result.reply
        if field in {"origin", "destination", "start_date", "days", "travelers", "budget_cny"}:
            assert result.collected[field] is None
        messages.append(ChatMessage(role="assistant", content=result.reply))
    request = result.trip_request
    assert request and result.ready
    assert (request.origin, request.destination, request.days) == ("杭州", "绍兴", 2)
    assert (request.travelers, request.budget_cny, request.preferences) == (1, 2000, [])
