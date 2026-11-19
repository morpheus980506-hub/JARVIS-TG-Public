from datetime import datetime,timedelta
from typing import Any
from urllib.parse import urlsplit
from math import hypot, isfinite
import asyncio
import re

from app.agents.base import BaseAgent
from app.schemas.domain import DayPlan,ChatMessage
from app.agents.dining import dining_constraints,markdown,safe_url
from app.agents.intake import request_is_driving
from app.agents.driving_schedule import driving_schedule
from app.agents.recommendation_checks import amap_position, indoor_only, indoor_venue


def closed_on(place, day):
    hours = place.get("opening_hours") or ""
    weekday = "一二三四五六日"[day.weekday()]
    day_pattern = "[日天]" if weekday == "日" else weekday
    return bool(re.search(rf'(?:周|星期){day_pattern}\s*(?:全天)?\s*(?:闭馆|休息|不开放|不营业)', hours))


async def route_metrics(amap, start, end, timeout=3, *, mode="walking"):
    options = {'show_fields': 'cost'} if mode != 'walking' else {}
    response = await asyncio.wait_for(amap.route(start, end, mode=mode, **options), timeout=timeout)
    path = response['route']['paths'][0]
    seconds = float(path.get('cost', {}).get('duration', path.get('duration')))
    meters = float(path['distance'])
    if not all(isfinite(value) and value >= 0 for value in (seconds, meters)):
        raise ValueError("Invalid walking route")
    return seconds, meters


class ItineraryAgent(BaseAgent):
    agent_id = "itinerary"
    name = "Itinerary Agent"
    description = "Builds a balanced daily itinerary"
    capabilities = {"itinerary_planning", "route_scheduling"}

    async def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        req = state["requirement"]
        if state.get('request') and request_is_driving(state['request']):return await driving_schedule(state)
        transport = [item for item in state.get("transport", []) if not item.is_mock]
        def arrival_minutes(item):
            try:
                arrival=datetime.fromisoformat(item.arrival_time)
                return (arrival.date()-req.start_date).days*1440+arrival.hour*60+arrival.minute
            except (ValueError,TypeError):return None
        daytime=[item for item in transport if arrival_minutes(item) is not None and 360<=arrival_minutes(item)<=1080]
        recommended = min(
            daytime or transport,
            key=lambda item: item.duration_minutes if item.duration_minutes is not None else 10**9,
            default=None,
        )
        research_is_mock = any(item.is_mock for item in state.get("research", []))
        food_preferences='；'.join(req.preferences+req.hard_constraints)
        banned, diet, _ = dining_constraints([ChatMessage(role='user', content=food_preferences)] if food_preferences else [])
        indoors = indoor_only(food_preferences)
        places=[]
        seen = set()
        def visit_stop(fact):
            if fact.is_mock or (fact.place_type or '').startswith(('05', '06', '10', '15')):
                return None
            if indoors and not indoor_venue(fact.name):
                return None
            if coordinates := amap_position(fact.source_url):
                lng, lat = coordinates
                return {'name':fact.name,'address':fact.address or fact.value,'lng':lng,'lat':lat,'source_url':fact.source_url,'stay_minutes':120,'opening_status':'unverified','opening_hours':fact.opening_hours}

        for fact in state.get('research', []):
            if fact.source_url not in seen and (stop := visit_stop(fact)):
                places.append(stop)
                seen.add(fact.source_url)
        # Keep adjacent candidates together instead of scattering them across days.
        ordered=[]
        while places:
            next_place=min(places,key=lambda p:hypot(p['lng']-ordered[-1]['lng'],p['lat']-ordered[-1]['lat'])) if ordered else places[0]
            ordered.append(next_place);places.remove(next_place)
        places_for_meals = tuple(ordered)
        gateway=state.get('tool_gateway')
        amap=getattr(gateway,'amap',None)
        usable_hotels = [hotel for hotel in state.get('hotels', []) if not hotel.pending_checks]
        limits = re.findall(r'(?:步行|走路)\s*(?:每段)?\s*(?:最多|不超过|至多|≤)\s*(\d+)\s*分钟', food_preferences)
        walk_limit = min(map(int, limits)) if limits else 45
        meal_walk_limit = min(walk_limit, 20)
        plans = []
        for index in range(req.days):
            current = req.start_date + timedelta(days=index)
            stops=[];checks=[]
            if index == 0:
                transport_activity = f"从{req.origin}前往{req.destination}"
                if recommended:
                    transport_activity = (
                        f"候选：{recommended.service_number}，"
                        f"{recommended.departure_time} 出发，{recommended.arrival_time} 抵达"
                    )
                activities = ([transport_activity,'安排一处轻量活动，预留用餐和休息','当日返程，车次和时间需另外核对'] if req.days==1 else [transport_activity, "入住并熟悉酒店周边", "品尝当地特色晚餐"])
                arrival=arrival_minutes(recommended) if recommended else None
                if arrival is None:
                    activities=[transport_activity,'抵达时间尚未确认，接驳及返程需先核对','抵达后以休息为主，暂不固定游玩及餐次'] if req.days==1 else [transport_activity,'抵达时间尚未确认，接驳与入住按实际到达安排','抵达后以休息为主，暂不固定游玩及餐次']
                elif arrival>=20*60:
                    activities=[transport_activity,'该候选晚间或次日抵达，不适合当日往返；先更换交通或延长行程'] if req.days==1 else [transport_activity,'晚间或次日抵达，提前确认接驳及可入住时间','抵达后休息；不再安排当晚游玩或特色晚餐']
                if '入住并熟悉酒店周边' in activities:activities[activities.index('入住并熟悉酒店周边')]='抵达后寄存行李，入住时间以酒店确认为准'
                if diet and '品尝当地特色晚餐' in activities:
                    activities[-1] = f'晚餐待定 · 确认住宿后再查附近{diet}餐厅'
                if not usable_hotels and req.days > 1:
                    activities = [item.replace('抵达后寄存行李，入住时间以酒店确认为准', '先确认符合条件的住宿，再安排入住和寄存行李') for item in activities]
                title = "抵达与轻松适应"
                if req.days == 1 and arrival is not None and 0 <= arrival <= 15 * 60:
                    stop = next((place for place in ordered if not closed_on(place, current)), None)
                    if stop:
                        stops = [stop]
                        title = "当日往返"
                        activities = [
                            transport_activity,
                            "先核对返程班次，再根据剩余时间安排游玩",
                            f"游玩候选 · [{markdown(stop['name'])}]({stop['source_url']})（开放时间与接驳待核对）",
                            f"当天返回{req.origin}，具体班次待确认",
                        ]
            elif index == req.days - 1:
                departure_step = "退房并前往交通枢纽" if usable_hotels else "按实际住宿和返程班次安排取行李与接驳"
                activities = ["返程时间确认后，如有空档再安排活动", departure_step, f"返回{req.origin}"]
                title = "从容返程"
            else:
                stops = [place for place in ordered if not closed_on(place, current)][:2]
                ordered = [place for place in ordered if place not in stops]
                activities=([f"09:30 · {stops[0]['name']}（建议停留约2小时，开放时间待核验）",'12:00 · 午餐与休息'] if stops else ['上午 · 自由活动，尚无符合条件的地点候选','午间 · 餐饮与休息'])
                if len(stops)>1:
                    second=stops[1]
                    checks=[{'status':'unavailable','from':stops[0]['name'],'to':second['name']}]
                    if amap:
                        try:
                            seconds, meters = await route_metrics(
                                amap, f"{stops[0]['lng']},{stops[0]['lat']}", f"{stops[1]['lng']},{stops[1]['lat']}", timeout=6,
                            )
                            minutes=round(seconds/60)
                            checks=[{'mode':'walking','minutes':minutes,'distance_m':meters,'source':'AMap','from':stops[0]['name'],'to':stops[1]['name']}]
                            if seconds<=walk_limit * 60:
                                activities.append(f'地点间步行路线约{minutes}分钟')
                                activities.append(f"14:00 · {second['name']}（建议停留约2小时，开放时间待核验）")
                            else:
                                stops=stops[:1]
                                activities.append(f"备选 · {second['name']}：步行约{minutes}分钟，超过本次步行上限，需另查接驳")
                        except Exception:
                            checks=[{'status':'unavailable','from':stops[0]['name'],'to':stops[1]['name']}]
                    if any(check.get('status')=='unavailable' for check in checks):
                        stops=stops[:1]
                        activities.append(f"备选 · {second['name']}：路程尚未核验，确认交通后再决定是否替换上午地点；不固定第二地点时间")
                activities.append('晚间 · 自由活动与休息')
                title = f"{req.destination}主题探索"
            plans.append(
                DayPlan(
                    day=index + 1,
                    date=current,
                    title=title,
                    activities=activities,
                    stops=stops,
                    route_checks=checks,
                    notes=[
                        "候选景点包含演示数据，预订前必须复核"
                        if research_is_mock
                        else ("地点候选来自查询；时间安排为建议，开放状态、票价和库存仍需复核" if stops else "当前仅为日程框架，具体地点及交通住宿仍待补充")
                    ],
                )
            )
        if amap and hasattr(amap,'search_poi') and any(word in food_preferences.lower() for word in ['美食','吃','素食','food','vegetarian','vegan']):
            def suitable_meal(meal, day):
                return (not meal.is_mock and safe_url(meal.source_url)
                        and urlsplit(meal.source_url).hostname == 'uri.amap.com'
                        and not any(word in meal.name for word in banned)
                        and not closed_on({'opening_hours': meal.opening_hours}, day.date)
                        and (not diet or diet.lower() in (meal.name + ' ' + meal.value).lower()))

            async def add_meal(day, nearby_meals=None):
                anchor=day.stops[0]
                try:
                    candidates = nearby_meals if nearby_meals is not None else await asyncio.wait_for(
                        amap.search_poi(diet or '',req.destination,max_results=8,types='050000',location=(anchor['lng'],anchor['lat'])),
                        timeout=6,
                    )
                    eligible = [meal for meal in candidates if suitable_meal(meal, day)]
                    for meal in eligible[:3]:
                        try:
                            coordinates = amap_position(meal.source_url)
                            if not coordinates:
                                continue
                            point = ','.join(map(str, coordinates))
                            endpoints = [(anchor['name'], f"{anchor['lng']},{anchor['lat']}", meal.name, point)]
                            if len(day.stops) > 1:
                                end = day.stops[1]
                                endpoints.append((meal.name, point, end['name'], f"{end['lng']},{end['lat']}"))
                            legs = []
                            for from_name, start, to_name, finish in endpoints:
                                seconds, meters = await route_metrics(amap, start, finish)
                                if seconds > meal_walk_limit * 60:
                                    break
                                legs.append({'mode':'walking','minutes':round(seconds / 60),'distance_m':meters,
                                             'source':'AMap','from':from_name,'to':to_name})
                        except Exception:
                            continue
                        if len(legs) != len(endpoints):
                            continue
                        position=next((i for i,item in enumerate(day.activities) if '午餐与休息' in item),None)
                        if position is not None:
                            address = meal.address or meal.value
                            day.activities[position]=f"用餐候选 · [{markdown(meal.name)}]({meal.source_url})（{address}，从上午地点步行约{legs[0]['minutes']}分钟，菜单、价格与营业时间待确认）"
                        if len(legs) == 2:
                            day.activities = [
                                f"午餐后步行约{legs[1]['minutes']}分钟到{legs[1]['to']}"
                                if activity.startswith('地点间步行路线约') else activity
                                for activity in day.activities
                            ]
                            day.route_checks = [check for check in day.route_checks
                                                if (check.get('from'), check.get('to')) != (legs[0]['from'], legs[1]['to'])]
                        day.route_checks.extend(legs)
                        day.notes.append(f'餐厅地点资料：{meal.value}；来源：{meal.source_url}')
                        return True
                    day.activities = [
                        '午餐待定 · 暂未查到同时符合饮食条件和步行要求的餐厅'
                        if '午餐与休息' in activity else activity for activity in day.activities
                    ]
                except Exception:
                    day.notes.append('当天地点周边餐厅暂未查询成功。')
                    day.activities = [
                        '午餐待定 · 周边餐厅暂未查询成功' if '午餐与休息' in activity else activity
                        for activity in day.activities
                    ]
                return False

            visit_days = [day for day in plans if day.stops and any('午餐与休息' in activity for activity in day.activities)][:3]
            meal_matches = await asyncio.gather(*(add_meal(day) for day in visit_days))
            if diet and limits:
                used = {stop['source_url'] for day in plans for stop in day.stops}
                loop = asyncio.get_running_loop()
                deadline = loop.time() + 12

                async def trial_day(day, stop, meals=None):
                    trial = DayPlan(day=day.day, date=day.date, title=day.title, stops=[stop],
                                    activities=[f"09:30 · {stop['name']}（开放时间待核验）",
                                                "12:00 · 午餐与休息", "晚间 · 自由活动与休息"])
                    if await add_meal(trial, meals):
                        trial.notes[:0] = ['按饮食需求和步行上限重新选了游玩地点。', *day.notes]
                        return trial

                async def from_restaurants(day):
                    meals = await amap.search_poi(diet, req.destination, max_results=10, types='050000')

                    async def nearby(meal):
                        if not (coordinates := amap_position(meal.source_url)):
                            return None
                        venues = await amap.search_poi('博物馆|美术馆|科技馆|展览馆|纪念馆', req.destination,
                                                       max_results=4, types='140000', location=coordinates)
                        for venue in venues:
                            if venue.source_url in used or not indoor_venue(venue.name):
                                continue
                            if (stop := visit_stop(venue)) and not closed_on(stop, day.date):
                                if trial := await trial_day(day, stop, [meal]):
                                    return trial

                    eligible = [meal for meal in meals if suitable_meal(meal, day)]
                    candidates = await asyncio.gather(*(nearby(meal) for meal in eligible[:4]), return_exceptions=True)
                    return next((trial for trial in candidates if isinstance(trial, DayPlan)), None)

                # A walkable meal can be the harder constraint. Try a different
                # venue without consuming a stop already assigned to another day.
                for day, found in zip(visit_days, meal_matches):
                    if found or len(day.stops) != 1:
                        continue
                    alternatives = [place for place in places_for_meals
                                    if place['source_url'] not in used and not closed_on(place, day.date)]
                    async def find_replacement():
                        pending = {
                            asyncio.create_task(job)
                            for job in [*(trial_day(day, stop) for stop in alternatives[:2]), from_restaurants(day)]
                        }
                        try:
                            while pending:
                                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                                results = await asyncio.gather(*done, return_exceptions=True)
                                if match := next((item for item in results if isinstance(item, DayPlan)), None):
                                    return match
                        finally:
                            for task in pending:
                                task.cancel()
                            await asyncio.gather(*pending, return_exceptions=True)

                    try:
                        trial = await asyncio.wait_for(find_replacement(), timeout=max(0, deadline - loop.time()))
                    except Exception:
                        continue
                    if trial:
                        plans[day.day - 1] = trial
                        used.discard(day.stops[0]['source_url'])
                        used.add(trial.stops[0]['source_url'])
        async def hotel_to_first_stop(day):
            stop = day.stops[0]
            target = f"{stop['lng']},{stop['lat']}"

            def leave_times_flexible(label):
                day.activities[1] = re.sub(r'^\d{2}:\d{2} · ', label + ' · ', day.activities[1])
                for index in range(2, len(day.activities)):
                    day.activities[index] = re.sub(r'^\d{2}:\d{2} · ', '', day.activities[index])

            async def compare(hotel):
                location = hotel.map_location
                coordinates = amap_position(location.source_url) if location else None
                if hotel.is_mock or not coordinates:
                    return None
                start = ','.join(map(str, coordinates))
                try:
                    seconds, meters = await route_metrics(amap, start, target)
                except Exception:
                    return None
                return seconds, meters, hotel, start

            results = await asyncio.gather(*(compare(hotel) for hotel in usable_hotels[:2]))
            routes = [result for result in results if result is not None]
            if routes:
                seconds, meters, hotel, start = min(routes, key=lambda item: item[:2])
                minutes = round(seconds / 60)
                within_limit = seconds <= walk_limit * 60
                message = f"若住「{hotel.name}」，到{stop['name']}步行约{minutes}分钟（{meters / 1000:.2f}公里）"
                if not within_limit:
                    message += "，超过步行上限"
                    try:
                        drive_seconds, _ = await route_metrics(amap, start, target, mode="driving")
                        message += f"。可考虑打车，地图估算车程约{round(drive_seconds / 60)}分钟，上下车点及步行距离待核对"
                    except Exception:
                        message += "，出发前需确认接驳"
                day.activities.insert(0, message + "。")
                day.route_checks.append({'mode': 'walking', 'minutes': minutes, 'distance_m': meters,
                                         'source': 'AMap', 'from': hotel.name, 'to': stop['name'],
                                         'status': 'conditional' if within_limit else 'over_limit'})
                if not within_limit:
                    leave_times_flexible("接驳确认后")
                return
            day.activities.insert(0, f"确认住宿分店和到{stop['name']}的交通后，再确定出门时间。")
            leave_times_flexible("出门时间待定")
            day.route_checks.append({'status': 'unavailable', 'from': '住宿', 'to': stop['name']})

        if req.days > 1:
            visit_days = [day for day in plans if day.stops]
            for day in visit_days[3:]:
                day.notes.append('住宿到当天首站的交通待确认。')
            await asyncio.gather(*(hotel_to_first_stop(day) for day in visit_days[:3]))
        return {"itinerary": plans}

