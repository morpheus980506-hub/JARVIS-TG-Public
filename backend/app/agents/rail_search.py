"""Route natural-language train lookups to the same read-only rail provider."""
import asyncio
import re
from datetime import datetime, timedelta, timezone

from app.agents.dining import markdown
from app.agents.destination import place_question
from app.agents.flight_intent import confirmed_date
from app.agents.intake import _city_answer, _route_updates
from app.agents.intake_policy import RAIL_CANCEL, RAIL_DATE_UNSET, RAIL_SWAP, active_epoch, rail_followup, rail_request
from app.tools.providers.variflight import VariFlightQuotaError

CHINA_TIME = timezone(timedelta(hours=8))
OFFICIAL_RAIL_URL = "https://kyfw.12306.cn/otn/leftTicket/init"
RELATIVE = r"大后天|后天|明天|今天|今日|明日|\bthe day after tomorrow\b|\btomorrow\b|\btoday\b"
CALENDAR = r"(?:\d{4}[年./-])?\d{1,2}[月./-]\d{1,2}[日号]?"


def _route(text):
    cleaned = re.sub(rf"{RELATIVE}|{CALENDAR}", " ", text, flags=re.I)
    english = re.search(
        r"\bfrom\s+([A-Za-z][A-Za-z .-]*?)\s+to\s+([A-Za-z][A-Za-z .-]*?)(?=\s+(?:on|by|with|train|please)\b|[,?!.]|$)",
        cleaned, re.I,
    )
    if english:
        origin, destination = (_city_answer(part.strip()) for part in english.groups())
        return {"origin": origin, "destination": destination} if origin and destination else {}
    cleaned = re.sub(r"高铁|动车|火车票?|铁路|车次|列车|12306|有哪些|有哪几趟|还有|的票|余票|票价", " ", cleaned)
    cleaned = re.sub(r"^(?:帮我|请|给我|查一下|查询|查|搜一下|搜|找|看看|想问|明天|从\s)+", "", cleaned.strip())
    cleaned = re.sub(r"的(?=\s|$)", "", cleaned).strip()
    return _route_updates(cleaned)


async def rail_reply(gateway, messages, language="zh", progress=None):
    current = active_epoch(messages)
    latest = current[-1].content
    previous = current[-2].content if len(current) > 1 and current[-2].role == "assistant" else ""
    if not rail_request(latest) and not rail_followup(previous, latest):
        return None
    en = language == "en"
    heading = "**Rail search**" if en else "**铁路查询**"
    link = f"[Railway 12306]({OFFICIAL_RAIL_URL})" if en else f"[铁路 12306 查余票与购票]({OFFICIAL_RAIL_URL})"
    today = datetime.now(CHINA_TIME).date()
    phrase = latest.strip().rstrip('？?。！!').strip()
    if re.fullmatch(RAIL_CANCEL, phrase, re.I):
        return "Rail search cancelled." if en else "已取消这次车次查询。"
    if re.search(r'往返|来回|round.trip', latest, re.I):
        question = ("Please send each leg with its departure date. Which leg should I check first?"
                    if en else "往返需要分别查两段车次。你想先查哪一段？请告诉我出发地、到达地和日期。")
        return f"{heading}\n\n{question}"

    # Only inherit a route inside the consecutive rail exchange.
    start = len(current) - 1
    while start >= 2 and rail_followup(current[start - 1].content, current[start].content):
        start -= 2
    route = {}
    departure = None
    high_speed = False
    for message in current[start:]:
        if message.role != "user":
            continue
        phrase = message.content.strip().rstrip('？?。！!').strip()
        if re.search(r'往返|来回|round.trip', phrase, re.I):
            route = {}
            departure = None
            continue
        if re.search(r'不是|不要从|别从|不去|或者|还是.*还是|\beither\b', message.content, re.I):
            route = {}
            continue
        if re.fullmatch(RAIL_SWAP, phrase, re.I):
            route = {"origin": route.get("destination"), "destination": route.get("origin")}
        else:
            route.update(_route(re.sub(r'^到达地', '目的地', message.content)))
        anchor = message.created_at.astimezone(CHINA_TIME).date() if message.created_at else today
        relative_en = re.search(r"\b(the day after tomorrow|tomorrow|today)\b", message.content, re.I)
        if re.fullmatch(RAIL_DATE_UNSET, phrase, re.I):
            departure = None
        elif relative_en:
            days = {"today": 0, "tomorrow": 1, "the day after tomorrow": 2}[relative_en[1].lower()]
            departure = anchor + timedelta(days=days)
        elif re.search(rf"{RELATIVE}|{CALENDAR}", message.content, re.I):
            departure = confirmed_date([message], anchor)
        if rail_request(message.content):
            high_speed = bool(re.search(r"高铁|high.speed", message.content, re.I))
    origin, destination = route.get("origin"), route.get("destination")
    if not origin or not destination or origin == destination:
        question = "Which departure and arrival cities should I check?" if en else "你想查哪个城市到哪个城市的直达车次？"
        return f"{heading}\n\n{question}"
    for field, place in (("origin", origin), ("destination", destination)):
        if question := place_question(place, field, language):
            label = ("出发地改成" if field == "origin" else "目的地改成")
            if not en:
                question += f' 可以说「{label}」再加完整地名。'
            return f"{heading}\n\n{question}"
    if not departure or departure < today:
        question = "What future or current date are you departing?" if en else "你想查哪一天出发的直达车次？"
        return f"{heading}\n\n{question}"

    async def emit(status, message):
        if progress:
            await progress({"stage": "rail_search", "status": status, "message": message})

    await emit("RUNNING", f"正在查 {departure} {origin} → {destination} 的直达车次。")
    try:
        options = await asyncio.wait_for(gateway.trains(origin, destination, departure.isoformat()), timeout=24)
    except VariFlightQuotaError:
        note = "VariFlight search credits are insufficient." if en else "飞常准查询积分不足。"
    except Exception:
        note = "The timetable service did not return results." if en else "本次未取得车次，请稍后重试。"
        if not getattr(gateway, "variflight", None):
            note = "Configure VariFlight in Settings to view timetables here." if en else "可在「设置与服务 → API 接口」配置飞常准后查询车次。"
    else:
        if high_speed:
            options = [item for item in options if item.service_number.startswith(("G", "C"))]
        await emit("SUCCESS", f"车次查询完成，返回 {len(options)} 条记录。")
        if not options:
            note = "VariFlight returned no matching direct trains." if en else "飞常准本次未返回符合条件的直达车次。"
        else:
            lines = [
                f"{departure} · {markdown(origin)} → {markdown(destination)}",
                (f"{len(options)} matching services. First {min(15, len(options))} by departure time."
                 if en else f"共 {len(options)} 条，按出发时间展示前 {min(15, len(options))} 条。"),
                "",
                "| Train | Departure station | Departs | Arrival station | Arrives |" if en else "| 车次 | 出发站 | 出发 | 到达站 | 到达 |",
                "| --- | --- | --- | --- | --- |",
            ]
            for item in options[:15]:
                values = (item.service_number, item.departure_name, item.departure_time, item.arrival_name, item.arrival_time)
                lines.append("| " + " | ".join(markdown(value).replace("|", "\\|") for value in values) + " |")
            source = "Timetable source: VariFlight." if en else "车次来源为飞常准。"
            return f"{heading}\n\n" + "\n".join(lines) + f"\n\n{source} {link}"
        return f"{heading}\n\n{note}\n\n{link}"

    await emit("WARNING", note)
    return f"{heading}\n\n{note}\n\n{link}"
