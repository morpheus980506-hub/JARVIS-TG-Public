from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agents.hotel import HotelAgent
from app.agents.itinerary import ItineraryAgent
from app.agents.intake import collect_trip_intake
from app.schemas.domain import ChatMessage, HotelOption, Requirement, SourceFact


def requirement(*constraints):
    return Requirement(origin="杭州", destination="哈尔滨", start_date=date(2099, 11, 18),
                       days=3, travelers=2, budget_cny=5000, hard_constraints=list(constraints))


def test_chat_passes_recommendation_constraints_without_overwriting_total_budget():
    result = collect_trip_intake([ChatMessage(role="user", content=
        "从杭州去哈尔滨玩，明天出发，3天，2人，总预算5000元，吃素，只玩室内，步行不超过10分钟，每晚最多350元，要有电梯")])
    request = result.trip_request
    assert request and request.budget_cny == 5000
    assert {"素食", "只玩室内", "每晚最多350元", "要有电梯"} <= set(request.hard_constraints)


@pytest.mark.asyncio
async def test_hotel_fit_filters_vouchers_unqualified_quotes_and_missing_facilities():
    def offer(title, price, *tags):
        return dict(candidate_id=title, title=title, price_text=price, tags=tags, url="https://router.feizhu.com/test")

    query = AsyncMock(return_value={"provider": "fliggy", "items": [
        offer("哈尔滨全国通兑房券", "每晚200元", "有电梯"),
        offer("哈尔滨昂贵酒店", "每晚810元", "有电梯"),
        offer("哈尔滨起价酒店", "每晚200元起", "有电梯"),
        offer("哈尔滨不明计价酒店", "180", "有电梯"),
        offer("哈尔滨无设施资料酒店", "每晚220元"),
        offer("哈尔滨楼梯酒店", "每晚180元", "没有电梯"),
        offer("哈尔滨合适酒店", "每晚300元", "有电梯"),
    ]})
    gateway = SimpleNamespace(
        status=lambda: [dict(id="fliggy", configured=True, client_installed=True)], search=query,
    )
    result = await HotelAgent().execute({"requirement": requirement("每晚酒店不超过350元", "酒店必须有电梯"),
                                         "travel_gateway": gateway})
    assert [hotel.name for hotel in result["hotels"]] == ["哈尔滨合适酒店"]
    assert "350元" in query.call_args.args[2] and "电梯" in query.call_args.args[2]


@pytest.mark.asyncio
async def test_hotel_shows_located_unconfirmed_branch_even_if_another_provider_is_slow(monkeypatch):
    import asyncio
    from app.agents import hotel

    monkeypatch.setattr(hotel, 'CITY_QUERY_TIMEOUT', 1.05)
    branch = SourceFact(name="测试酒店(中心店)", value="测试路12号", address="测试路12号",
                        place_type="100100", source_url="https://uri.amap.com/marker?position=126.62,45.77")

    async def search(provider, city, query):
        if provider == 'meituan':
            await asyncio.Event().wait()
        return {"provider": provider, "items": [
            {"title": name, "candidate_id": name, "price_text": price, "url": "https://router.feizhu.com/test"}
            for name, price in [(branch.name, "180"), ("测试酒店(火车站店)", "180"), ("高价酒店", "每晚380元")]
        ]}

    amap = SimpleNamespace(
        search_poi=AsyncMock(return_value=[branch]),
        route=AsyncMock(),
    )
    gateway = SimpleNamespace(
        status=lambda: [dict(id=p, configured=True, client_installed=True) for p in ('fliggy', 'meituan')],
        search=search,
    )
    state = {"requirement": requirement("每晚最多350元", "要有电梯"), "travel_gateway": gateway,
             "tool_gateway": SimpleNamespace(amap=amap), "research": [
                 SourceFact(name="测试博物馆", value="文化路1号", source_url="https://uri.amap.com/marker?position=126.63,45.77"),
             ]}
    state.update(await HotelAgent().execute(state))
    assert state["hotel_mode"] == "partial"
    assert [item.name for item in state["hotels"]] == [branch.name]
    assert set(state["hotels"][0].pending_checks) == {"电梯", "适用日期的每晚价格"}
    await ItineraryAgent().execute(state)
    amap.route.assert_not_awaited()


@pytest.mark.asyncio
async def test_itinerary_uses_indoor_venue_and_skips_excluded_food_category():
    def place(name, kind, lng):
        return SourceFact(name=name, value="地址：道里区柳树街13号", address="道里区柳树街13号",
                          place_type=kind, source_url=f"https://uri.amap.com/marker?position={lng},45.77")

    square = place("索菲亚广场", "110102", 126.62)
    shop = place("博物馆文创店", "060000", 126.63)
    museum = place("哈尔滨市博物馆", "140100", 126.64)
    bbq = place("素食烧烤", "050000", 126.65)
    lunch = place("素食餐厅", "050000", 126.66)
    amap = SimpleNamespace(search_poi=AsyncMock(return_value=[bbq, lunch]),
                           route=AsyncMock(return_value={"route": {"paths": [{"cost": {"duration": "480"}, "distance": "500"}]}}))
    result = await ItineraryAgent().execute({"requirement": requirement("只玩室内", "吃素食", "不吃烧烤"),
                                            "research": [square, shop, museum],
                                            "tool_gateway": SimpleNamespace(amap=amap)})
    day = result["itinerary"][1]
    assert [(stop["name"], stop["address"]) for stop in day.stops] == [(museum.name, museum.address)]
    assert any(lunch.name in activity for activity in day.activities)
    assert all(bbq.name not in activity for activity in day.activities)
    assert amap.search_poi.call_args.kwargs["location"] == (126.64, 45.77)


@pytest.mark.asyncio
async def test_closure_and_walk_limit_change_actual_schedule():
    def poi(name, lng, hours=None):
        return SourceFact(name=name, value="地址资料", opening_hours=hours,
                          source_url=f"https://uri.amap.com/marker?position={lng},45.77")

    closed = poi("周一闭馆博物馆", 126.61, "周一闭馆，周二至周日09:00-17:00")
    open_candidate = poi("第二家博物馆", 126.62)
    far = poi("素食远店", 126.63)
    near = poi("素食近店", 126.64)

    def path(seconds):
        return {"route": {"paths": [{"cost": {"duration": str(seconds)}, "distance": "800"}]}}

    amap = SimpleNamespace(search_poi=AsyncMock(return_value=[far, near]),
                           route=AsyncMock(side_effect=[path(610), path(420)]))
    req = requirement("只玩室内", "素食", "步行不超过10分钟").model_copy(update={"start_date": date(2026, 11, 15)})
    result = await ItineraryAgent().execute({"requirement": req, "research": [closed, open_candidate],
                                            "tool_gateway": SimpleNamespace(amap=amap)})
    day = result["itinerary"][1]
    assert [stop["name"] for stop in day.stops] == [open_candidate.name]
    assert any(near.name in activity and "7分钟" in activity for activity in day.activities)
    assert all(far.name not in activity for activity in day.activities)
    assert [check["to"] for check in day.route_checks if check.get("mode") == "walking"] == [near.name]


@pytest.mark.asyncio
async def test_itinerary_swaps_museum_to_keep_vegetarian_lunch_within_walk_limit():
    def poi(name, lng):
        return SourceFact(name=name, value="地址资料",
                          source_url=f"https://uri.amap.com/marker?position={lng},45.77")

    first = poi("第一座博物馆", 126.61)
    second = poi("第二座博物馆", 126.62)
    lunch = poi("素食餐厅", 126.63)

    async def route(start, end, *, mode):
        seconds = 480 if start.startswith("126.62,") else 900
        return {"route": {"paths": [{"cost": {"duration": seconds}, "distance": "500"}]}}

    amap = SimpleNamespace(search_poi=AsyncMock(return_value=[lunch]), route=AsyncMock(side_effect=route))
    result = await ItineraryAgent().execute({
        "requirement": requirement("只玩室内", "素食", "步行不超过10分钟"),
        "research": [first, second], "tool_gateway": SimpleNamespace(amap=amap),
    })
    day = result["itinerary"][1]
    assert [stop["name"] for stop in day.stops] == [second.name]
    assert any(lunch.name in activity and "8分钟" in activity for activity in day.activities)
    assert any(check.get("to") == lunch.name and check["from"] == second.name for check in day.route_checks)


@pytest.mark.asyncio
async def test_itinerary_searches_indoors_near_suitable_restaurants():
    def poi(name, lng):
        return SourceFact(name=name, value="地址资料",
                          source_url=f"https://uri.amap.com/marker?position={lng},45.77")

    first = poi("第一座博物馆", 126.61)
    studio = poi("美术馆工作室", 126.615)
    gallery = poi("社区展览馆", 126.62)
    lunch = poi("素食餐厅", 126.63)

    async def search(keywords, city, *, max_results, types, location=None):
        if types == '140000':
            assert location == (126.63, 45.77)
            return [studio, gallery]
        return [] if location else [lunch]

    amap = SimpleNamespace(search_poi=search, route=AsyncMock(return_value={
        "route": {"paths": [{"cost": {"duration": "181"}, "distance": "226"}]},
    }))
    result = await ItineraryAgent().execute({
        "requirement": requirement("只玩室内", "素食", "步行不超过10分钟"),
        "research": [first], "tool_gateway": SimpleNamespace(amap=amap),
    })
    day = result["itinerary"][1]
    assert [stop["name"] for stop in day.stops] == [gallery.name]
    assert any(lunch.name in activity and "3分钟" in activity for activity in day.activities)


@pytest.mark.asyncio
async def test_hotel_commute_requires_a_specific_branch_and_flags_walk_limit():
    branch = SourceFact(name="测试酒店(中心店)", value="测试路12号", address="测试路12号",
                        place_type="100100", source_url="https://uri.amap.com/marker?position=126.62,45.77")
    parking = branch.model_copy(update={"place_type": "150904"})
    nearby_branch = branch.model_copy(update={"name": "测试酒店(火车站店)"})
    amap = SimpleNamespace(
        search_poi=AsyncMock(return_value=[parking, nearby_branch, branch]),
        route=AsyncMock(return_value={"route": {"paths": [{"distance": "1100", "cost": {"duration": "678"}}]}}),
    )
    provider = SimpleNamespace(
        status=lambda: [dict(id="fliggy", configured=True, client_installed=True)],
        search=AsyncMock(return_value={"provider": "fliggy", "items": [
            {"title": branch.name, "candidate_id": "stay", "price_text": "", "url": "https://router.feizhu.com/test"},
        ]}),
    )
    state = {"requirement": requirement("步行不超过10分钟"), "travel_gateway": provider,
             "tool_gateway": SimpleNamespace(amap=amap), "research": [
                 SourceFact(name="测试博物馆", value="文化路1号", source_url="https://uri.amap.com/marker?position=126.63,45.77"),
             ]}
    state.update(await HotelAgent().execute(state))
    assert state["hotels"][0].map_location == branch
    day = (await ItineraryAgent().execute(state))["itinerary"][1]
    assert day.route_checks[-1]["status"] == "over_limit"
    assert "若住" in day.activities[0] and "超过步行上限" in day.activities[0]
    assert day.activities[1].startswith("接驳确认后")
    assert all(not activity[:2].isdigit() for activity in day.activities)
