"""Travel web queries and evidence checks shared by chat lookups."""
import re
from dataclasses import dataclass


TOPICS = {
    "history": (r"抗日|抗战|抗联|红色(?:旅游|景点|遗址|一些)?|历史(?:建筑|遗迹|遗址)|wartime|historical sites?", r"抗日|抗战|抗联|红色(?:旅游|景点|遗址)|历史(?:建筑|遗迹|遗址)|革命(?:旧址|纪念)|war memorial|historical sites?"),
    "stay": (r"酒店|宾馆|住宿|民宿|hotel|lodging|resort", r"酒店|宾馆|住宿|民宿|度假村|hotel|lodging|resort"),
    "food": (r"餐厅|餐馆|饭店|美食|当地菜|小吃|餐饮|铁锅炖|restaurant|dining|food", r"餐厅|餐馆|饭店|美食|菜馆|小吃|餐饮|铁锅炖|restaurant|dining|food"),
    "coast": (r"海滩|沙滩|海边|海滨|潜水|海湾|beach|diving|snorkel", r"海滩|沙滩|海边|海滨|潜水|海湾|海岛|beach|diving|snorkel"),
    "sights": (r"博物馆|纪念馆|公园|景区|景点|遗址|museum|attraction|park", r"博物馆|纪念馆|公园|景区|景点|遗址|museum|attraction|park"),
    "weather": (r"天气|气温|降水|穿(?:什么|衣服)|weather|temperature", r"天气|气温|气候|降水|weather|temperature|forecast|climate"),
    "transport": (r"交通|高铁|接驳|自驾|机场|航班|铁路|transport|train|flight|airport", r"交通|高铁|接驳|自驾|机场|航班|铁路|transport|train|flight|airport"),
    "travel": (r"旅行|旅游|度假|行程|攻略|去.{2,12}玩|itinerary|vacation|travel", r"旅游|旅行|度假|攻略|游览|景点|itinerary|vacation|travel"),
}
REFINEMENT = re.compile(r"详细|细化|(?:更|再)具体|展开|排一下|你来推荐|你来安排|再推荐|还有哪些|哪些更|哪里更|details|more options", re.I)
CONVERSATION_ONLY = re.compile(
    r"^(?:为什么|怎么|咋).{0,8}(?:还(?:是|没)|又|一直).{0,10}(?:结果|这样|查|等)|"
    r"^(?:结果|进度)呢|^(?:查到|查好)(?:了|没|没有|了吗)|^(?:我|我们)(?:一个人|两个人)(?:去)?[。！!？?\s]*$",
)
TRAVEL_NOISE = re.compile(r"人口流失|人口外流|人口减少|经济衰退|振兴发展|全面振兴|人口迁移|房地产|招商引资|人口普查", re.I)
EXPLICIT_AREA = re.compile(
    r"(?:查找|搜索|查|搜|去|在)(?:一下)?\s*([\u3400-\u9fff]{2,10}?)的(?:酒店|住宿|餐厅|旅游攻略|景点|天气|气温)"
)


@dataclass(frozen=True)
class TravelWebQuery:
    text: str
    location: str
    topics: tuple[str, ...]


def travel_web_query(messages, location=""):
    users = [m.content.strip() for m in messages if m.role == "user" and not m.undo_ignored]
    if not users or CONVERSATION_ONLY.search(users[-1]):
        return None

    def topics_for(text):
        topics = tuple(name for name, (pattern, _) in TOPICS.items() if re.search(pattern, text, re.I))
        return tuple(name for name in topics if name != "travel") or topics

    latest = users[-1]
    topics = topics_for(latest)
    if REFINEMENT.search(latest) and (not topics or topics == ("travel",)):
        for text in reversed(users[:-1]):
            prior_topics = topics_for(text)
            if prior_topics:
                latest, topics = text, prior_topics
                break
    if not topics:
        return None
    if area := EXPLICIT_AREA.search(latest):
        candidate = area[1]
        if candidate not in {"当地", "那边", "这里", "那儿", "附近"}:
            location = candidate
    query = " ".join(latest.split())
    if location and location.casefold() not in query.casefold():
        query = f"{location} {query}"
    return TravelWebQuery(query[:400], location, topics)


def relevant_web_facts(facts, query):
    location = re.sub(r"(?:市|县|省)$", "", query.location).strip().casefold()
    seen = set()
    kept = []
    for fact in facts:
        body = f"{fact.name} {fact.value}"
        if fact.is_mock or not fact.name or fact.source_url in seen:
            continue
        if location and location not in body.casefold():
            continue
        if location == "东北" and "日本东北" in body and "日本" not in query.text:
            continue
        if TRAVEL_NOISE.search(fact.name) and not TRAVEL_NOISE.search(query.text):
            continue
        if not any(re.search(TOPICS[key][1], body, re.I) for key in query.topics):
            continue
        seen.add(fact.source_url)
        kept.append(fact)
    return kept
