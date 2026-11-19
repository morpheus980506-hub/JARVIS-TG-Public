from app.agents.intake import _city_answer,collect_trip_intake,format_trip_memory


def test_travel_mode_cannot_become_a_destination():
    assert _city_answer('骑自行车') is None
    assert _city_answer('我在兰州新区') == '兰州新区'
    from app.schemas.domain import ChatMessage
    result = collect_trip_intake([ChatMessage(role='user', content='我在兰州新区到骑自行车，明天出发，1天，1人，总预算100元。')])
    assert not result.ready and not result.trip_request
    assert result.collected.get('destination') is None
    assert result.collected.get('origin') == '兰州新区'
from app.agents.planner import PlannerAgent
from app.schemas.domain import ChatMessage,TripRequest
import pytest


@pytest.mark.parametrize('name',['那曲','从化','阿坝','巴马','北京大兴','上海虹桥','哈尔滨市','乌鲁木齐','New York'])
def test_place_cleanup_does_not_trim_actual_place_names(name):
    assert _city_answer(name)==name


@pytest.mark.parametrize('answer',['不知道','你来推荐吧','哈尔滨或者长春吧','还没想好','不想去哈尔滨','你决定吧'])
def test_undecided_short_answers_do_not_become_places(answer):
    assert _city_answer(answer) is None


@pytest.mark.parametrize('change',['改去哈尔滨吧','目的地改为哈尔滨呗','那就去哈尔滨呀'])
def test_destination_edits_and_restored_memory_strip_particles(change):
    messages=[ChatMessage(role='user',content='从温州去沈阳玩，2099-12-01出发，3天，1人，预算10000元，希望美食'),ChatMessage(role='user',content=change)]
    response=collect_trip_intake(messages)
    assert response.ready and response.trip_request.destination=='哈尔滨'
    assert response.trip_request.origin=='温州'
    facts,_=format_trip_memory(messages)
    assert facts['destination']=='哈尔滨'


@pytest.mark.asyncio
async def test_old_generate_button_payload_is_normalized_before_city_queries():
    state=await PlannerAgent().execute({'request':TripRequest(text='旅行',origin='温州吧',destination='哈尔滨吧',start_date='2099-12-01',days=3,budget_cny=10000)})
    assert state['requirement'].origin=='温州'
    assert state['requirement'].destination=='哈尔滨'
