"""Semantic flight conversation state, validated before any external query."""

import asyncio
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from app.schemas.domain import ChatMessage


def confirmed_date(messages: list[ChatMessage], today: date) -> date | None:
    value = None
    for message in messages:
        if message.role != "user":
            continue
        if re.search(r"日期.*(?:没定|未定|不确定)|哪天.*(?:没定|未定|不确定)", message.content):
            value = None
            continue
        relative = re.search(r"大后天|后天|明天|今天|今日|明日", message.content)
        explicit = re.search(r"(?:(\d{4})[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|号)?", message.content)
        if relative:
            value = today + timedelta(days={"今天": 0, "今日": 0, "明天": 1, "明日": 1, "后天": 2, "大后天": 3}[relative.group()])
        elif explicit:
            try:
                value = date(int(explicit.group(1) or today.year), int(explicit.group(2)), int(explicit.group(3)))
            except ValueError:
                value = None
    return value


class FlightDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["lookup", "general", "clarify"]
    origin: str | None = Field(default=None, min_length=2, max_length=40)
    destination: str | None = Field(default=None, min_length=2, max_length=40)
    departure_date: date | None = None
    question: str | None = Field(default=None, max_length=180)
    _source: str = PrivateAttr(default="model")


def explicit_route_fallback(messages: list[ChatMessage], known_date: date | None) -> FlightDecision:
    from app.agents.intake import _route_updates

    latest = next((m.content for m in reversed(messages) if m.role == "user"), "")
    # Only an explicit complete new route can bypass the unavailable model.
    # Partial edits, negations, alternatives, and pronouns never reuse old state.
    if not re.search(r"不是|不去|不要|或者|还是|没想好|不确定|取消|不查", latest):
        updates = _route_updates(latest)
        if updates.get("origin") and updates.get("destination"):
            result = FlightDecision(action="lookup", **updates, departure_date=known_date)
            result._source = "explicit_route_fallback"
            return result
    result = FlightDecision(action="clarify", question="对话理解服务暂时不可用，本次没有执行查询。请稍后重试，或直接提供完整的新航线和日期。")
    result._source = "service_unavailable"
    return result


async def resolve_flight_intent(messages: list[ChatMessage], gateway, language: str = 'zh') -> FlightDecision:
    today = datetime.now(timezone(timedelta(hours=8))).date()
    known_date = confirmed_date(messages, today)
    latest = next((m.content for m in reversed(messages) if m.role == "user"), "")
    history = tuple(m.content for m in messages if m.role == "user")
    cache = getattr(gateway, "_flight_decision_cache", None)
    if cache is None:
        cache = {}
        gateway._flight_decision_cache = cache

    def remember(decision: FlightDecision) -> FlightDecision:
        if decision.action == "lookup":
            if len(cache) >= 128:
                cache.pop(next(iter(cache)))
            cache[(today, history)] = decision.model_copy(deep=True)
        return decision

    previous = cache.get((today, history[:-1]))
    simple_date = re.fullmatch(r"今天|今日|明天|明日|后天|大后天|(?:\d{4}[年./-])?\d{1,2}[月./-]\d{1,2}[日号]?", latest.strip())
    retry = re.fullmatch(r"(?:请)?(?:重新查(?:询|一下)?|再查(?:一下)?|重查)[。！!\s]*", latest.strip())
    if previous and (simple_date or retry):
        reused = previous.model_copy(deep=True)
        reused.departure_date = known_date if simple_date else previous.departure_date
        reused._source = "confirmed_state_fast_path"
        if reused.departure_date:
            return remember(reused)
    # A complete, explicit route with a confirmed date needs no model round trip.
    # Keep negations, alternatives and partial edits on the semantic path.
    direct = explicit_route_fallback(messages, known_date)
    if direct.action == "lookup" and direct.origin != direct.destination:
        clean = re.sub(r"^(?:那么|那|我改主意了[，,]?|改成|改为|帮我查一下|帮我查|查一下|查询|查|今天|明天|后天)+", "", latest.strip())
        clean = re.sub(r"[，,\s]+\d{4}-\d{2}-\d{2}$", "", clean)
        if re.fullmatch(r"(?:从)?[\u4e00-\u9fffA-Za-z]{2,12}(?:飞往|飞到|飞|到)[\u4e00-\u9fffA-Za-z]{2,12}(?:的航班|航班|的机票|机票)?(?:呢|吗)?[？?。\s]*", clean):
            direct = explicit_route_fallback([ChatMessage(role="user", content=clean)], known_date)
            direct._source = "explicit_route_fast_path"
            return remember(direct)
    prompt = (
        "你是航班对话状态解析器。只输出 JSON，不回答用户，不查询航班。"
        f"北京时间今天是 {today.isoformat()}。"
        f"用户最近明确指定的日期是 {known_date}，本轮未改日期时必须保留。"
        "根据完整对话判定最新一条用户消息的意图，并重建当前有效的航线和日期。"
        "格式：{\"action\":\"lookup|general|clarify\",\"origin\":null,"
        "\"destination\":null,\"departure_date\":null,\"question\":null}。"
        "地点必须来自用户陈述，助手消息只能用于理解补问对象，不能作为事实来源。"
        "逐轮应用修改，后说的覆盖先说的；只修改一个字段时保留其他字段。"
        "理解自然追问、省略、改口、否定、交换起终点、返程以及当天/次日等表达。"
        "‘那上海飞深圳呢’是新航线；‘不是上海，是杭州出发’只改起点；"
        "‘反过来呢’交换起终点；‘重新查’保留最新已确认状态。"
        "保留明确指定的机场，不要把上海虹桥扩大成整个上海；未指定机场的城市保持城市名。"
        "今天/明天按上述北京时间解析成 ISO 日期。不要把预算/人数/时间当日期。"
        "用户询问美食天气、问候、解释、取消查询或其他非查航班问题时 action=general，"
        "不能因为历史出现过航班就再次查询。"
        "最新消息存在多个路线选择、地点歧义或明确否定旧地点但没给新地点时 action=clarify，"
        "question 用一句话询问，绝不能静默使用被否定的旧地点。"
        "查航班意图明确时 action=lookup；缺哪个必要字段就置 null，不编造，question可补问。"
    )
    if language == 'en':
        prompt += ' Write any clarification question in English.'
    try:
        result = await asyncio.wait_for(gateway.generate_fast(
            [{"role": "system", "content": prompt},
             {"role": "user", "content": json.dumps(
                 [{"role": message.role, "content": message.content if message.role == "user" else message.content[:240]}
                  for message in messages], ensure_ascii=False
             )}],
            temperature=0, max_tokens=450,
        ), timeout=18)
        decision = FlightDecision.model_validate_json(result.content)
        if decision.action == "lookup" and decision.departure_date is None and known_date:
            decision.departure_date = known_date
        user_text = "\n".join(m.content for m in messages if m.role == "user").upper()
        # A model may interpret edits, but cannot invent an unmentioned location.
        for place in (decision.origin, decision.destination):
            if place and place.upper() not in user_text:
                raise ValueError("Ungrounded place")
        if decision.action == "lookup" and decision.origin == decision.destination and decision.origin:
            raise ValueError("Identical endpoints")
        if decision.action == "clarify" and not decision.question:
            decision.question = "你想查询哪条航线、哪天出发？"
        return remember(decision)
    except (ValueError, TypeError):
        return FlightDecision(action="clarify", question="这条消息的航线或日期我还没确认清楚。请再告诉我出发地、目的地和日期，我确认后再查询。")
    except Exception:
        return remember(explicit_route_fallback(messages, known_date))
