"""Separate a user's committed edits from questions, quotations and trip controls."""
import re
import unicodedata

FIELDS = {'origin', 'destination', 'start_date', 'days', 'travelers', 'budget_cny'}
MAX_REVISIONS = 20


def normalized_input(value: str) -> str:
    value = unicodedata.normalize('NFKC', value)
    value = re.sub(r'(?<=\d)于(?=月\d)', '', value)
    # Protect thousands separators before splitting independent clauses.
    value = re.sub(r'(?<=\d),(?=\d{3}(?:\D|$))', '', value)
    value = re.sub(r'[“「『]([^”」』]*)[”」』]',
        lambda match: '' if re.search(r'取消|重新开始|改去|改成|从.*(?:到|去)|行程',match.group(1)) else match.group(1),value)
    # "不是5000，是8000" is a correction, not two new facts.
    value = re.sub(r'(?:不是|别改成|不要改成|不改成)[^,，;；。]+[,，;；]\s*(?:而?是|还是)?', '', value)
    return value


def trip_control(value: str) -> str | None:
    value=normalized_input(value)
    if re.search(r'(?:不要|别|不想)(?:取消|重新开始|清空|忘掉)|do not cancel|don.t cancel|假如|如果|what if',value,re.I):return None
    if re.search(r'(?:之前|原来|原有).*(?:条件|需求).*(?:作废|清空)|(?:清空|忘掉|忘记).*(?:条件|需求)|重新开始|start over|reset (?:this |the )?trip', value, re.I):
        return 'reset'
    if re.search(r'(?:这趟|本次|这次).*(?:旅行|行程).*(?:取消)|取消(?:这趟|这次|本次|我的|这个)?(?:旅行|行程)|别再规划|cancel (?:this |the |my )?trip|^不去了', value, re.I):
        return 'cancelled'
    if re.search(r'继续(?:这趟|这次|本次)?(?:旅行|行程|规划)|恢复(?:旅行|行程|规划)|resume (?:this |the )?trip', value, re.I):
        return 'active'
    return None


def protected_fields(value: str) -> set[str]:
    """A question may mention dates/prices without authorizing edits to them."""
    if re.search(r'先(?:别|不)改(?!预算|日期|出发日期|人数|天数|出发地|目的地)|不要改(?:我的|这趟|本次)?行程|行程(?:先)?不改|条件都不变|所有条件不变|先别改这趟|(?:另一|另外一)趟', value):
        return set(FIELDS)
    fields = set()
    markers = {'origin':'出发地', 'destination':'目的地', 'start_date':'(?:出发日期|日期)',
               'days':'天数', 'travelers':'人数', 'budget_cny':'(?:旅游|旅行|总)?预算'}
    for field, marker in markers.items():
        if re.search(marker+r'(?:先)?(?:不变|不改|保持)|(?:先)?(?:别|不要|不)改'+marker,value):
            fields.add(field)
    if re.search(r'do not change|don.t change', value, re.I):
        for clause in split_clauses(value):
            if not re.search(r'do not change|don.t change',clause,re.I):continue
            for field, marker in {'origin':'origin|departure', 'destination':'destination', 'start_date':'date', 'days':'days|duration', 'travelers':'travelers|people', 'budget_cny':'budget'}.items():
                if re.search(marker, clause, re.I):fields.add(field)
    return fields


def split_clauses(value: str) -> list[str]:
    # Dots within numbers/dates belong to the number, not sentence boundaries.
    return [part.strip() for part in re.split(r'[,，。;；\n]|(?<!\d)\.|\.(?!\d)', value) if part.strip()]


def uncommitted_cost_question(value: str) -> bool:
    return len(protected_fields(value))==6 and bool(re.search(r'更贵|便宜|花费|贵不贵|expensive|cheaper|cost',value,re.I))


def undo_requested(value: str) -> bool:
    return bool(re.search(r'撤销(?:刚才|上次|最近|这次)?的?修改|取消刚才的修改|恢复原来的条件|undo (?:the )?(?:last )?(?:change|edit)',normalized_input(value),re.I))


def itinerary_edit(value: str) -> bool:
    return bool(re.search(r'改|换|调整|change|revise|replace',value,re.I) and re.search(r'第.*天|\bD\d|行程|安排|活动|itinerary|activities|day \d',value,re.I)) and not bool(
        re.search(r'天数|人数|总预算|出发日期|目的地|出发地',value))


def control_remainder(value: str) -> str:
    return '，'.join(clause for clause in split_clauses(value) if trip_control(clause) not in {'reset','cancelled','active'})


def service_only(value: str) -> bool:
    return bool(re.search(r'酒店|入住|退房|餐厅|饭店|打车|叫车|hotel|check.in|check.out|restaurant|taxi',value,re.I)) and not bool(
        re.search(r'从.+(?:去|到)|旅行|旅游|行程|出发|人数|天数|总预算|日期.*改|\btrip\b',value,re.I))


def supplier_prompt(value: str) -> bool:
    if re.search(r'去哪个城市|哪个城市或目的地|which city would you like to visit',value,re.I):return False
    return len(value)<350 and not bool(re.search(r'(?m)^\s*(?:#{1,4}|D\d|第.*天)',value)) and bool(
        re.search(r'入住|退房|你想查哪个城市|上车|下车|pickup|drop.off|check.in|check.out|which city.*search',value,re.I))


def supplier_request(value: str) -> bool:
    return bool(re.search(r'酒店|宾馆|民宿|美团|飞猪|滴滴|打车|叫车|门票|hotel|taxi|didi|fliggy|meituan',value,re.I) and
                re.search(r'查|找|搜|推荐|价格|多少钱|费用|预订|订|search|find|book|recommend|fare|price',value,re.I) and not
                re.search(r'区域|标准|怎么选|如何选|接口|API|MCP|接入|配置|绑定|怎么用|how to choose|area to stay',value,re.I))


def rail_request(value: str) -> bool:
    return bool(
        re.search(r'高铁|动车|火车|铁路|车次|列车|12306|\btrains?\b|\brail\b', value, re.I)
        and re.search(r'查|找|搜|有哪|有吗|有没有|余票|票价|几趟|看看|买票|订票|到.+(?:的高铁|高铁|火车)|\bfind\b|\bsearch\b|\bfrom\b|\btickets?\b', value, re.I)
        and not re.search(r'不查|不用查|不要查|先不查|别查|取消.*查|stop searching|怎么(?:改签|退票|用)|how to (?:refund|change)|接口|MCP|API', value, re.I)
        and not re.search(r'安排行程|规划行程|完整行程|每天怎么|plan (?:a|the|my) trip', value, re.I)
    )


RAIL_DATE_UNSET = r'(?:出发)?日期(?:先)?(?:没定|未定|不定|不确定|待定)|date (?:is )?(?:undecided|not set)'
RAIL_SWAP = r'(?:那)?(?:反过来|对调起终点|交换起终点)(?:呢|吧)?|reverse (?:the )?route'
RAIL_CANCEL = r'(?:先)?(?:不查了|不用查了|取消查询|停止查询)|stop searching|cancel (?:the )?search'


def rail_followup(previous: str, value: str) -> bool:
    if not previous.startswith(("**铁路查询**", "**Rail search**")):
        return False
    if rail_request(value):
        return True
    phrase = value.strip().rstrip('？?。！!').strip()
    if re.fullmatch(rf'(?:{RAIL_DATE_UNSET}|{RAIL_SWAP}|{RAIL_CANCEL})', phrase, re.I):
        return True
    if re.fullmatch(
        r'(?:出发地|起点|目的地|终点|到达地)(?:改成|改为|换成|是|为|[:：])\s*[\u4e00-\u9fffA-Za-z ·-]{2,24}',
        phrase,
    ):
        return True
    return bool(re.fullmatch(
        r'(?:那|改(?:成|为|查)|日期改(?:成|为))?\s*(?:今天|明天|后天|大后天|今日|明日|'
        r'(?:\d{4}[年./-])?\d{1,2}[月./-]\d{1,2}[日号]?|today|tomorrow|the day after tomorrow|'
        r'重试|重新查|再查一次|retry)(?:呢|吧)?[？?。！!\s]*',
        value.strip(), re.I,
    ) or re.fullmatch(r'(?:从)?[\u4e00-\u9fff]{2,12}(?:到|去|往)[\u4e00-\u9fff]{2,12}[？?。\s]*', value.strip()))


def active_epoch(messages):
    if not any(message.role=='user' and trip_control(message.content)=='reset' for message in messages):return messages
    # Resolve the epoch with the same bounded undo semantics as durable trip facts.
    from app.agents.intake import _ordered_slots
    start=_ordered_slots(messages)[0]['_epoch_start']
    return messages[start:]
