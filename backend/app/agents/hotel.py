from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.agents.base import BaseAgent
from app.schemas.domain import HotelOption
import asyncio
from datetime import timedelta
from app.agents.intake import request_is_driving
from app.agents.recommendation_checks import hotel_constraints, hotel_fit, same_hotel_branch

CITY_QUERY_TIMEOUT=25
ROAD_QUERY_TIMEOUT=40


def consume_background(task):
    if not task.cancelled():task.exception()


class HotelAgent(BaseAgent):
    agent_id = "hotel"
    name = "Hotel Agent"
    description = "Compares clearly labelled hotel candidates without claiming live inventory"
    capabilities = {"hotel_search", "hotel_comparison"}
    tool_permissions = {"travel_search", "mock_hotel_catalog"}

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        requirement = state["requirement"]
        if requirement.days<=1:return {'hotels':[],'hotel_mode':'not_required'}
        constraints = hotel_constraints('；'.join(requirement.preferences + requirement.hard_constraints))
        gateway=state.get('travel_gateway')
        if gateway:
            configured=[row['id'] for row in gateway.status() if row['configured'] and row['client_installed']]
            if configured:
                slots=[(requirement.destination,requirement.start_date,requirement.start_date+timedelta(days=requirement.days-1))]
                driving=state.get('request') and request_is_driving(state['request'])
                if driving:
                    if not state.get('itinerary'):return {'hotels':[],'hotel_mode':'pending_route'}
                    slots=[]
                    for day in state['itinerary'][:-1]:
                        if '→' not in day.title or any(c.get('status')=='unavailable' for c in day.route_checks):continue
                        city=day.title.split('→')[-1].strip()
                        if slots and slots[-1][0]==city and slots[-1][2]==day.date:slots[-1]=(city,slots[-1][1],day.date+timedelta(days=1))
                        else:slots.append((city,day.date,day.date+timedelta(days=1)))
                    if not slots:return {'hotels':[],'hotel_mode':'unavailable'}
                partial=len(slots)>3 or bool(driving and sum((end-start).days for _,start,end in slots)<requirement.days-1)
                async def lookup(city,start,end):
                    query=f'仅查询酒店，不预订：{city}，{start}入住，{end}退房，{requirement.travelers}人；请返回酒店候选和价格。'
                    if constraints:
                        query += ' 住宿条件：' + '；'.join(constraints) + '。请提供分店位置、适用日期的每晚价格及设施依据。'
                    async def search(provider):
                        try:
                            response = await gateway.search(provider, city, query)
                            options = []
                            for item in response['items']:
                                pending = hotel_fit(item, constraints)
                                if pending is None:
                                    continue
                                option = HotelOption(
                                    hotel_id=item['candidate_id'], candidate_id=item['candidate_id'], name=item['title'],
                                    provider=response['provider'], area=city, room_type='房型待平台确认',
                                    price_text=item['price_text'], cancellation_policy='以平台所选产品规则为准',
                                    availability=f'{start}至{end}；查询候选，未锁定房态',
                                    source_url=item['url'], is_mock=False, pending_checks=pending,
                                )
                                options.append(option)
                            return options
                        except Exception:
                            return []

                    fallback = {}
                    searches = [asyncio.create_task(search(provider)) for provider in configured]
                    try:
                        remaining = set(searches)
                        deadline = asyncio.get_running_loop().time() + (ROAD_QUERY_TIMEOUT if driving else CITY_QUERY_TIMEOUT) - 1
                        while remaining:
                            done, remaining = await asyncio.wait(
                                remaining, timeout=max(0, deadline - asyncio.get_running_loop().time()),
                                return_when=asyncio.FIRST_COMPLETED,
                            )
                            if not done:
                                break
                            for task in searches:
                                if task not in done:
                                    continue
                                options = task.result()
                                matches = [option for option in options if not option.pending_checks]
                                if matches:
                                    return matches[:(2 if driving else 6)]
                                for option in options:
                                    previous = fallback.get(option.name)
                                    if previous is None or len(option.pending_checks) < len(previous.pending_checks):
                                        fallback[option.name] = option
                        return sorted(fallback.values(), key=lambda hotel: len(hotel.pending_checks))[:4]
                    finally:
                        for task in searches:
                            if not task.done():
                                task.cancel()
                                task.add_done_callback(consume_background)
                try:
                    tasks=[asyncio.create_task(lookup(*slot)) for slot in slots[:3]]
                    try:
                        done,pending=await asyncio.wait(tasks,timeout=ROAD_QUERY_TIMEOUT if driving else CITY_QUERY_TIMEOUT)
                    except BaseException:
                        for task in tasks:
                            task.cancel();task.add_done_callback(consume_background)
                        raise
                    for task in pending:
                        task.cancel();task.add_done_callback(consume_background)
                    results=[task.result() if not task.cancelled() and task.exception() is None else None for task in tasks if task in done]
                    hotels=[hotel for result in results if isinstance(result,list) for hotel in result]
                    amap = getattr(state.get('tool_gateway'), 'amap', None)
                    if amap and not driving and hotels:
                        async def locate(hotel):
                            try:
                                facts = await asyncio.wait_for(
                                    amap.search_poi(hotel.name, requirement.destination, max_results=5, types='100000'),
                                    timeout=3,
                                )
                                matches = {fact.source_url: fact for fact in facts if same_hotel_branch(hotel.name, fact)}
                                if len(matches) == 1:
                                    hotel.map_location = next(iter(matches.values()))
                            except Exception:
                                return
                        limit = 4 if all(hotel.pending_checks for hotel in hotels) else 2
                        await asyncio.gather(*(locate(hotel) for hotel in hotels[:limit]))
                    # Only cross-located branches are useful as manual follow-up leads.
                    hotels = [hotel for hotel in hotels if not hotel.pending_checks or hotel.map_location]
                    if hotels and all(hotel.pending_checks for hotel in hotels):
                        hotels = hotels[:2]
                    partial=partial or bool(pending) or any(not result or all(h.pending_checks for h in result) for result in results)
                    return {'hotels':hotels,'hotel_mode':('partial' if partial else 'real') if hotels else 'unavailable'}
                except Exception:
                    return {'hotels':[],'hotel_mode':'unavailable'}
        if constraints or state.get('request') and not state['request'].allow_mock:return {'hotels':[],'hotel_mode':'unavailable'}
        nights = max(requirement.days - 1, 1)
        hotel_budget = Decimal(str(requirement.budget_cny)) * Decimal("0.32")
        baseline = hotel_budget / Decimal(nights)
        profiles = [
            ("A", "交通便利型", "核心商圈/地铁附近", Decimal("0.85"), 4.5, "入住前一天可免费取消"),
            ("B", "预算优先型", "次核心区/公共交通可达", Decimal("0.68"), 4.2, "预订后不可免费取消"),
            ("C", "舒适优先型", "核心商圈", Decimal("1.05"), 4.7, "入住前两天可免费取消"),
        ]
        hotels = []
        for code, label, area, ratio, rating, cancellation in profiles:
            nightly = (baseline * ratio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total = (nightly * Decimal(nights)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            hotels.append(
                HotelOption(
                    hotel_id=f"mock-{code.lower()}",
                    name=f"模拟酒店候选 {code} · {label}",
                    provider="JARVIS Mock Hotel Provider",
                    area=f"{requirement.destination} · {area}",
                    room_type="模拟标准双人间",
                    nightly_price_cny=float(nightly),
                    total_price_cny=float(total),
                    rating=rating,
                    cancellation_policy=cancellation,
                    availability="模拟数据，房态未核验",
                    is_mock=True,
                )
            )
        return {"hotels": hotels, "hotel_mode": "mock"}
