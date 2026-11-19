"""Regression tests from user questions, including new variants beyond the audit."""
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.agents.intake import collect_trip_intake, format_trip_memory
from app.api.routes import build_router
from app.database.db import Base
from app.schemas.domain import ChatMessage
from tests.manual_unexpected_audit import BASE, CASES


def history(text):
    return [ChatMessage(role='user',content=BASE),ChatMessage(role='assistant',content='需求已记录。'),ChatMessage(role='user',content=text)]


@pytest.mark.parametrize('name,text,field,expected',CASES,ids=[case[0] for case in CASES])
def test_nonstandard_user_edits(name,text,field,expected):
    result=collect_trip_intake(history(text),requirements_only=True)
    if field=='budget_scope':
        assert not result.ready or any('机票' in item for item in result.collected['hard_constraints'])
    elif field=='preference_removed':
        assert expected not in result.collected['preferences']
    else:
        actual=result.ready if field=='ready' else result.collected.get(field)
        assert actual==expected
    if result.ready:
        assert result.trip_request is not None
        for key in ['origin','destination','start_date','days','travelers','budget_cny']:
            assert str(getattr(result.trip_request,key))==str(result.collected[key])


@pytest.mark.parametrize('text,key,expected',[
    ('先别改日期，12月9日会不会下雪？','start_date','2026-12-01'),
    ('朋友说“取消这趟旅行”，我没有同意','planning_status','active'),
    ('不要取消行程','planning_status','active'),
    ('如果取消旅行会怎么样？','planning_status','active'),
    ('目的地改去呼和浩特','destination','呼和浩特'),
    ('改去和田','destination','和田'),
    ('从温州去杭州，日期改成2026-12-09','destination','杭州'),
    ('2个成人和2个孩子','travelers',4),
    ('总预算改成25,000.50元','budget_cny',25000.50),
    ('人均预算3k元','budget_cny',6000),
    ('天数改成-3天','days',None),
    ('预算是€500欧元','budget_cny',None),
    ('改去“成都”','destination','成都'),
    ('总预算改成“8000元”','budget_cny',8000),
    ('把出发地改成杭州，目的地改成苏州','origin','杭州'),
    ('不是从温州，改成从杭州出发','destination','哈尔滨'),
    ('改成4天，不是5天','days',4),
])
def test_unseen_variants(text,key,expected):
    assert collect_trip_intake(history(text),requirements_only=True).collected[key]==expected


def test_cancel_survives_greeting_and_resume_keeps_history_without_resetting():
    messages=history('取消这趟旅行')
    messages.append(ChatMessage(role='user',content='你好'))
    paused=collect_trip_intake(messages,requirements_only=True)
    assert not paused.ready and paused.collected['planning_status']=='cancelled'
    messages.append(ChatMessage(role='user',content='恢复行程规划'))
    assert collect_trip_intake(messages).ready
    assert collect_trip_intake(messages).trip_request.destination=='哈尔滨'


def test_reset_followed_by_new_trip_does_not_reuse_old_conditions_or_planner_text():
    messages=history('之前的条件都作废，我们重新开始')
    messages.append(ChatMessage(role='user',content='从杭州去苏州，2026-12-10出发，2天，1人，预算2000元，希望园林'))
    result=collect_trip_intake(messages)
    assert result.ready and result.trip_request.destination=='苏州'
    assert '哈尔滨' not in result.trip_request.text and '10000' not in result.trip_request.text


def test_editing_a_paused_trip_does_not_resume_planning_without_resume_instruction():
    messages=history('取消这趟旅行')+[ChatMessage(role='user',content='预算改成5000元')]
    result=collect_trip_intake(messages)
    assert not result.ready and result.collected['budget_cny']==5000
    result=collect_trip_intake(messages+[ChatMessage(role='user',content='恢复行程规划')])
    assert result.ready and result.trip_request.budget_cny==5000


def test_repeated_summary_questions_do_not_modify_confirmed_facts():
    messages=history('现在到底是什么条件？')
    messages.append(ChatMessage(role='user',content='你再说一次出发地和目的地'))
    facts,_=format_trip_memory(messages)
    assert facts['origin']=='温州' and facts['destination']=='哈尔滨'


def test_uncommitted_price_comparison_does_not_invent_relative_fares():
    result=collect_trip_intake(history('如果改去成都会不会更贵？先别改'))
    assert result.ready and result.trip_request.destination=='哈尔滨'
    assert '不能确定哪个更贵' in result.reply and '报价' in result.reply


@pytest.mark.parametrize('value,expected',[('3人，总预算不变',4000),('3人，人均预算不变',6000)])
def test_group_total_and_per_person_amount_have_distinct_keep_semantics(value,expected):
    messages=history('人均预算2000元')+[ChatMessage(role='user',content=value)]
    assert collect_trip_intake(messages).trip_request.budget_cny==expected


@pytest.mark.parametrize('value',['人数改成2.5人','人数改成-3人','改成2.5天','天数改成-5天'])
def test_invalid_counts_do_not_also_corrupt_departure_dates(value):
    result=collect_trip_intake(history(value))
    assert not result.ready and result.collected['start_date']=='2026-12-01'


@pytest.mark.asyncio
async def test_reply_request_and_restored_state_agree_after_summary_cancel_reset(monkeypatch):
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr('app.api.routes.SessionLocal',sessions)
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    app=FastAPI();app.include_router(build_router(SimpleNamespace()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        id=(await client.post('/api/v1/conversations',json={})).json()['id']
        for text in [BASE,'行，那你说说现在到底是什么条件？','这趟旅行取消了，别再规划了','恢复行程规划','之前的条件都作废，我们重新开始']:
            detail=(await client.get('/api/v1/conversations/'+id)).json()
            response=await client.post('/api/v1/trips/intake',json={'conversation_id':id,'messages':detail['messages']+[{'role':'user','content':text}]})
            assert response.status_code==200
            reply=response.json()
            restored=(await client.get('/api/v1/conversations/'+id)).json()
            assert reply['ready']==restored['ready']
            assert reply['trip_request']==restored['trip_request']
            if reply['ready']:
                assert reply['trip_request']['origin']=='温州' and reply['trip_request']['destination']=='哈尔滨'
                assert '温州' in reply['reply'] and '哈尔滨' in reply['reply']
            else:assert reply['trip_request'] is None
        assert not restored['ready'] and reply['collected']['destination'] is None
    await engine.dispose()
