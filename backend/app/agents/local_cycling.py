"""Resolve a concrete cycling follow-up through the map provider."""
import asyncio
from math import asin, ceil, cos, floor, radians, sin, sqrt
from typing import NamedTuple
import re
from urllib.parse import urlencode

from app.agents.destination import HAN, needs_city
from app.agents.dining import markdown, safe_url
from app.agents.intake_policy import active_epoch
from app.agents.locality_memory import amap_city, stated_locality
from app.agents.map_capability import asks_about_map_access
from app.agents.recommendation_checks import amap_position


CYCLING = re.compile(r'骑行|骑车|骑自行车|电动车|电动自行车|骑摩托|\bcycling\b', re.I)
ADDRESS = re.compile(rf'([{HAN}A-Za-z0-9·]{{1,35}}(?:路|街|巷|道|弄)\d+(?:[-之]\d+)?号)')
LANDMARK = re.compile(rf'(?:从|起点[是为]?|我在|我住在)\s*([{HAN}]{{2,25}}?(?:学院|大学|校区|车站|公园|广场|酒店))(?=出发|骑|前往|到|去|[，。！？?、\s]|$)')
CITY = re.compile(rf'([{HAN}]{{2,12}}?市)(?!区)')
VENUE = re.compile(rf'([{HAN}]{{2,14}}?(?:湿地公园|公园|水库|绿道|湖))')
SPEED = re.compile(
    r'(?<![\d.])(\d+(?:\.\d+)?)(?:\s*(?:[~～〜—–-]|到|至)\s*(\d+(?:\.\d+)?))?'
    r'\s*(?:km\s*/\s*h|公里\s*/\s*(?:小时|h)|公里每小时|千米每小时|kph)\b',
    re.I,
)
ROUTE_REVIEW = re.compile(r'路线|路程|里程|来回|往返|多久|骑多久|骑行时间|骑行速度|骑车速度|route|round trip', re.I)
ARRIVAL_REVIEW = re.compile(r'(\d+(?:\.\d+)?)\s*分钟(?:内|就|能|可以)?\s*(?:骑(?:行)?)?到')
DISTANCE_REVIEW = re.compile(r'\d+(?:\.\d+)?\s*(?:公里|km|千米)|直线距离|实际里程|到底多远|有多远', re.I)
RETRY = re.compile(r'(?:重试(?:一下|一次)?|再试(?:一下|一次)?|重新查(?:一下)?|再查一次|retry|try again)[？?。！!\s]*', re.I)
DOUBT = re.compile(r'(?:真的假的|真的吗|你确定吗?|确定吗|靠谱吗|你认真的|really|are you sure)[？?。！!\s]*', re.I)
DELEGATE_LOOKUP = re.compile(
    r'(?:那(?:就|你)?\s*|好[，, ]*|可以[，, ]*)?(?:你(?:来|直接)?\s*|请\s*)?'
    r'(?:帮我|替我|给我)?\s*(?:用高德|用地图)?\s*(?:查(?:一下|一查|吧)?|核对一下|验证一下)'
    r'[？?。！!\s]*|(?:please )?(?:look it up|check it|check for me)[?!.\s]*',
    re.I,
)
ROUTE_CITY_PROMPT = re.compile(r'在哪个城市或区县|所在城市|哪个城市|哪个区县|what city or district', re.I)
CITY_ANSWER = re.compile(rf'[{HAN}]{{2,18}}(?:\s*[,，、]\s*[{HAN}]{{2,18}})*')
CONFIRM_PLACE = re.compile(r'(?:确实)?有(?:这个|该|这)地点|(?:确实)?有这个地方|地图上有|(?:是的|对)[，, ]*有', re.I)
ROUTE_PAIR = re.compile(r'([^「」\[\]\n，。；：:→]{2,45})\s*→\s*([^「」\[\]\n，。；：:→]{2,35})')
LABELED_ROUTE = re.compile(r'起点\s*[：:]?\s*「([^」]+)」[^\n。]{0,20}终点\s*[：:]?\s*「([^」]+)」')
CURRENT_LOCATION = re.compile(
    r'我(?:现在|目前)?的(?:实时|当前)?位置(?:在)?(?:哪|什么地方)|我(?:现在|目前)在哪|(?:能|可以|帮我).{0,5}定位我|\bwhere am i(?: right now)?\b',
    re.I,
)


class CyclingLookup(NamedTuple):
    start: str | None
    destination: str | None
    candidates: list[str]
    city: str | None
    speed: tuple[float, float] | None
    review: bool
    arrival: float | None
    distance_review: bool


def _pending_cycling_lookup(recent, *, retry=False):
    """Recover the named route from an unfinished lookup in saved chat."""
    if not recent or recent[-1].role != 'assistant':
        return None
    reply = recent[-1].content
    missing_result = re.search(r'没(?:有)?(?:查到|返回|拿到)|未(?:查到|返回|取得)|无结果|暂未|no (?:route|result)', reply, re.I)
    if not (ROUTE_REVIEW.search(reply) and (ROUTE_CITY_PROMPT.search(reply) or retry and missing_result)):
        return None
    history = '\n'.join(turn.content for turn in recent[-10:])
    pair = ROUTE_PAIR.search(reply) or LABELED_ROUTE.search(reply)
    if not CYCLING.search(history) or not pair:
        return None
    start = ADDRESS.search(pair[1])
    destination = VENUE.fullmatch(pair[2].strip())
    if start and destination:
        city = None
        for turn in reversed(recent[:-1]):
            if turn.role != 'user':
                continue
            parts = re.split(r'\s*[,，、]\s*', turn.content.strip())
            if len(parts) > 1 and CITY_ANSWER.fullmatch(turn.content.strip()):
                normalized = {amap_city(part) for part in parts}
                if len(normalized) == 1:
                    city = normalized.pop()
                    break
        return CyclingLookup(start[1], destination[1], [], city, None, True, None, True)
    return None


def asks_for_current_location(messages):
    latest = next((message.content for message in reversed(messages) if message.role == 'user'), '')
    return bool(CURRENT_LOCATION.search(latest))


def current_location_reply(messages, language):
    recent = active_epoch(messages)
    known = None
    for message in reversed(recent[:-1]):
        if message.role != 'user':
            continue
        if match := re.search(r'(?:我(?:现在|目前)?在|我住在?)\s*([^，。！？?\n]{2,40})', message.content):
            known = match[1].strip()
            break
    plan_start = None
    if not known:
        for message in reversed(recent[:-1]):
            if message.role == 'assistant' and (match := LANDMARK.search(message.content)):
                plan_start = match[1]
                break
    if language == 'en':
        context = f'You said you were at {known}. ' if known else f'The itinerary starts at {plan_start}. ' if plan_start else ''
        return context + 'This chat has no live device location. Open the map page and select “Locate me” to check your current position.'
    context = f'你之前说你在「{known}」。' if known else f'上文行程的起点是「{plan_start}」。' if plan_start else ''
    return context + '聊天里还没有收到设备的实时位置。要确认你现在在哪，可以在地图页点「自动定位」并授权。'


def _speed(text):
    if match := SPEED.search(text):
        low, high = sorted((float(match[1]), float(match[2] or match[1])))
        if 0 < low <= high < float('inf'):
            return low, high
    return None


def cycling_followup(messages, saved_lookup=None):
    recent = active_epoch(messages)
    if len(recent) >= 3 and recent[-1].role == 'user' and recent[-2].role == 'assistant':
        answer = recent[-1].content.strip('。！!，, ？?')
        city = CITY_ANSWER.fullmatch(answer)
        prompt = recent[-2].content
        if saved_lookup and (RETRY.fullmatch(answer) or CONFIRM_PLACE.fullmatch(answer) or
                             DELEGATE_LOOKUP.fullmatch(answer) or DOUBT.fullmatch(answer)):
            return saved_lookup
        if city and ROUTE_CITY_PROMPT.search(prompt) and not (
            DOUBT.fullmatch(answer) or RETRY.fullmatch(answer) or DELEGATE_LOOKUP.fullmatch(answer) or CONFIRM_PLACE.fullmatch(answer)
        ):
            pending = cycling_followup(recent[:-2]) or _pending_cycling_lookup(recent[:-1])
            pending = saved_lookup or pending
            if pending and pending.start:
                parts = re.split(r'\s*[,，、]\s*', answer)
                known_city = amap_city(parts[0])
                if len(parts) == 1 or all(amap_city(part) == known_city for part in parts):
                    return pending._replace(city=known_city)
        if CONFIRM_PLACE.fullmatch(answer):
            if pending := _pending_cycling_lookup(recent[:-1], retry=True):
                return pending
        if RETRY.fullmatch(recent[-1].content.strip()):
            if pending := _pending_cycling_lookup(recent[:-1], retry=True):
                return pending
    # Replay the last substantive user turn with its original preceding context.
    # A generated reply to the failed attempt cannot redefine its endpoints.
    for index in range(len(recent) - 1, -1, -1):
        message = recent[index]
        if message.role == 'user' and not RETRY.fullmatch(message.content.strip()):
            recent = recent[:index + 1]
            break
    else:
        return None
    users = [message.content for message in recent if message.role == 'user']
    current = users[-1]
    retry_map = asks_about_map_access(recent)
    arrival = ARRIVAL_REVIEW.search(current)
    distance_review = bool(DISTANCE_REVIEW.search(current) and re.search(r'确|真|只有|吗|[?？]|直线|实际|多远|核对', current))
    if DELEGATE_LOOKUP.fullmatch(current.strip()) and len(recent) >= 2:
        previous_reply = recent[-2]
        # Carry the route through a short delegation only when the preceding
        # reply actually discusses a named cycling destination and its route.
        prior_route = '\n'.join(message.content for message in recent[-6:-1])
        distance_review = (
            previous_reply.role == 'assistant'
            and bool(ROUTE_REVIEW.search(previous_reply.content) or DISTANCE_REVIEW.search(previous_reply.content))
            and bool(VENUE.search(previous_reply.content))
            and bool(CYCLING.search(prior_route) or re.search(r'骑.*分钟', previous_reply.content))
        )
    if DOUBT.fullmatch(current.strip()) and len(recent) >= 3:
        previous_reply = recent[-2]
        preceding_user = next((message.content for message in reversed(recent[:-1]) if message.role == 'user'), '')
        if previous_reply.role == 'assistant':
            arrival = arrival or ARRIVAL_REVIEW.search(preceding_user) or ARRIVAL_REVIEW.search(previous_reply.content)
            distance_review = distance_review or (not arrival and bool(
                DISTANCE_REVIEW.search(preceding_user) or DISTANCE_REVIEW.search(previous_reply.content)
            ))
    speed = _speed(current)
    if (retry_map or arrival or distance_review) and not speed:
        speed = next((value for message in reversed(users[-6:-1]) if (value := _speed(message))), None)
    review = retry_map or distance_review or bool(arrival or speed and ROUTE_REVIEW.search(current))
    address = ADDRESS.search(current) or LANDMARK.search(current)
    history_depth = 10 if retry_map or arrival or distance_review else 6 if review else 3
    previous = '\n'.join(message.content for message in recent[-history_depth:-1])
    cycling_context = CYCLING.search(current + '\n' + previous) or (
        distance_review and re.search(r'骑\d|骑\s*回|骑\s*到|骑\s*\d|骑.*分钟', previous)
    )
    if review and not address and cycling_context:
        sources = list(reversed(users[-history_depth:-1]))
        if arrival or distance_review:
            sources.extend(message.content for message in reversed(recent[-history_depth:-1]) if message.role == 'assistant')
        if arrival:
            # A named departure in the plan identifies the route being challenged.
            sources.sort(key=lambda text: not (LANDMARK.search(text) and '出发' in text))
        for earlier in sources:
            if match := ADDRESS.search(earlier) or LANDMARK.search(earlier):
                current = earlier
                address = match
                break
    if not cycling_context:
        return None
    if not address:
        return CyclingLookup(None, None, [], None, speed, review, None, distance_review) if review and not retry_map else None
    start = re.split(r'我在|我住在?|住在|起点(?:是|为)?|从', address[1])[-1]
    tail = current[address.end():]
    target = re.search(r'^(?:出发)?\s*(?:骑(?:行)?(?:去|到)|前往|到|去|→)\s*([^，。！？,\n]+)', tail)
    links = re.findall(r'\[([^\]\n]+)\]\(https://uri\.amap\.com/marker\?[^)]+\)', previous) if review else []
    venue_names = [re.split(r'可以|上午|下午|前往|方向|往|去|到|在|逛|绕|请确认|核对', match[1])[-1]
                   for match in VENUE.finditer(previous)]
    # Preserve the most recently proposed named stop for a time challenge.
    prior = [*reversed(links), *(reversed(venue_names) if arrival or distance_review else venue_names)]
    prior = [name for name in prior if len(name) >= 3 and name not in {'城区公园', '附近公园', '周边公园', '新区公园'}]
    return CyclingLookup(start, target[1].strip('？！?！。') if target else None, prior, None, speed, review, float(arrival[1]) if arrival else None, distance_review)


def _point(location):
    if not isinstance(location, str):
        return None
    return amap_position('https://uri.amap.com/marker?' + urlencode({'position': location}))


async def cycling_reply(amap, messages, city, language='zh', *, emit=None, web_search=None, saved_lookup=None):
    from app.agents.itinerary import route_metrics

    followup = cycling_followup(messages, saved_lookup)
    if followup is None:
        return None
    start, requested, prior, confirmed_city, speed, review, arrival, distance_review = followup
    en = language == 'en'
    if not start:
        return ('What are the starting address and destination? Then I can check distance and cycling time.'
                if en else '把起点和终点发我，我用地图里程核对骑行时间。')
    recent_users = [message.content for message in active_epoch(messages) if message.role == 'user']
    if review and not requested:
        if not prior:
            return ('Which destination should I check? I have your starting address and speed.'
                    if en else '起点已收到。你想核对哪个终点？有多个停靠点的话，可以按顺序发我。')
        requested = prior[0]
    city_match = CITY.match(start)
    city = city_match[1] if city_match else confirmed_city or stated_locality(messages) or city
    city = amap_city(city)
    hint = None
    if distance_review and not city and ADDRESS.fullmatch(start):
        history = '\n'.join(recent_users[-5:]) + '\n' + '\n'.join(
            message.content for message in reversed(active_epoch(messages)[-10:-1]) if message.role == 'assistant')
        hint = re.search(rf'([{HAN}]{{2,22}}?(?:学院|大学|校区))(?:附近|旁边)', history)
        if hint:
            hint = re.split(r'就是|也就是|靠近|在', hint[1])[-1]
    if (not city or needs_city(city)) and ADDRESS.fullmatch(start) and not hint:
        return (f'What city or district is {start} in? I can use it to check a cycling route.'
                if en else f'「{start}」在哪个城市或区县？我可以用这个门牌查骑行路线。')
    if not amap:
        return 'The cycling map service is unavailable.' if en else '骑行地图服务暂不可用，当前还没有可核对的路线。'
    mode = 'bicycling'
    retry_turn = RETRY.fullmatch(recent_users[-1].strip())
    vehicle_history = [message for message in recent_users if not RETRY.fullmatch(message.strip())] if retry_turn else recent_users
    for message in reversed(vehicle_history[-5:]):
        if vehicle := re.search(r'电动自行车|电动车|电瓶车|摩托(?:车)?|自行车', message):
            mode = 'motorcycle' if '摩托' in vehicle[0] else 'bicycling' if vehicle[0] == '自行车' else 'electric'
            break

    async def lookup():
        async def venue(name):
            candidates = await amap.search_poi(name, search_city, max_results=5)
            matches = {amap_position(fact.source_url): fact for fact in candidates
                       if not fact.is_mock and fact.name == name and amap_position(fact.source_url)}
            return next(iter(matches.values())) if len(matches) == 1 else None

        search_city = city or ''
        if hint:
            landmark = await venue(hint)
            address = landmark.address if landmark else None
            match = re.match(r'^(?:[^省]+省|[^区]+自治区)?([^市]+市)', address or '')
            if not match or start not in address:
                return f'「{start}」在哪个城市或区县？补充后我可以重新核对距离。'
            search_city = match[1]
        if ADDRESS.fullmatch(start):
            points = {}
            street = start[len(city_match[1]):] if city_match else start
            for match in await amap.geocode(start, city=search_city):
                label = match.get('formatted_address') or ''
                if search_city.removesuffix('市') in label and street in label and (point := _point(match.get('location'))):
                    points[point] = label
            if len(points) != 1:
                return ('Please confirm the address or provide a nearby landmark.'
                        if en else f'高德未能唯一定位「{start}」这个门牌。可以补充区县，或提供旁边的地标。')
            origin, label = next(iter(points.items()))
        else:
            landmark = await venue(start)
            if landmark is None:
                return (f'I could not uniquely locate {start}. Which campus or entrance should I use?'
                        if en else f'高德未能唯一定位「{start}」。你想从哪个校区或入口出发？')
            origin, label = amap_position(landmark.source_url), landmark.name
            if not search_city and (match := re.match(r'^(?:[^省]+省|[^区]+自治区)?([^市]+市)', landmark.address or '')):
                search_city = match[1]
        start_point = ','.join(map(str, origin))

        if requested:
            stop = await venue(requested)
            if stop is None:
                return (f'I could not uniquely locate {requested}. Which branch or entrance do you mean?'
                        if en else f'高德暂未唯一定位「{requested}」。你想去哪个具体地点或入口？')
            stops = [stop]
        else:
            queries = [venue(name) for name in list(dict.fromkeys(prior))[:2]]
            nearby, *named = await asyncio.gather(
                amap.search_poi('公园|绿道', search_city, max_results=6, types='110000', location=origin),
                *queries, return_exceptions=True,
            )
            nearby = nearby if isinstance(nearby, list) else []
            stops = [fact for fact in [*named, *nearby] if hasattr(fact, 'source_url') and not fact.is_mock
                     and amap_position(fact.source_url) and not re.search(r'停车场|公交站|厕所|管理处', fact.name)]

        async def measure(stop):
            finish = ','.join(map(str, amap_position(stop.source_url)))
            if finish == start_point:
                return None
            seconds, meters = await route_metrics(amap, start_point, finish, mode=mode)
            if seconds <= 0 or meters <= 0:
                return None
            return seconds, meters, stop, finish

        unique = {amap_position(stop.source_url): stop for stop in stops}
        results = await asyncio.gather(*(measure(stop) for stop in list(unique.values())[:4]), return_exceptions=True)
        best = min((result for result in results if isinstance(result, tuple)), default=None, key=lambda result: result[:2])
        if best is None:
            return ('The map service did not return a cycling route for these points.'
                    if en else '高德这次没有返回可用骑行路线。可以指定一个具体终点再查。')
        seconds, meters, stop, finish = best
        minutes = max(1, round(seconds / 60))
        stop_link = f'[{markdown(stop.name)}]({stop.source_url})'
        if distance_review:
            lng1, lat1 = map(radians, origin)
            lng2, lat2 = map(radians, amap_position(stop.source_url))
            arc = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
            straight = 12742 * asin(sqrt(min(1, arc)))
            if en:
                return f'{label} → {stop_link}. Straight-line distance is about **{straight:.1f} km**. AMap gives a cycling route of **{meters / 1000:.1f} km**, with an estimated **{minutes} min**.'
            return f'{label} → {stop_link}。按高德两个点位计算，直线约 **{straight:.1f} 公里**。高德骑行路线 **{meters / 1000:.1f} 公里**，导航预计 **{minutes} 分钟**。'
        try:
            back_seconds, back_meters = await route_metrics(amap, finish, start_point, mode=mode)
        except Exception:
            back_seconds, back_meters = 0, 0
        if speed:
            def moving_time(distance):
                fastest = max(1, floor(distance * 0.06 / speed[1]))
                slowest = max(1, ceil(distance * 0.06 / speed[0]))
                return f'{fastest}–{slowest}' if fastest != slowest else str(fastest)

            speed_label = f'{speed[0]:g}–{speed[1]:g}' if speed[0] != speed[1] else f'{speed[0]:g}'
            has_return = back_seconds > 0 and back_meters > 0
            if en:
                result = f'{label} → {stop_link}: **{meters / 1000:.1f} km, about {moving_time(meters)} min** at {speed_label} km/h, using AMap distance.'
                if has_return:
                    result += f'\n\nReturn: **{back_meters / 1000:.1f} km, about {moving_time(back_meters)} min**. Round trip: **{(meters + back_meters) / 1000:.1f} km, about {moving_time(meters + back_meters)} min**.'
                else:
                    result += '\n\nReturn route pending.'
                return result + '\n\nMoving time only. Extra stops, traffic lights and breaks still need to be factored in.'
            result = f'**按 {speed_label} km/h 核算**\n\n{label} → {stop_link}，高德骑行路线 **{meters / 1000:.1f} 公里**，预计骑 **{moving_time(meters)} 分钟**。'
            if arrival and meters * 0.06 / speed[1] > arrival:
                result += f' 按你给的速度，**{arrival:g} 分钟到不了**。'
            elif arrival:
                result += f' {arrival:g} 分钟需要平均约 **{meters * 0.06 / arrival:.1f} km/h**，还要给等灯和出入留时间。'
            if arrival:
                result += f' 高德对这条路线的预计用时约 **{minutes} 分钟**。'
            if has_return:
                result += f'\n\n回程 **{back_meters / 1000:.1f} 公里，约 {moving_time(back_meters)} 分钟**。往返合计 **{(meters + back_meters) / 1000:.1f} 公里，约 {moving_time(meters + back_meters)} 分钟**。'
            else:
                result += '\n\n回程暂未查到。'
            return result + '\n\n这是这两个地点之间的纯骑行时间。绕湖、其他停靠点、等红灯和休息要另算。'
        if en:
            result = f'{label} → {stop_link}: {meters / 1000:.1f} km, about {minutes} min one way (AMap).'
            return result + (f'\nReturn: {back_meters / 1000:.1f} km, about {max(1, round(back_seconds / 60))} min.' if back_seconds > 0 and back_meters > 0 else '\nReturn route pending.')
        vehicle = {'electric': '电动自行车', 'motorcycle': '摩托车', 'bicycling': '自行车'}[mode]
        result = f'**{vehicle}路线**\n\n{label} → {stop_link}，去程 **{meters / 1000:.1f} 公里，约 {minutes} 分钟**（高德）。'
        if arrival:
            result += f' {arrival:g} 分钟需要平均约 **{meters * 0.06 / arrival:.1f} km/h**，还要给等灯和出入留时间。'
        return result + (f'\n\n回程 **{back_meters / 1000:.1f} 公里，约 {max(1, round(back_seconds / 60))} 分钟**。' if back_seconds > 0 and back_meters > 0 else '\n\n回程暂未查到。')

    try:
        if emit:
            await emit(stage='cycling_route', status='RUNNING',
                       message='正在用高德查询骑行里程和预计用时。',
                       message_en='Checking cycling distance and estimated time with AMap.')
        result = await asyncio.wait_for(lookup(), timeout=18)
    except Exception:
        return 'The map lookup could not be completed. Please retry.' if en else '这次高德查询未完成，暂时没有可用的骑行距离和时间。可以重试。'
    destination = re.search(r'\[([^\]\n]+)\]\(https://uri\.amap\.com/marker\?', result)
    if emit and destination:
        await emit(stage='cycling_route', status='SUCCESS', message='已查到骑行里程和预计用时。',
                   message_en='Found the cycling distance and estimated time.')
    if web_search is None or not destination:
        return result
    if emit:
        await emit(stage='search', status='RUNNING',
                   message='正在查目的地的公开通行公告。',
                   message_en='Checking public access notices for the destination.')
    try:
        facts = await asyncio.wait_for(
            web_search.search(f'{city} {destination[1]} 官方 骑行 通行限制 开放公告', max_results=3), timeout=6,
        )
    except Exception:
        facts = []
    links = [f"- [{markdown(fact.name)}]({fact.source_url.replace('(', '%28').replace(')', '%29')})"
             for fact in facts if not fact.is_mock and safe_url(fact.source_url)]
    if links:
        heading = 'Related web notices' if en else '网页复核 · 相关通行公告'
        return result + '\n\n**' + heading + '**\n' + '\n'.join(links)
    return result + ('\n\nNo usable public notices were found.' if en else '\n\n网页复核暂未找到可引用的通行公告。')
