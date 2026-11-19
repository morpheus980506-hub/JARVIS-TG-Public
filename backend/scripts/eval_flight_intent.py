"""Manual real-model regression; run from backend with python -m scripts.eval_flight_intent."""
import asyncio
from datetime import datetime, timedelta, timezone

from app.agents.flight_intent import resolve_flight_intent
from app.core.config import get_settings
from app.models.gateway import ModelGateway
from app.schemas.domain import ChatMessage


async def main():
    gateway = ModelGateway(get_settings())
    today = datetime.now(timezone(timedelta(hours=8))).date()
    base = [ChatMessage(role="user", content="查一下从北京大兴到上海虹桥的航班"),
            ChatMessage(role="assistant", content="哪天出发？"),
            ChatMessage(role="user", content="今天"),
            ChatMessage(role="assistant", content="查询完成。"),
            ChatMessage(role="user", content="我改主意了，温州飞深圳"),
            ChatMessage(role="assistant", content="温州到深圳有6条航班。")]
    cases = [
        ("那上海飞深圳呢？", "lookup", "上海", "深圳", today),
        ("不是温州，杭州出发", "lookup", "杭州", "深圳", today),
        ("反过来呢", "lookup", "深圳", "温州", today),
        ("明天，同样的路线", "lookup", "温州", "深圳", today + timedelta(days=1)),
        ("换到后天", "lookup", "温州", "深圳", today + timedelta(days=2)),
        ("重新查一下", "lookup", "温州", "深圳", today),
        ("出发地上海或者杭州吧", "clarify", None, None, None),
        ("不是温州出发了，还没想好从哪走", "clarify", None, None, None),
        ("先不查了，深圳有什么特色美食？", "general", None, None, None),
        ("你刚才为什么查错了？", "general", None, None, None),
    ]
    semaphore = asyncio.Semaphore(1)
    async def check(case):
        text, action, origin, destination, departure_date = case
        async with semaphore:
            result = await resolve_flight_intent(base + [ChatMessage(role="user", content=text)], gateway)
        passed = result._source != "service_unavailable" and result.action == action and (action != "lookup" or (
            result.origin == origin and result.destination == destination and result.departure_date == departure_date
        ))
        print("PASS" if passed else "FAIL", text, result._source, result.model_dump(mode="json"), flush=True)
        return passed
    results = await asyncio.gather(*(check(case) for case in cases))
    print(f"Real-model regression: {sum(results)}/{len(results)}", flush=True)
    if not all(results):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
