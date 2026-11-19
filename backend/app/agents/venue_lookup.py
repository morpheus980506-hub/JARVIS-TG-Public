"""Resolve concrete hotel and restaurant follow-ups against the proposed stops."""
import asyncio
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx

from app.agents.actionable_advice import position, quality_places, specific_hotel
from app.agents.destination import HAN, needs_city
from app.agents.dining import FOOD, dining_constraints, markdown
from app.agents.intake_policy import active_epoch
from app.agents.recommendation_checks import hotel_constraints, hotel_matches
from app.agents.stay_dates import grounded_stay_dates
from app.tools.providers.travel_search import TravelSearchError
from app.tools.providers.web_search import WEB_SEARCH_TIMEOUT


STAY_PROMPT = ("要查这些酒店的实时价格和房态", "For live hotel rates and availability")
DAY_HEADING = r"(?mi)^#{1,4}\s*(?:Day\s*\d+|D\d+|第\s*\d+\s*天)\s*[：:｜|·]?\s*(.+)$"
LODGING = r"酒店|宾馆|民宿|住宿|\bhotels?\b"
SEARCH_ACTION = r"查|搜|找|search|look up|find"
STATION = r"火车站|高铁站|动车站|火车南站|火车北站"
LOOKUP_CONFIRMATION = re.compile(
    r"好(?:的|啊|呀)?|行|可以|同意|(?:(?:好(?:的)?|行|可以)[，,\s]+)?(?:那(?:就)?\s*)?(?:(?:请)?你(?:就|现在|来|帮我)?|帮我)?(?:直接)?"
    r"(?:查|搜)(?:一下|一查|一搜|一遍|一次|吧|呀|啊|呗)?|重试|再查一次|重新查|go ahead|yes|sure|okay|ok",
    re.I,
)
LOOKUP_STATUS_FOLLOWUP = re.compile(
    r"(?:结果|店名|地址)呢|查到(?:了)?(?:吗|没|没有)|你查了(?:吗|没|没有)|(?:还要|还得)等多久|"
    r"(?:为什么|怎么|咋)(?:又|还|还是|一直|还没|没有|没)(?:查|出结果|给结果|有结果|是这个结果|是这样|这样|没结果|没查|不给|只说).{0,14}|"
    r"(?:where are|what about) (?:the )?results|(?:any|still no) results(?: yet)?",
    re.I,
)
PENDING_LOOKUP_REPLY = re.compile(
    r"我.{0,12}(?:现在|马上).{0,12}(?:查|搜|发起)|查询后再|结果(?:出来|返回)后|(?:没|没有)(?:拿到|给出|可用的).{0,14}(?:查询|结果)|"
    r"I(?:’ll| will) (?:search|look up)",
    re.I,
)


def accepted_venue_offer(messages):
    def followup(message):
        if message.role != "user" or message.undo_ignored:
            return False
        text = message.content.strip("。！!，,？?. ")
        return LOOKUP_CONFIRMATION.fullmatch(text) or LOOKUP_STATUS_FOLLOWUP.fullmatch(text)

    if not messages or not followup(messages[-1]):
        return ""
    pending = ""
    for message in reversed(messages[:-1]):
        if message.role == "user":
            if followup(message):
                continue
            break
        body = re.split(r"(?mi)^\s*[*# ]*(?:网页来源|Web sources)", message.content, maxsplit=1)[0]
        for offer in reversed(re.findall(r"[^。！!？?\n]+[？?]", body)):
            if (re.search(r"需要我|要我|要不要|我(?:现在|可以|来)|would you like|shall i|want me|should i", offer, re.I)
                and re.search(SEARCH_ACTION, offer, re.I)
                and (re.search(LODGING, offer, re.I) or re.search(FOOD, offer, re.I))):
                return offer
        if (not PENDING_LOOKUP_REPLY.search(body) or "https://uri.amap.com/" in body
            or not (re.search(LODGING, body, re.I) or re.search(FOOD, body, re.I))):
            break
        pending = pending or body
    return pending


def wants_venue_lookup(messages):
    latest = messages[-1].content
    if re.search(r"API|MCP|接口|配置|不查|不用查|不要查|别查|取消|不要推荐", latest, re.I):
        return False
    if accepted_venue_offer(messages):
        return True
    if len(messages) > 1 and any(marker in messages[-2].content for marker in STAY_PROMPT):
        dates, _ = grounded_stay_dates(messages[-1:], {})
        if dates:
            return True
    return bool(
        re.search(LODGING, latest, re.I)
        and re.search(FOOD, latest, re.I)
        and re.search(r"具体|哪家|店名|推荐|查询|帮我查|帮我找|找几家|recommend|specific|find", latest, re.I)
    )


def venue_regions(messages, destination, focus=""):
    # Use headed stops from the latest itinerary, never the sources footer.
    itinerary = next((m.content for m in reversed(messages[:-1]) if m.role == "assistant" and re.search(DAY_HEADING, m.content)), "")
    def clean(value):
        value = re.sub(r"(?:市区|县城|周边|附近)$", "", value.strip(" *「」"))
        if re.fullmatch(rf"[{HAN}]{{2,8}}", value) and not needs_city(value) and not re.search(r"抵达|返程|住宿|入住|游玩|休息|安排|一日|待定|待确认", value):
            return value
        return None

    if station := station_focus(focus):
        return [station[0]], [station[0]]
    explicit = re.search(rf"(?:在|查|找|推荐)?([{HAN}]{{2,8}}?)的(?:酒店|宾馆|民宿|餐厅)", focus or messages[-1].content)
    if explicit:
        area = clean(re.sub(r"^(?:帮我|给我|推荐|搜索|查询|查找|查|找|在|具体)+", "", explicit[1]))
        if area and area not in {"当地", "那边", "附近", "合适", "靠谱", "具体"}:
            return [area], [area]
    dining = list(dict.fromkeys(
        area for heading in re.findall(DAY_HEADING, itinerary)
        for segment in re.split(r"→|[-–—]|｜|\|", heading)
        if (area := clean(segment))
    ))[:4]
    stays = list(dict.fromkeys(
        area for match in re.finditer(rf"(?:往|到|去|抵达)([{HAN}]{{2,8}}?(?:县|市))[,，][^\n。；;]{{0,12}}(?:宿|入住)", itinerary)
        if (area := clean(match[1]))
    ))
    fallback = [destination] if destination and not needs_city(destination) else []
    return stays[:3] or dining or fallback, dining or fallback or stays[:3]


def station_focus(text):
    station = re.search(rf'(?:^|[“「"\s，,按在到])([{HAN}]{{2,8}}?)({STATION})(?=附近|周边|旁|一带|酒店|住宿|[”」"\s，,。]|$)', text)
    if not station:
        return None
    city = re.sub(r"^(?:帮我|给我|就|去|查|找|搜|选)+", "", station[1])
    if len(city) < 2 or needs_city(city):
        return None
    return city, city + station[2]


def venue_focus(messages):
    previous = messages[-2].content if len(messages) > 1 and messages[-2].role == "assistant" else ""
    if any(marker in previous for marker in STAY_PROMPT):
        for index in range(len(messages) - 3, -1, -1):
            if messages[index].role != "user":
                continue
            earlier = messages[:index + 1]
            if wants_venue_lookup(earlier):
                return accepted_venue_offer(earlier) or earlier[-1].content
            break
    return accepted_venue_offer(messages) or messages[-1].content


async def venue_reply(engine, messages, facts, language, progress=None, *, use_search=True):
    messages = active_epoch(messages)
    english = language == "en"
    focus = venue_focus(messages)
    stay_regions, dining_regions = venue_regions(messages, facts.get("destination"), focus)
    if not re.search(LODGING, focus, re.I):
        stay_regions = []
    if not re.search(FOOD, focus, re.I):
        dining_regions = []
    if not (stay_regions or dining_regions):
        return "Which city or trip stop should I search?" if english else "你想查哪个城市或哪一站？"

    gateway = getattr(engine, "tool_gateway", None)
    amap = getattr(gateway, "amap", None)
    web = getattr(gateway, "web_search", None) if use_search else None
    travel = getattr(engine, "travel_gateway", None)
    banned, diet, _ = dining_constraints(messages)
    constraints = hotel_constraints("；".join(m.content for m in messages if m.role == "user"))
    offered_terms = re.findall(r'[“「"]([^”」"]+)[”」"]', focus)
    station = station_focus(focus)
    hotel_style = next(iter(re.findall(r"经济舒适型|经济型|舒适型|高档型|快捷酒店", focus)), "")
    today = datetime.now(timezone(timedelta(hours=8))).date()
    dates, nights = grounded_stay_dates(messages[-1:], {})
    if len(dates) != 2:
        history = [m for m in messages if m.role == "user" and re.search(r"入住|退房|住.{0,6}晚|check.in|check.out", m.content, re.I)]
        dates, nights = grounded_stay_dates(history, {})
    if len(dates) == 1 and len(set(nights)) == 1 and 0 < nights[0] <= 60:
        dates.add(min(dates) + timedelta(days=nights[0]))
    if not dates and stay_regions == [facts.get("destination")] and len(dining_regions) <= 1 and facts.get("start_date") and (facts.get("days") or 0) > 1:
        start = datetime.fromisoformat(facts["start_date"]).date()
        dates = {start, start + timedelta(days=facts["days"] - 1)}
    dated = len(stay_regions) == 1 and len(dates) == 2 and min(dates) >= today
    providers = [
        row["id"] for row in (travel.status() if travel else [])
        if row["id"] in {"fliggy", "meituan"} and row["configured"] and row["client_installed"]
    ]
    async def map_search(area, lodging):
        if not amap:
            return [], None, None
        keyword = "酒店" if lodging else diet or "餐厅"
        anchor = None
        vicinity = None
        stem = area.removesuffix("县").removesuffix("市")
        for term in offered_terms:
            if not term.startswith(stem) or bool(re.search(LODGING, term, re.I)) != lodging:
                continue
            nearby = re.fullmatch(r".+?附近(?:的)?(?:餐厅|饭店|餐馆|酒店)", term)
            if nearby:
                vicinity = re.split(r"附近", term, maxsplit=1)[0]
            elif lodging or not diet:
                keyword = term
            break
        if lodging and station and area == station[0]:
            vicinity = station[1]
        if vicinity:
            try:
                station_search = lodging and station and vicinity == station[1]
                landmark_name = vicinity if station_search else vicinity[len(stem):].lstrip("市县")
                landmarks = await asyncio.wait_for(amap.search_poi(landmark_name, area, max_results=5 if station_search else 3), 4)
                anchor = next((point for item in quality_places(landmarks)
                               if stem in (item.address or item.value)
                               and (not station_search or item.name in {vicinity, f"{stem}站"})
                               and (point := position(item))), None)
            except (TimeoutError, RuntimeError, ValueError, OSError, httpx.HTTPError):
                pass
        try:
            found = await asyncio.wait_for(amap.search_poi(
                keyword, area, max_results=6, types="100000" if lodging else "050000",
                **({"location": anchor} if anchor else {}),
            ), 8)
        except (TimeoutError, httpx.TimeoutException):
            return [], None, "timeout"
        except (RuntimeError, ValueError, OSError, httpx.HTTPError):
            return [], None, "error"
        return [
            item for item in quality_places(found)
            if position(item) and stem in (item.address or item.value)
            and item.name not in {"酒店", "餐厅"}
            and (lodging or not any(word in item.name for word in banned))
            and (lodging or not diet or re.search(r"素|vegetarian|vegan" if re.search(r"素|vegetarian|vegan", diet, re.I) else r"清真|halal", item.name + item.value, re.I))
        ][:3], vicinity if anchor else None, None

    async def platform_search(provider, city):
        query = f"查询{city}的具体酒店和详情链接。仅查询，不预订、不付款。"
        if station and city == station[0]:
            query += f"优先{station[1]}周边，返回门店地址或与火车站的距离。"
        if hotel_style:
            query += f"优先{hotel_style}。"
        if dated:
            query += f"{min(dates)}入住，{max(dates)}退房。"
        else:
            query += "入住日期尚未确认，只查具体酒店名单，不要默认日期、报价或房态。"
        if facts.get("travelers"):
            query += f"共{facts['travelers']}人。"
        if constraints:
            query += "住宿条件：" + "；".join(constraints)
        try:
            # The gateway bounds each provider at its subprocess, including slow Meituan responses.
            result = await travel.search(provider, city, query)
        except TravelSearchError as exc:
            return [], exc.code
        except (TimeoutError, RuntimeError, ValueError, OSError, httpx.HTTPError):
            return [], "upstream"
        stem = city.removesuffix("县").removesuffix("市")
        items = result.get("items", [])
        matches = [item for item in items if specific_hotel(item, stem) and (not dated or hotel_matches(item, constraints))]
        return matches[:3], "unverified" if items and not matches else None

    plans = [(area, True) for area in stay_regions] + [(area, False) for area in dining_regions]
    async def lookup_map():
        if progress and amap:
            target = f"{station[1]}周边酒店" if station and stay_regions else "酒店和餐厅" if stay_regions and dining_regions else "酒店位置" if stay_regions else "餐厅位置"
            await progress({"stage": "advice_places", "status": "RUNNING", "message": f"我在高德查{target}。", "message_en": "Checking locations on AMap."})
        results = await asyncio.gather(*(map_search(*plan) for plan in plans))
        if progress and amap:
            await progress({"stage": "advice_places", "status": "SUCCESS" if any(items for items, _, _ in results) else "WARNING", "message": "高德地点查询已结束。"})
        return results

    async def lookup_platform(provider, city):
        provider_name = "飞猪" if provider == "fliggy" else "美团"
        stage = f"supplier_{provider}_{city}"
        if progress:
            target = f"{station[1]}周边" if station and city == station[0] else city
            await progress({"stage": stage, "status": "RUNNING", "message": f"{provider_name}正在查{target}的酒店。", "message_en": f"Checking hotels near {target} on {('Fliggy' if provider == 'fliggy' else 'Meituan')}."})
        items, failure = await platform_search(provider, city)
        if progress:
            await progress({"stage": stage, "status": "SUCCESS" if items else "WARNING", "message": f"{provider_name}的{city}酒店查询已结束。"})
        return items, failure

    platform_plans = [(provider, city) for provider in providers for city in stay_regions]
    async def dining_pages(area):
        stem = area.removesuffix("县").removesuffix("市")
        try:
            found = await asyncio.wait_for(web.search(f"site:dianping.com/shop {area} {diet or '餐厅'} 店名 地址", max_results=5), WEB_SEARCH_TIMEOUT)
        except (TimeoutError, RuntimeError, ValueError, OSError, httpx.HTTPError):
            return []
        return [
            item for item in quality_places(found)
            if urlsplit(item.source_url).hostname in {"www.dianping.com", "m.dianping.com", "dianping.com"}
            and re.fullmatch(r"/shop/[A-Za-z0-9]+/?", urlsplit(item.source_url).path)
            and stem in item.name + item.value and not any(word in item.name for word in banned)
            and (not diet or diet in item.name + item.value)
        ][:2]

    async def lookup_locations():
        map_results = await lookup_map()
        gaps = [area for (area, lodging), (items, _, _) in zip(plans, map_results) if not lodging and not items]
        if not web or not gaps:
            return map_results, {}
        if progress:
            await progress({"stage": "search", "status": "RUNNING", "message": "正在复核可用的公开餐厅店铺页。"})
        pages = await asyncio.gather(*(dining_pages(area) for area in gaps))
        if progress:
            await progress({"stage": "search", "status": "SUCCESS" if any(pages) else "WARNING", "message": "公开店铺页复核已结束。"})
        return map_results, dict(zip(gaps, pages))

    (map_results, restaurant_pages), platform_results = await asyncio.gather(
        lookup_locations(), asyncio.gather(*(lookup_platform(*plan) for plan in platform_plans)),
    )
    lines = []
    for (area, lodging), (items, vicinity, failure) in zip(plans, map_results):
        label = ("Hotels on AMap" if lodging else "Restaurants on AMap") if english else ("酒店（高德）" if lodging else "餐厅（高德）")
        lines.append(f"### {vicinity + (' vicinity' if english else '附近') if vicinity else area} · {label}")
        lines.extend(
            f"- [{markdown(item.name)}]({item.source_url.replace('(', '%28').replace(')', '%29')}) · {markdown(item.value)}"
            for item in items
        )
        if failure == "timeout":
            lines.append("AMap did not respond in time." if english else "高德本次查询超时。")
        elif failure:
            lines.append("The AMap request failed." if english else "本次高德请求失败。")
        elif not items:
            lines.append(("No usable map results." if amap else "AMap is not configured.") if english else ("本次没有取得可用的地点结果。" if amap else "高德地点查询尚未配置。"))
        elif lodging and constraints:
            lines.append("Facilities and budget still need checking." if english else "上面的酒店已核对地点，设施和预算匹配仍待确认。")
        if not lodging and (pages := restaurant_pages.get(area)):
            lines.append("Public Dianping listings found on the web" if english else "联网找到的公开大众点评店铺页，位置及营业状态待核对")
            lines.extend(f"- [{markdown(page.name)}](https://www.dianping.com{urlsplit(page.source_url).path})" for page in pages)
    for (provider, city), (items, failure) in zip(platform_plans, platform_results):
        label = ("Fliggy" if provider == "fliggy" else "Meituan") if english else ("飞猪" if provider == "fliggy" else "美团")
        lines.append(f"### {city} · {label}")
        lines.extend(
            f"- [{markdown(item['title'])}]({item['url'].replace('(', '%28').replace(')', '%29')})"
            + (f" · {markdown(item.get('price_text') or ('See provider for pricing' if english else '价格见平台'))}" if dated else "")
            for item in items
        )
        if failure == "timeout":
            lines.append("The platform timed out." if english else "本次平台查询超时。")
        elif failure == "unverified":
            lines.append("The returned items could not be verified for this stay." if english else "平台返回了商品，但本次无法核对具体门店或是否符合住宿条件。")
        elif failure and failure != "empty":
            lines.append("The platform request failed." if english else "本次平台请求失败。")
        elif not items:
            lines.append("No matching hotel results returned." if english else "本次没有取得符合条件的酒店候选。")
        elif station:
            lines.append("Check each hotel's distance to the station." if english else "平台候选到车站的距离仍待核对。")
    if stay_regions and not dated:
        lines.append(("For live hotel rates and availability, tell me the check-in and check-out dates" + (" and the stay location." if len(stay_regions) > 1 else ".")) if english else
                     "要查这些酒店的实时价格和房态，请告诉我入住和退房日期" + ("，以及住在哪一站。" if len(stay_regions) > 1 else "。"))
    if stay_regions and not providers:
        lines.append("No hotel search platform is configured." if english else "酒店平台尚不可用，目前仅显示地图地点。")
    return "\n\n".join(lines)
