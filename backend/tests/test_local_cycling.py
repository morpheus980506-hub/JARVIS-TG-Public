from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agents.intake import classify_conversation_mode
from app.agents.local_cycling import cycling_reply
from app.agents.locality_memory import stated_locality
from app.orchestrator.engine import Orchestrator
from app.schemas.domain import ChatMessage, SourceFact


@pytest.mark.parametrize("answer", ["兰州市", "再试一次"])
@pytest.mark.asyncio
async def test_legacy_city_prompt_keeps_pending_route(answer):
    turns = [ChatMessage(role="user", content="我在兰州新区。")]
    turns.extend([
        ChatMessage(role="user", content="再试一次"),
        ChatMessage(role="assistant", content=(
            "兰州范围内「海河街6号→栖霞湖」还是没返回路线数据。你在高德搜「栖霞湖」。"
            if answer == "再试一次" else
            "「海河街6号→栖霞湖」未返回路线数据。请给出栖霞湖所在城市或全称。"
        )),
        ChatMessage(role="user", content=answer),
    ])
    turns.insert(1, ChatMessage(role="assistant", content="正在讨论骑行路线。"))
    lake = SourceFact(name="栖霞湖", value="测试位置",
                      source_url="https://uri.amap.com/marker?position=103.676925,36.473976")
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "甘肃省兰州市皋兰县海河街6号", "location": "103.756927,36.557288"}]),
        search_poi=AsyncMock(return_value=[lake]),
        route=AsyncMock(return_value={"route": {"paths": [{"distance": "16177", "cost": {"duration": "5212"}}]}}),
    )
    assert classify_conversation_mode(turns) == "advisor"
    assert "16.2 公里" in await cycling_reply(amap, turns, None)
    amap.geocode.assert_awaited_once_with("海河街6号", city="兰州市")
    amap.search_poi.assert_awaited_once_with("栖霞湖", "兰州市", max_results=5)


def test_locality_memory_uses_only_user_statements_and_tracks_updates():
    turns = [
        ChatMessage(role="user", content="我在兰州新区，明天想出去玩。"),
        ChatMessage(role="assistant", content="你现在在广州。"),
    ]
    assert stated_locality(turns) == "兰州新区"
    assert stated_locality(turns + [ChatMessage(role="user", content="我现在在西宁市。")]) == "西宁市"
    assert stated_locality(turns + [ChatMessage(role="user", content="我已经离开兰州新区。")]) is None


@pytest.mark.asyncio
async def test_reopened_long_chat_uses_early_locality_for_amap(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.api.routes import build_router
    from app.database.db import Base, ConversationRecord

    database = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(database, expire_on_commit=False)
    monkeypatch.setattr("app.api.routes.SessionLocal", sessions)
    async with database.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    history = [{"role": "user", "content": "我在兰州新区，明天想出去玩。"}]
    for _ in range(18):
        history.extend([{"role": "assistant", "content": "你想怎么玩？"}, {"role": "user", "content": "先看看。"}])
    history.extend([
        {"role": "user", "content": "从海河街6号骑行去栖霞湖。"},
        {"role": "assistant", "content": "「海河街6号→栖霞湖」未返回路线数据。请确认栖霞湖的准确名称或所在城市。"},
    ])
    async with sessions() as session:
        session.add(ConversationRecord(id="reopened", title="骑行", messages=history))
        await session.commit()
    lake = SourceFact(name="栖霞湖", value="测试位置",
                      source_url="https://uri.amap.com/marker?position=103.676925,36.473976")
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "甘肃省兰州市皋兰县海河街6号", "location": "103.756927,36.557288"}]),
        search_poi=AsyncMock(return_value=[lake]),
        route=AsyncMock(return_value={"route": {"paths": [{"distance": "16177", "cost": {"duration": "5212"}}]}}),
    )
    engine = object.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(amap=amap)
    app = FastAPI()
    app.include_router(build_router(engine))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            saved = (await client.get("/api/v1/conversations/reopened")).json()["messages"]
            result = await client.post("/api/v1/trips/intake", json={
                "conversation_id": "reopened", "messages": [*saved, {
                    "role": "user", "content": "兰州，兰州新区", "web_search": False, "deep_thinking": False,
                }],
            })
            assert "16.2 公里" in result.json()["reply"]
            saved_again = (await client.get("/api/v1/conversations/reopened")).json()["messages"]
            resumed = await client.post("/api/v1/trips/intake", json={
                "conversation_id": "reopened", "messages": [*saved_again, {
                    "role": "user", "content": "有这个地点", "web_search": False, "deep_thinking": False,
                }],
            })
            assert "16.2 公里" in resumed.json()["reply"]
        assert amap.geocode.await_count == amap.search_poi.await_count == 2
        assert all(call.kwargs["city"] == "兰州市" for call in amap.geocode.await_args_list)
    finally:
        await database.dispose()


@pytest.mark.parametrize("followup", [None, "你认真的?", "真的吗？", "你帮我查", "那你直接查一下"])
@pytest.mark.asyncio
async def test_distance_challenge_uses_door_address_and_checks_straight_line_and_route(followup):
    turns = [
        ChatMessage(role="user", content="起点是海河街6号"),
        ChatMessage(role="assistant", content="起点是海河街6号，也就是兰州信息科技学院附近。到栖霞湖约4公里，骑行15分钟左右。"),
        ChatMessage(role="user", content="真的只有4公里?"),
    ]
    if followup:
        turns += [
            ChatMessage(role="assistant", content="4公里是估算。按海河街6号到栖霞湖的大致位置估的，请再查骑行里程。"),
            ChatMessage(role="user", content=followup),
        ]
    address = "甘肃省兰州市皋兰县海河街6号"
    campus = SourceFact(name="兰州信息科技学院", value=address, address=address,
                        source_url="https://uri.amap.com/marker?position=103.755559,36.557188")
    lake = campus.model_copy(update={"name": "栖霞湖", "source_url": "https://uri.amap.com/marker?position=103.676925,36.473976"})
    amap = SimpleNamespace(search_poi=AsyncMock(side_effect=[[campus], [lake]]),
                           geocode=AsyncMock(return_value=[{"formatted_address": address, "location": "103.756927,36.557288"}]),
                           route=AsyncMock(return_value={"route": {"paths": [{"distance": "16177", "cost": {"duration": "5212"}}]}}))
    assert classify_conversation_mode(turns) == "advisor"
    reply = await cycling_reply(amap, turns, None)
    assert all(value in reply for value in ("11.7 公里", "16.2 公里", "87 分钟"))
    amap.geocode.assert_awaited_once_with("海河街6号", city="兰州市")


def test_lookup_delegation_does_not_revive_cycling_after_topic_change():
    turns = [
        ChatMessage(role="user", content="我从海河街6号骑行去栖霞湖。"),
        ChatMessage(role="assistant", content="可以核对这条骑行路线。"),
        ChatMessage(role="user", content="明天博物馆开门吗？"),
        ChatMessage(role="assistant", content="你可以查博物馆官网的开放公告。"),
        ChatMessage(role="user", content="你帮我查"),
    ]
    from app.agents.local_cycling import cycling_followup
    assert cycling_followup(turns) is None


@pytest.mark.parametrize("challenge", [False, True])
@pytest.mark.asyncio
async def test_arrival_time_question_checks_named_campus_and_verified_distance(challenge):
    turns = [
        ChatMessage(role="user", content="我骑自行车，速度15~20km/h"),
        ChatMessage(role="assistant", content="明天骑行一日。9:00 从兰州信息科技学院出发，约15分钟到栖霞湖。13:00 城区公园树荫休息。"),
        ChatMessage(role="user", content="15分钟到湖边？"),
    ]
    if challenge:
        turns.extend([ChatMessage(role="assistant", content="是的，按4公里算。"), ChatMessage(role="user", content="真的假的？")])
    campus = SourceFact(name="兰州信息科技学院", value="测试点", address="甘肃省兰州市皋兰县海河街6号",
                        source_url="https://uri.amap.com/marker?position=103.61,36.48")
    lake = campus.model_copy(update={"name": "栖霞湖", "source_url": "https://uri.amap.com/marker?position=103.68,36.50"})
    amap = SimpleNamespace(search_poi=AsyncMock(side_effect=[[campus], [lake]]), geocode=AsyncMock(),
                           route=AsyncMock(return_value={"route": {"paths": [{"distance": "6500", "cost": {"duration": "1800"}}]}}))
    assert classify_conversation_mode(turns) == "advisor"
    reply = await cycling_reply(amap, turns, None)
    assert "15 分钟到不了" in reply and "6.5 公里" in reply
    assert [call.args[0] for call in amap.search_poi.await_args_list] == [campus.name, lake.name]
    assert amap.search_poi.await_args.args[1] == "兰州市"
    amap.geocode.assert_not_called()


@pytest.mark.asyncio
async def test_current_location_retains_shared_address_without_claiming_device_fix():
    engine = object.__new__(Orchestrator)
    turns = messages() + [
        ChatMessage(role="assistant", content="从兰州信息科技学院出发。"),
        ChatMessage(role="user", content="你告诉我，我现在的位置在哪里？"),
    ]
    assert classify_conversation_mode(turns) == "advisor"
    reply = await engine.travel_advice(turns)
    assert "你之前说你在「海河街6号」" in reply
    assert "设备的实时位置" in reply and "自动定位" in reply


def messages(latest="可以。\n我在海河街6号"):
    return [
        ChatMessage(role="user", content="明天想骑自行车出去玩"),
        ChatMessage(role="assistant", content="可以往栖霞湖方向骑。要不要按你住处附近再收窄路线？"),
        ChatMessage(role="user", content=latest),
    ]


@pytest.mark.asyncio
async def test_address_followup_queries_actual_cycling_route_with_web_search_off():
    turns = messages()
    assert classify_conversation_mode(turns) == "advisor"
    park = SourceFact(name="栖霞湖", value="测试地点",
                      source_url="https://uri.amap.com/marker?position=120.2,30.2")
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "示例市海河街6号", "location": "120.1,30.1"}]),
        search_poi=AsyncMock(return_value=[park]),
        route=AsyncMock(side_effect=[
            {"route": {"paths": [{"distance": "3300", "cost": {"duration": "720"}}]}},
            {"route": {"paths": [{"distance": "3600", "cost": {"duration": "840"}}]}},
        ]),
    )
    engine = object.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(amap=amap)
    reply = await engine.travel_advice(turns, use_search=False, chat_options=True,
                                      workspace_context={"requirement": {"destination": "示例市"}})
    amap.geocode.assert_awaited_once_with("海河街6号", city="示例市")
    assert [call.args for call in amap.route.await_args_list] == [
        ("120.1,30.1", "120.2,30.2"), ("120.2,30.2", "120.1,30.1"),
    ]
    assert all(call.kwargs == {"mode": "bicycling", "show_fields": "cost"} for call in amap.route.await_args_list)
    assert "3.3 公里，约 12 分钟" in reply and "3.6 公里，约 14 分钟" in reply


@pytest.mark.asyncio
async def test_cycling_asks_only_for_city_when_context_has_none():
    amap = SimpleNamespace(geocode=AsyncMock())
    reply = await cycling_reply(amap, messages(), None)
    assert "哪个城市或区县" in reply
    amap.geocode.assert_not_called()


@pytest.mark.asyncio
async def test_cycling_resumes_same_address_after_city_answer():
    turns = messages() + [
        ChatMessage(role="assistant", content="「海河街6号」在哪个城市或区县？我可以用这个门牌查骑行路线。"),
        ChatMessage(role="user", content="示例市"),
    ]
    amap = SimpleNamespace(geocode=AsyncMock(return_value=[]))
    assert classify_conversation_mode(turns) == "advisor"
    await cycling_reply(amap, turns, None)
    amap.geocode.assert_awaited_once_with("海河街6号", city="示例市")


@pytest.mark.asyncio
async def test_cycling_does_not_use_geocoder_street_centroid():
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "示例市海河街", "location": "120.1,30.1"}]),
        route=AsyncMock(),
    )
    reply = await cycling_reply(amap, messages(), "示例市")
    assert "未能唯一定位" in reply
    amap.route.assert_not_called()


@pytest.mark.asyncio
async def test_speed_only_review_uses_earlier_address_and_checks_previous_destination():
    turns = messages() + [
        ChatMessage(role="assistant", content="上午往栖霞湖方向骑，下午去公园。实际里程需要查地图。"),
        ChatMessage(role="user", content="我的骑行速度在15~20km/h\n你看一下路线是否合理"),
    ]
    assert classify_conversation_mode(turns) == "advisor"
    park = SourceFact(name="栖霞湖", value="测试地点",
                      source_url="https://uri.amap.com/marker?position=120.2,30.2")
    amap = SimpleNamespace(
        geocode=AsyncMock(return_value=[{"formatted_address": "示例市海河街6号", "location": "120.1,30.1"}]),
        search_poi=AsyncMock(return_value=[park]),
        route=AsyncMock(side_effect=[
            {"route": {"paths": [{"distance": "6000", "cost": {"duration": "2400"}}]}},
            {"route": {"paths": [{"distance": "7000", "cost": {"duration": "2400"}}]}},
        ]),
    )
    engine = object.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(amap=amap)
    reply = await engine.travel_advice(turns, use_search=False, workspace_context={"requirement": {"destination": "示例市"}})
    amap.geocode.assert_awaited_once_with("海河街6号", city="示例市")
    amap.search_poi.assert_awaited_once_with("栖霞湖", "示例市", max_results=5)
    assert "18–24 分钟" in reply and "21–28 分钟" in reply
    assert "13.0 公里，约 39–52 分钟" in reply and "其他停靠点" in reply

    turns += [
        ChatMessage(role="assistant", content="9:30前到栖霞湖，具体里程我无法实时确认。"),
        ChatMessage(role="user", content="为什么会看不到地图?"),
    ]
    amap.route.reset_mock(side_effect=True)
    amap.route.side_effect = [
        {"route": {"paths": [{"distance": str(distance), "cost": {"duration": "2400"}}]}}
        for distance in (6000, 7000)
    ]
    reply = await engine.travel_advice(turns, use_search=False, workspace_context={"requirement": {"destination": "示例市"}})
    assert "可以用高德查" in reply and "13.0 公里，约 39–52 分钟" in reply
    assert amap.route.await_count == 2

    turns += [
        ChatMessage(role="assistant", content="我没有实时地图和定位能力。请用地图 App 验证栖霞湖。"),
        ChatMessage(role="user", content="重试"),
        ChatMessage(role="assistant", content="暂时没有可用的距离。可以重试。"),
        ChatMessage(role="user", content="重试"),
    ]
    assert classify_conversation_mode(turns) == "advisor"
    amap.route.reset_mock(side_effect=True)
    amap.route.side_effect = [
        {"route": {"paths": [{"distance": str(distance), "cost": {"duration": "2400"}}]}}
        for distance in (6000, 7000)
    ]
    reply = await engine.travel_advice(turns, use_search=False, workspace_context={"requirement": {"destination": "示例市"}})
    assert "栖霞湖" in reply and "13.0 公里，约 39–52 分钟" in reply
    assert amap.route.await_count == 2


def test_retry_does_not_revive_a_route_after_an_unrelated_user_message():
    turns = messages() + [
        ChatMessage(role="assistant", content="暂时没有可用的骑行距离。"),
        ChatMessage(role="user", content="今天几点了？"),
        ChatMessage(role="assistant", content="请看设备时间。"),
        ChatMessage(role="user", content="重试"),
    ]
    assert classify_conversation_mode(turns) != "advisor"


@pytest.mark.asyncio
async def test_map_capability_question_reports_configured_service_without_model():
    engine = object.__new__(Orchestrator)
    turns = [ChatMessage(role="user", content="为什么会看不到地图?")]
    assert classify_conversation_mode(turns) == "advisor"
    engine.tool_gateway = SimpleNamespace(amap=object())
    assert "可以用高德查" in await engine.travel_advice(turns)
    engine.tool_gateway.amap = None
    assert "当前没有配置高德路线服务" in await engine.travel_advice(turns)


@pytest.mark.parametrize("question", ["你确定没法用地图?", "真的吗？", "你确定？", "Are you sure you can't access the map?"])
@pytest.mark.asyncio
async def test_challenging_a_stale_map_denial_checks_runtime_state(question):
    engine = object.__new__(Orchestrator)
    engine.tool_gateway = SimpleNamespace(amap=object())
    turns = [
        ChatMessage(role="user", content="可以查附近吗？"),
        ChatMessage(role="assistant", content="我没有地图和定位能力，请用手机地图确认。"),
        ChatMessage(role="user", content=question),
    ]
    assert classify_conversation_mode(turns) == "advisor"
    assert "可以用高德查" in await engine.travel_advice(turns)
