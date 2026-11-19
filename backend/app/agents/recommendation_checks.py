"""Minimum evidence for the travel constraints supported by the planner."""
import re
import unicodedata
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit

from app.agents.dining import safe_url


def amap_position(url: str) -> tuple[float, float] | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "uri.amap.com":
            return None
        lng, lat = map(float, parse_qs(parsed.query)["position"][0].split(","))
        if -180 <= lng <= 180 and -85 <= lat <= 85:
            return lng, lat
    except (ValueError, KeyError, IndexError):
        pass
    return None


def same_hotel_branch(candidate, fact) -> bool:
    def normalized(name):
        return re.sub(r'[\s()（）·\-]', '', unicodedata.normalize('NFKC', name)).casefold()

    return bool(not fact.is_mock and fact.address and (fact.place_type or '').startswith('10')
                and normalized(candidate) == normalized(fact.name) and amap_position(fact.source_url))


def indoor_only(text: str) -> bool:
    return bool(re.search(r'只(?:玩|去|安排|逛)?室内|全程室内|不(?:去|玩|安排)室外|indoor only|only indoor', text, re.I))


def indoor_venue(name: str) -> bool:
    return bool(re.search(r'博物馆|美术馆|科技馆|展览馆|纪念馆|museum|gallery', name, re.I)
                and not re.search(r'广场|停车场|公交站|地铁站|商店|文创店|工作室|办公室|室外|露天|外广场|入口|出口', name))


def hotel_constraints(text: str) -> list[str]:
    return [part.strip() for part in re.split(r'[,，。；;\n]', text)
            if re.search(r'酒店|住宿|每晚|电梯|双床|无障碍|停车|宠物|hotel|elevator|per night', part, re.I)]


def hotel_fit(item: dict, requirements: list[str]) -> list[str] | None:
    """Return missing evidence, or None when the offer must be excluded."""
    title = item.get('title') or ''
    if not title or not safe_url(item.get('url') or '') or re.search(
        r'通兑|房券|住宿券|兑换券|全国|\d+\+?\s*[家店]|钟点房|计时休息|小时房',
        title,
    ):
        return None
    text = ' '.join(requirements)
    evidence = ' '.join([title, *(str(tag) for tag in (item.get('tags') or []))])
    missing = []
    # Treat missing facility evidence as unknown instead of claiming a match.
    for requested, positive, negative in (
        (r'电梯|elevator', r'有电梯|配备电梯|提供电梯|elevator available', r'无电梯|没有电梯|不提供电梯|no elevator'),
        (r'无障碍|wheelchair', r'无障碍客房|无障碍房型|wheelchair.accessible room', r'无障碍.*(?:不提供|无房)|不提供无障碍'),
        (r'双床|twin room', r'双床房|twin room', r'无双床|不提供双床'),
        (r'停车|parking', r'免费停车|有停车场|提供停车|parking available', r'无停车|没有停车|不提供停车|no parking'),
        (r'宠物|pet.friendly', r'允许携带宠物|可携带宠物|宠物友好|pet.friendly', r'禁止.*宠物|不允许.*宠物|不可携带宠物|no pets'),
    ):
        if re.search(requested, text, re.I):
            if re.search(negative, evidence, re.I):
                return None
            if not re.search(positive, evidence, re.I):
                missing.append(requested.split('|')[0])
    caps = re.findall(r'(?:每晚|一晚|per night)\s*(?:酒店|房费|房价)?\s*(?:最多|不超过|不高于|上限|至多|≤|<=)?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以内|以下)?', text, re.I)
    if caps:
        # Bare numbers, advertised starting prices and package totals cannot prove a nightly cap.
        price = re.fullmatch(r'(?:每晚\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元)?|[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元)?\s*/\s*晚)',
                             (item.get('price_text') or '').strip())
        if not price:
            missing.append('适用日期的每晚价格')
        elif Decimal(price[1] or price[2]) > min(map(Decimal, caps)):
            return None
    return missing


def hotel_matches(item: dict, requirements: list[str]) -> bool:
    return hotel_fit(item, requirements) == []
