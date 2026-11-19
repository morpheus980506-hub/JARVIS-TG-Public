from typing import Any
import re

from app.schemas.domain import VerificationIssue, VerificationReport, VerificationStatus


class VerifierAgent:
    agent_id = "verifier"
    name = "Verifier Agent"

    async def verify(self, state: dict[str, Any]) -> VerificationReport:
        req = state["requirement"]
        issues: list[VerificationIssue] = []
        if len(state.get("itinerary", [])) != req.days:
            issues.append(VerificationIssue(code="DAY_COUNT", status=VerificationStatus.FAIL, message="行程天数与需求不一致"))
        if state.get("total_cost_cny", 0) > req.budget_cny:
            issues.append(VerificationIssue(code="BUDGET", status=VerificationStatus.FAIL, message="预计费用超过总预算"))
        else:
            issues.append(VerificationIssue(code="BUDGET", status=VerificationStatus.PASS, message="确定性预算校验通过"))
        if any(item.is_mock for item in state.get("research", [])):
            issues.append(VerificationIssue(code="MOCK_RESEARCH", status=VerificationStatus.WARNING, message="景点/餐饮候选包含明确标记的模拟数据"))
        if not state.get("weather"):
            issues.append(VerificationIssue(code="WEATHER", status=VerificationStatus.WARNING, message="未获得天气数据"))
        else:
            covered={match.group(0) for fact in state['weather'] if (match:=re.search(r'\d{4}-\d{2}-\d{2}',fact.name))}
            if req.start_date.isoformat() not in covered:
                issues.append(VerificationIssue(code='WEATHER_DATE',status=VerificationStatus.WARNING,message='取得的天气资料尚未覆盖出发日期，不视为旅行当天预报'))
        transport = state.get("transport", [])
        if req.days>1 and (not state.get('hotels') or state.get('hotel_mode') in {'mock','unavailable','partial','pending_route'}):
            message = ('已有可定位的酒店候选，仍需核对住宿条件与对应日期的房价或房态'
                       if any(hotel.pending_checks for hotel in state.get('hotels', []))
                       else '住宿缺少可用真实候选，不能据此确认房态或费用')
            issues.append(VerificationIssue(code='HOTEL',status=VerificationStatus.WARNING,message=message))
        for day in state.get('itinerary',[]):
            if any('午餐待定' in activity for activity in day.activities):
                issues.append(VerificationIssue(code=f'MEAL_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天还需要确认符合饮食和步行要求的午餐'))
            if day.stops:
                issues.append(VerificationIssue(code=f'OPENING_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天候选地点的营业和预约时间仍需核验'))
            if any(check.get('status')=='unavailable' for check in day.route_checks):
                issues.append(VerificationIssue(code=f'ROUTE_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天路段暂未核对成功'))
            if len(day.stops)>1 and not day.route_checks:
                issues.append(VerificationIssue(code=f'ROUTE_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天路线未取得核验结果'))
            if any(check.get('status') == 'over_limit' or check.get('minutes',0)>45 and check.get('mode')=='walking' for check in day.route_checks):
                issues.append(VerificationIssue(code=f'WALK_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天步行较长，建议减少地点或改乘交通'))
            if any(check.get('mode')=='driving' and check.get('hours',0)>6 for check in day.route_checks):
                issues.append(VerificationIssue(code=f'DRIVE_DAY_{day.day}',status=VerificationStatus.WARNING,message=f'第{day.day}天纯驾驶超过6小时，建议调整行程'))
        if not transport and state.get('transport_mode')!='not_required':
            issues.append(
                VerificationIssue(
                    code="TRANSPORT",
                    status=VerificationStatus.WARNING,
                    message="未获得城际交通候选",
                )
            )
        elif any(item.is_mock for item in transport):
            issues.append(
                VerificationIssue(
                    code="MOCK_TRANSPORT",
                    status=VerificationStatus.WARNING,
                    message="交通候选包含明确标记的模拟数据",
                )
            )
        elif transport:
            issues.append(
                VerificationIssue(
                    code="TRANSPORT",
                    status=VerificationStatus.PASS,
                    message="已获得合规供应商的实时交通候选",
                )
            )
        if any(issue.status == VerificationStatus.FAIL for issue in issues):
            status = VerificationStatus.FAIL
        elif any(issue.status == VerificationStatus.WARNING for issue in issues):
            status = VerificationStatus.WARNING
        else:
            status = VerificationStatus.PASS
        return VerificationReport(status=status, issues=issues)

