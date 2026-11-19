import re
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from typing import Any, Callable, Literal

from app.agents.planner import parse_people
from app.agents.destination import HAN, PLACE_CHOICES, invalid_route_place, needs_city, normalize_place, place_question
from app.agents.dining import is_dining_request
from app.agents.actionable_advice import wants_actionable_itinerary
from app.agents.activity_intake import CHOICES, activity_brief_needed, activity_questions, answers_brief, update_activity_brief
from app.agents.local_cycling import asks_for_current_location, cycling_followup
from app.agents.locality_memory import stated_locality
from app.agents.map_capability import asks_about_map_access
from app.agents.intake_policy import FIELDS, MAX_REVISIONS, normalized_input, protected_fields, split_clauses, trip_control, uncommitted_cost_question, undo_requested, service_only, itinerary_edit, control_remainder, supplier_prompt, supplier_request, rail_request, rail_followup
from app.schemas.domain import ChatMessage, TripIntakeResponse, TripRequest


FIELD_QUESTIONS = {
    "origin": "你从哪里出发？说个城市名就行，比如杭州。",
    "destination": "你想去哪个城市或目的地？",
    "start_date": "计划哪天出发？请告诉我具体日期，例如 11月20日。",
    "days": "准备旅行几天？",
    "travelers": "一共有几位旅行者？",
    "budget_cny": "这次旅行的总预算大约是多少元？",
    "preferences": "还有哪些偏好或必须遵守的条件？如果没有，回复“没有”即可。",
}
FIELD_QUESTIONS_EN={'origin':'Where are you departing from?','destination':'Which city would you like to visit?','start_date':'What date will you depart?','days':'How many days will you travel?','travelers':'How many travelers are there?','budget_cny':'What is your total budget in CNY?','preferences':'Any preferences or constraints? Say none if there are no extras.'}
EXPLICIT_TRIP_DATE = r'(?<![\d./-])(?:(\d{4}|\d{2}(?=年))[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|号)?(?!\d|\s*(?:天|人|位|元))'


def is_requirement_edit(text):
    return bool(re.search(r'(?:日期|天数|人数|预算|出发地|目的地).*(?:改|换|\d)|改(?:成|到|为|去|.*预算)|不去|不玩|多玩|少玩|再加.*(?:人|朋友)|增加.*(?:天|人)|减少.*(?:天|人)|人均\s*\d|\d+大\d+小|现在\s*\d+\s*人|\b(?:change|revise).*\b(?:date|budget|travelers|days)\b',text,re.I))


def _casual_trip_request(text: str) -> bool:
    return bool(re.search(r'(?:出去|出门|出远门)(?:玩|走走|转转)?', text)
                and re.search(r'排一下|安排|做个计划|帮我规划', text))


def _delegates_choice(text: str) -> bool:
    return bool(re.fullmatch(
        r'都行|都可以|随便|随你|听你的|你(?:来)?(?:定|决定|选|安排)|你看着办|你看着安排|没主意|没想好',
        normalize_place(text),
    ))


def _accepts_proposal(text: str) -> bool:
    return _delegates_choice(text) or normalize_place(text) in {'好', '好的', '行', '可以', '就这样', '就按这个', '就这么定'}


def _relaxation_answer(previous: str, value: str) -> bool:
    return bool(
        re.fullmatch(r'休假|度假|休闲(?:度假)?|放松|休假放松', normalize_place(value))
        and re.search(r'(?:休闲|放松|度假|休假).*还是|还是.*(?:休闲|放松|度假|休假)', previous.partition('网页来源')[0])
    )


def _trip_followup(value: str) -> bool:
    value = normalized_input(value)
    return bool(
        re.search(r'忘了|忘记|刚才.*(?:说过|讲过)|还记得', value)
        or re.search(EXPLICIT_TRIP_DATE, value) and re.search(r'出发|启程|depart', value, re.I)
    )


SHORT_TRIP_DESTINATIONS = {
    "杭州": "绍兴", "上海": "苏州", "北京": "天津", "广州": "佛山",
    "深圳": "惠州", "南京": "扬州", "成都": "都江堰", "重庆": "成都",
    "武汉": "长沙", "西安": "咸阳",
}

SLOT_PROMPT_MARKERS = (
    "从哪里出发",
    "从哪个城市出发",
    "哪个城市",
    "计划哪天出发",
    "旅行几天",
    "几位旅行者",
    "总预算",
    "偏好或必须遵守",
)


def is_driving_conversation(messages: list[ChatMessage]) -> bool:
    for message in reversed(messages):
        if message.role != "user":
            continue
        mentions=list(re.finditer(r"自驾|开车|驾车|\bdriv(?:e|ing)\b|road trip|航班|机票|高铁|坐火车|改.*飞|\bflight\b|\bfly\b",message.content,re.I))
        for mention in reversed(mentions):
            prefix=message.content[max(0,mention.start()-8):mention.start()]
            driving=bool(re.fullmatch(r'自驾|开车|驾车|driv(?:e|ing)|road trip',mention.group(),re.I))
            if re.search(r"不(?:再|要|用|坐|想)?$|not\s+$|don't\s+$",prefix,re.I):
                if driving:return False
                continue
            return driving
    return False


def request_is_driving(request) -> bool:
    return is_driving_conversation([ChatMessage(role='user',content=line) for line in request.text.splitlines() if line.strip()])


def is_flight_query(messages: list[ChatMessage]) -> bool:
    if is_driving_conversation(messages):
        return False
    for message in reversed(messages):
        if message.role != "user":
            continue
        if re.search(r"(?:飞往|飞到|飞).+|航班|机票|\bflight|\bfly\b", message.content, re.I):
            return True
        if re.search(r"规划|行程|旅行计划", message.content):
            return False
    return False


def classify_conversation_mode(
    messages: list[ChatMessage],
) -> Literal["smalltalk", "chat", "advisor", "planning"]:
    latest = next(
        (message.content.strip() for message in reversed(messages) if message.role == "user"),
        "",
    )
    previous_assistant = next(
        (message.content for message in reversed(messages[:-1]) if message.role == "assistant"),
        "",
    )
    if trip_control(latest) or undo_requested(latest):return 'planning'
    if asks_for_current_location(messages) or asks_about_map_access(messages) or cycling_followup(messages):return 'advisor'
    if answers_brief(previous_assistant, latest) or _relaxation_answer(previous_assistant, latest):return 'planning'
    if '「文州」是指温州吗？' in previous_assistant:return 'planning'
    if itinerary_edit(latest):return 'advisor' if _ordered_slots(messages)[0]['_status']=='active' else 'planning'
    if uncommitted_cost_question(latest):return 'planning'
    if re.search(r'现在.*(?:条件|需求)|当前.*(?:条件|需求)|what.*current.*(?:requirements|details)',latest,re.I):return 'planning'
    if len(protected_fields(latest))==6:
        return 'advisor' if re.search(r'[？?]|会不会|是否|怎么样|\bwhat\b',latest,re.I) else 'chat'
    if _trip_followup(latest):
        facts = _ordered_slots(messages)[0]
        if any(place_question(facts[field], field) for field in ('origin', 'destination') if facts[field]):
            return 'planning'
    if is_dining_request(messages):return 'advisor'
    if is_flight_query(messages):return 'advisor'
    if is_requirement_edit(latest) or _casual_trip_request(latest):return 'planning'
    if wants_actionable_itinerary(messages):return 'advisor'
    if is_driving_conversation(messages):
        return "advisor"
    if is_flight_query(messages):
        return "advisor"
    if re.search(r"(?:现在)?几点|现在.*时间|时间.*多少|收到吗|收得到吗|能看到吗|听得到吗", latest) or re.fullmatch(
        r"(?:你好|您好|嗨|hi|hello|早上好|中午好|下午好|晚上好|在吗|在不|在不在|有人吗|喂|忙吗)[？?！!。,.， ]*",
        latest,
        re.IGNORECASE,
    ) or re.fullmatch(r"(?:test|测试|测试一下)[？?！!。,.， ]*", latest, re.IGNORECASE):
        return "smalltalk"
    active_slot = any(marker in previous_assistant for marker in SLOT_PROMPT_MARKERS)
    unrelated_question = bool(
        re.search(r"天气|几点|为什么|怎么样|你是谁|能做什么|最近|推荐|特色|当地|好吃|吃点", latest)
        or re.search(r"[？?]$", latest)
    )
    if active_slot and not unrelated_question:
        return "planning"
    if (any(question.lower() in previous_assistant.lower() for question in FIELD_QUESTIONS_EN.values())
        or previous_assistant.startswith("Which city should I use for your ")) and not unrelated_question:
        return 'planning'
    if re.search(r'\b(?:plan|itinerary)\b.*\b(?:trip|days?|from|to)\b|\b\d+[ -]*day\b.*\btrip\b',latest,re.I):return 'planning'
    if re.search(
        r"从.+(?:去|到).+|(?:帮我|给我).*(?:规划|制定)|(?:预算|出发|旅行)\s*\d|"
        r"\d+\s*(?:天|人|位)|(?:想去|要去)[\u4e00-\u9fff]{2,}|开始.*规划",
        latest,
    ):
        return "planning"
    if re.search(
        r"旅行|旅游|出游|景点|目的地|团建|酒店|机票|火车|高铁|天气|"
        r"值得玩|值得去|哪里好玩|去哪玩|有什么好玩|推荐|度假|行程|"
        r"当地|特色|美食|好吃|吃点|暖和",
        latest,
    ):
        return "advisor"
    return "chat"


def is_travel_advice_request(messages: list[ChatMessage]) -> bool:
    return classify_conversation_mode(messages) == "advisor"


def _answer_after_question(messages: list[ChatMessage], keyword: str) -> str | None:
    for index in range(len(messages) - 1, 0, -1):
        current = messages[index]
        previous = messages[index - 1]
        if current.role == "user" and previous.role == "assistant" and keyword in previous.content:
            return current.content.strip()
    return None


def _parsed_answer_after_question(
    messages: list[ChatMessage],
    keyword: str,
    parser: Callable[[str | None], Any],
) -> Any:
    for index in range(len(messages) - 1, 0, -1):
        current = messages[index]
        previous = messages[index - 1]
        if current.role != "user" or previous.role != "assistant" or keyword not in previous.content:
            continue
        parsed = parser(current.content.strip())
        if parsed is not None:
            return parsed
    return None


def _city_answer(value: str | None) -> str | None:
    if not value:
        return None
    if re.match(r'^(?:不是|不要|别)',value) or _accepts_proposal(value):return None
    if re.search(r"推荐|随便|不知道|没想好|没定|待定|都可以|都行|随你|听你的|你决定|不确定|或者|或是|还是|都要|不想去|不去|别去|会不会|怎么|什么|说说|到底|条件|预算|日期|朋友|哪|出去玩|帮我|给我|排一下|安排一下|.{2,}(?:和|与|及).{2,}|\b(?:anywhere|not sure|you decide|either|recommend)\b", value,re.I):
        return None
    name=normalize_place(value)
    name=re.sub(r'^(?:我(?:现在|目前)?在|我(?:现在|目前)?住在?)', '', name)
    name=re.sub(r'(?:这边|那边|这里|那里)$', '', name).strip()
    if name.lower() in {'', '我家', '家', '俺家', '老家', '我们家', '这', '那', '附近', '外地',
                       '是', '是的', '对', '对的', '没错', '就是', '第一个', '第二个', 'yes', 'correct'}:
        return None
    name=re.sub(r'^(?:那就(?:去|选|定)?|就(?:去|选|定)|我想去|我要去|想去|要去|选|去)', '', name)
    if invalid_route_place(name):
        return None
    name = name.removesuffix('度假') if len(name) > 3 else name
    if name.endswith('出发'):
        name=name.removesuffix('出发')
        if name.startswith('从'):name=name[1:]
    if re.fullmatch(r'[零〇一二两三四五六七八九十\d]+(?:天|人|位|元|周|晚)',name):return None
    return name if re.fullmatch(rf'[{HAN}A-Za-z][{HAN}A-Za-z ·-]{{1,23}}',name) else None


def _route_updates(value: str) -> dict[str, str]:
    # Explicit user edits are applied in chronological order; assistant text
    # must never restore an obsolete route.
    cleaned = re.sub(r"我改主意了|改主意了|改成|改为|换成|改去|还是|我想|我要", "，", value)
    cleaned = re.sub(r'出去(?=玩|走走|转转)', '出门', cleaned)
    cleaned = re.sub(r"^(?:那(?:么)?|如果|要是|假如|换作|换做)\s*", "", cleaned.strip())
    cleaned = re.sub(r"(?:呢|吗|怎么样|如何|可以吗|行吗|的话)[？?！!。\s]*$", "", cleaned)
    cleaned = cleaned.rstrip("？?！!。 ")
    city = rf"[{HAN}A-Za-z]{{2,24}}?"
    end = r"(?=的?航班|的?机票|机场|玩|旅行|旅游|[，,。；;？?！!\s\d]|$)"
    pair = re.search(
        rf"从(?P<origin>{city})(?:出发|开车|自驾|驾车)?(?:飞往|飞到|飞|到|去)(?P<destination>{city}){end}",
        cleaned,
    )
    if not pair:
        pair = re.search(
            rf"(?:^|[，,。；;\s])(?P<origin>{city})(?:出发)?(?:飞往|飞到|飞|到)(?P<destination>{city}){end}",
            cleaned,
        )
    if pair:
        origin=_city_answer(pair.group('origin'));destination=_city_answer(pair.group('destination'))
        if origin and invalid_route_place(normalize_place(pair.group('destination'))):
            return {'origin': origin}
        return {'origin':origin,'destination':destination} if origin and destination else {}
    updates = {}
    origin = re.search(rf"从(?P<city>{city})(?:出发|起飞|飞)", cleaned)
    origin_label=re.search(rf'(?:出发地|起点)(?:改成|改为|换成|是|为|[:：])(?P<city>{city}){end}',value)
    if origin_label:origin=origin_label
    destination = re.search(rf"(?:目的地[是为：:]?|去|飞往|飞到)(?P<city>{city}){end}", cleaned)
    if not destination:
        # Colloquial “上三亚旅游”. Keep places beginning with 上 intact, e.g. 上海市 and 上饶市.
        destination = re.search(rf"(?:打算|计划|准备|想|要|冬天|夏天|春天|秋天)上(?!海|饶|虞|蔡)\s*(?P<city>{city})(?=旅游|旅行|度假|玩)", value)
    if not destination and not origin and not re.search(r'出发地|起点|出发',value) and re.search(r"改去|改成|改为|换成", value):
        destination = re.search(rf"(?:改去|改成|改为|换成)(?P<city>{city}){end}", value)
    if origin:
        candidate=_city_answer(origin.group('city'))
        if candidate:updates['origin']=candidate
    if destination:
        candidate=_city_answer(destination.group('city'))
        if candidate:updates['destination']=candidate
    return updates


def _numeric_answer(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", value)
    return float(match.group(1)) if match else None


def _travelers_answer(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"[一二两三四五六七八九十\d]+", value)
    if not match:
        return None
    try:
        return parse_people(match.group(0))
    except ValueError:
        return None


CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def _chinese_number(value: str) -> float | None:
    colloquial = re.fullmatch(r"([一二两三四五六七八九])万([一二两三四五六七八九])", value)
    if colloquial:
        return CHINESE_DIGITS[colloquial.group(1)] * 10000 + CHINESE_DIGITS[colloquial.group(2)] * 1000
    section = 0
    number = 0
    found = False
    for char in value:
        if char in CHINESE_DIGITS:
            number = CHINESE_DIGITS[char]
            found = True
        elif char in {"十", "百", "千"}:
            section += (number or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            number = 0
            found = True
        elif char == "万":
            section = (section + number) * 10000
            number = 0
            found = True
    return float(section + number) if found else None


def _budget_answer(value: str | None) -> float | None:
    if not value:
        return None
    value=normalized_input(value)
    match = re.search(r"([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(万|千|[kK]|元|块)?", value)
    if match:
        multiplier = {"万": 10000, "千": 1000, 'k':1000,'K':1000}.get(match.group(2), 1)
        return float(match.group(1)) * multiplier
    chinese_match = re.search(r"([零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?", value)
    return _chinese_number(chinese_match.group(1)) if chinese_match else None


def _budget_from_text(value: str) -> float | None:
    context = re.search(
        r"(?:预算|总预算|控制在|不超过|最多|上限)[^，。；;]{0,18}",
        value,
    )
    return _budget_answer(context.group(0)) if context else None


def _ordered_slots(messages):
    """Only committed facts enter durable memory; uncertainty clears the affected slot."""
    keys=['origin','destination','start_date','days','days_range','travelers','budget_cny','per_person_budget']
    facts = {**dict.fromkeys(keys), 'activity_brief': {}}
    preferences=[];constraints=[];confirmed=False;destination_answer=None;status='active';texts=[];revisions=[];epoch_start=0
    def capture():return (dict(facts),list(preferences),list(constraints),confirmed,status,list(texts),epoch_start)
    def remember(snapshot):
        revisions.append(snapshot)
        del revisions[:-MAX_REVISIONS]
    number=r'(?:[-+]?\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)'
    def numeric(value):
        return float(value) if re.fullmatch(r'[-+]?\d+(?:\.\d+)?',value) else _chinese_number(value)
    def whole(value):
        count=numeric(value)
        return int(count) if count is not None and isfinite(count) and count>=0 and count==int(count) else None
    for index,message in enumerate(messages):
        if message.role!='user' or message.undo_ignored:continue
        raw=message.content.strip();value=normalized_input(raw)
        if undo_requested(raw):
            if revisions:facts,preferences,constraints,confirmed,status,texts,epoch_start=revisions.pop()
            continue
        prior=capture()
        previous=messages[index-1].content if index and messages[index-1].role=='assistant' else ''
        if rail_request(raw) or rail_followup(previous, raw):
            continue
        question=bool(re.search(r'[？?]',previous))
        # Interpret short conversational answers only in the field being asked.
        if question:
            if _accepts_proposal(value):
                destination_proposal = re.fullmatch(r'你想去哪个城市？我建议先去「(.+?)」走走。就选这里吗？', previous)
                date_proposal = re.fullmatch(r'计划哪天出发？我建议 (\d{4}-\d{2}-\d{2}) 出发。这天有空吗？', previous)
                if destination_proposal and destination_proposal[1] == SHORT_TRIP_DESTINATIONS.get((facts['origin'] or '').removesuffix('市')):
                    value = destination_proposal[1]
                elif date_proposal:
                    value = date_proposal[1]
                elif previous == "准备旅行几天？我建议先安排两天，可以吗？":
                    value = "两天"
            answer = normalize_place(value)
            if "哪天出发" in previous:
                value = {"明儿": "明天", "明儿个": "明天", "明夭": "明天", "今儿": "今天", "后儿": "后天"}.get(answer, value)
            if "旅行几天" in previous and answer == "仨天":
                value = "三天"
            if "几位旅行者" in previous:
                if re.fullmatch(r'(?:就)?(?:我|俺)(?:自己|一个(?:人)?)', answer):
                    value = "一人"
                elif re.fullmatch(r'(?:就)?(?:咱俩|我俩|俺俩|我们俩)', answer):
                    value = "两人"
            if "总预算" in previous:
                value = re.sub(r'块钱(?=\s*(?:以内|以下)?$)', '块', answer)
            if _relaxation_answer(previous, value):
                preferences.append('休闲度假')
            for field in ('origin', 'destination'):
                place = facts[field]
                if place != '文州' or not previous.endswith(place_question(place, field)):
                    continue
                choices = PLACE_CHOICES[normalize_place(place)]
                candidate = choices[0] if len(choices) == 1 and answer in {'是', '是的', '对', '对的', '没错'} else _city_answer(value)
                if candidate and field not in protected_fields(raw):
                    facts[field] = candidate
        control=trip_control(raw)
        control_saved=False
        if control=='reset':
            remember(prior);control_saved=True
            facts={**dict.fromkeys(keys), 'activity_brief': {}};preferences=[];constraints=[];confirmed=False;texts=[];status='reset'
            epoch_start=index
            value=control_remainder(value)
            if not value:continue
        if control=='cancelled':
            if status!='cancelled':remember(prior);control_saved=True
            status='cancelled'
            value=control_remainder(value)
            if not value:continue
        if control=='active':status='active'
        protected=protected_fields(raw)
        supplier_context=supplier_prompt(previous) and any(item.role=='user' and supplier_request(item.content) for item in messages[max(epoch_start,index-8):index])
        if supplier_context and not re.search(r'旅行|旅游|行程|出发日期|出发地|目的地|人数|天数|总预算',raw):protected=set(FIELDS)
        if len(protected)==6:continue
        if itinerary_edit(value):
            if status=='active':remember(prior)
            continue
        before=dict(facts)
        value = re.sub(r'(?<=过敏)体至', '体质', value)
        answering_brief = answers_brief(previous, value)
        facts['activity_brief'] = update_activity_brief(
            facts['activity_brief'], value, previous,
            _delegates_choice(value) or normalize_place(value).lower() in {'you decide', 'no preference', 'up to you', '都由你安排', '其他你来安排'},
        )
        if 'budget_cny' in protected and not re.search(r'人均|每人|per person',raw,re.I):facts['per_person_budget']=None
        anchor=message.created_at.astimezone(timezone(timedelta(hours=8))).date() if message.created_at else datetime.now(timezone(timedelta(hours=8))).date()
        clauses=split_clauses(value)
        # Family composition is one total across the message, not last clause wins.
        family=re.search(rf'({number})\s*大\s*({number})\s*小',value)
        parts=re.findall(rf'({number})\s*(?:(?:个|名)(?:[一二两三四五六七八九十\d]+\s*岁(?:的)?)?)?(?:成人|大人|儿童|孩子|小孩|婴儿|婴幼儿)',value)
        family_numbers=[] if service_only(value) else [*(family.groups() if family else []),*parts]
        family_total=sum(whole(n) for n in family_numbers) if family_numbers and all(whole(n) is not None for n in family_numbers) else None
        if 'travelers' not in protected and family_numbers:facts['travelers']=family_total
        base_protected=protected
        for clause in clauses:
            protected=base_protected | FIELDS if service_only(clause) else base_protected
            if re.search(r'没定|未定|待定|不确定|未知|以后再定|Infinity|NaN|无穷',clause,re.I):
                for field,marker in {'origin':'出发地','destination':'目的地','start_date':'日期','days':'天数','travelers':'人数','budget_cny':'预算'}.items():
                    if field not in protected and marker in clause:
                        facts[field]=None
                        if field=='budget_cny':facts['per_person_budget']=None
                        if field=='days':facts['days_range']=None
            if re.search(r'^(?:别|不要|不)(?:增加|改成|换成)',clause):continue
            denied_number=re.match(rf'^不是\s*({number})\s*(天|个?人|位|元)',clause)
            if denied_number:
                unit=denied_number.group(2);field='days' if unit=='天' else 'budget_cny' if unit=='元' else 'travelers'
                if field not in protected and facts[field]==numeric(denied_number.group(1)):facts[field]=None
                continue
            if re.search(r'交换|对调|swap',clause,re.I) and re.search(r'出发地|起点|origin',clause,re.I) and re.search(r'目的地|终点|destination',clause,re.I):
                if not {'origin','destination'} & protected:facts['origin'],facts['destination']=facts['destination'],facts['origin']
                continue
            unknown_origin=bool(re.search(r'出发地.*(?:没定|未定|待定)|不是从.+出发',clause))
            if unknown_origin and 'origin' not in protected:facts['origin']=None
            rejected_origin=re.search(r'(?:不要|别|不想)从(.+?)出发',clause)
            if rejected_origin:
                if 'origin' not in protected and facts['origin']==rejected_origin.group(1):facts['origin']=None
                continue
            negative=re.search(r'(?:不是去|不去|不想去|不要去|别去)(.+)',clause)
            updates={}
            if negative and 'destination' not in protected:
                if not facts['destination'] or facts['destination'] in negative.group(1):facts['destination']=None
            if not negative:
                updates=_route_updates(clause)
                if answering_brief and not re.search(r'目的地|出发地|起点|改去|departure city|destination', clause, re.I):
                    updates = {}
                for field,place in updates.items():
                    if field not in protected and not (field=='origin' and unknown_origin):facts[field]=place
            if 'destination' not in protected:
                uncertain=re.search(r'(?:目的地|改去|改成|换成|去).*(?:没定|待定|不确定|或者|或是)',clause)
                multi=not negative and not updates.get('destination') and re.search(r'(?:改去|去|目的地).{2,}(?:和|与|及).{2,}',clause)
                if uncertain or multi:facts['destination']=None
                chosen=re.match(r'^(?:那就|还是|就选|改回)(.+?)(?:吧)?$',clause)
                if chosen:
                    city=_city_answer(chosen.group(1))
                    if city:facts['destination']=city
            route=re.search(r'\bfrom\s+([A-Za-z][A-Za-z .-]+?)\s+to\s+([A-Za-z][A-Za-z .-]+?)(?=\s+(?:starting|on|for)\b|$)',clause,re.I)
            if route:
                for field,place in zip(['origin','destination'],route.groups()):
                    if field not in protected:facts[field]=_city_answer(place.strip())
            route_edit=re.search(r'\b(?:change|set)\s+(?:the\s+)?(destination|departure city|origin)\s+to\s+([A-Za-z][A-Za-z -]+)',clause,re.I)
            if route_edit:
                field='destination' if route_edit.group(1).lower()=='destination' else 'origin'
                if field not in protected:facts[field]=_city_answer(route_edit.group(2).strip())

            # Returning, attraction opening dates, and durations are not departure dates.
            date_allowed='start_date' not in protected and not re.search(r'回来|回程|返程|开馆|开业|开幕|建成|成立|天气|气温|降水|日落|return|opening|weather|temperature',clause,re.I)
            explicit=re.findall(EXPLICIT_TRIP_DATE, clause)
            relative=re.search(r'大后天|大前天|后天|前天|昨天|明天|今天|今日|明日|\btomorrow\b|\btoday\b|\byesterday\b',clause,re.I)
            if date_allowed:
                if explicit and (not re.search(r'预算|budget|CNY|元|人均',clause,re.I) or re.search(r'日期|出发|starting|depart',clause,re.I)):
                    year,month,day=explicit[-1]
                    if year and len(year) == 2:
                        year = str(anchor.year // 100 * 100 + int(year))
                    facts['start_date']=None
                    for candidate_year in [int(year)] if year else range(anchor.year,min(10000,anchor.year+9)):
                        try:candidate=date(candidate_year,int(month),int(day))
                        except ValueError:continue
                        if year or candidate>=anchor:
                            facts['start_date']=candidate;break
                elif relative:
                    offset={'今天':0,'今日':0,'明天':1,'明日':1,'后天':2,'大后天':3,'昨天':-1,'前天':-2,'大前天':-3,'tomorrow':1,'today':0,'yesterday':-1}[relative.group().lower()]
                    try:facts['start_date']=anchor+timedelta(days=offset)
                    except OverflowError:facts['start_date']=None
                elif re.search(r'日期.*(?:改|换)|改.*(?:明年|下周|周末|元旦|春节)|下周.*出发',clause):facts['start_date']=None
            if 'days' not in protected:
                day_range = re.search(rf'(?<![\d.第])({number})\s*(?:到|至|[-~–—])\s*({number})\s*天', clause)
                duration=re.findall(rf'(?<![\d.第])({number})\s*天|\b(\d+(?:\.\d+)?)[ -]*days?\b',clause,re.I)
                if day_range:
                    low, high = map(whole, day_range.groups())
                    facts['days'] = None
                    facts['days_range'] = (low, high) if low is not None and high is not None and 1 <= low < high <= 60 else None
                elif duration:
                    facts['days_range'] = None
                    count=whole(next(part for part in duration[-1] if part))
                    if re.search(r'多玩|增加|延长',clause):facts['days']=facts['days']+count if facts['days'] is not None and count is not None else None
                    elif re.search(r'少玩|减少|缩短',clause):facts['days']=facts['days']-count if facts['days'] is not None and count is not None else None
                    else:facts['days']=None if re.match(r'不玩',clause) else count
                elif re.search(r'一周|one week',clause,re.I):facts.update(days=7, days_range=None)
                elif re.search(r'one day (?:shorter|less)',clause,re.I):facts['days']=facts['days']-1 if facts['days'] is not None else None
            if 'travelers' not in protected and not family_numbers:
                people=re.findall(rf'(?<![\d.第])({number})\s*(?:个?人(?!均)|位)|\b(\d+(?:\.\d+)?)\s*(?:travelers?|people|persons?)\b',clause,re.I)
                added=re.search(rf'(?:再加|新增|增加)\s*({number})\s*个?(?:人|朋友|同伴)',clause)
                if added:
                    n=whole(added.group(1));facts['travelers']=facts['travelers']+n if facts['travelers'] is not None and n is not None else None
                elif re.search(r'add one more traveler',clause,re.I):facts['travelers']=facts['travelers']+1 if facts['travelers'] is not None else None
                elif people:facts['travelers']=whole(next(part for part in people[-1] if part))
                elif re.search(r'就我自己|只剩我(?:一人)?|\b(?:solo|by myself)\b',clause,re.I):facts['travelers']=1
            other_limit = re.search(r'餐厅|餐饮|饭店|酒店|住宿|每晚|一晚|per night|手机|电脑|步行|走路|分钟|公里|小时|\bminutes?\b|\bkm\b', clause, re.I)
            if 'budget_cny' not in protected and (not other_limit or re.search(r'总预算|total budget', clause, re.I)):
                budget_context=bool(re.search(r'预算|控制在|不超过|最多|上限|人均|每人|\bbudget\b',clause,re.I))
                # A correction can put the monetary amount before the budget label.
                if budget_context:
                    amount=re.search(r'(?:总预算|预算|人均|每人|budget|控制在|不超过|最多|上限)(.*)$',clause,re.I)
                    budget=_budget_answer(amount.group(1)) if amount else None
                    if budget is None:budget=_budget_answer(clause)
                    if budget is not None:
                        if re.search(r'人均|每人|per person',clause,re.I):facts['per_person_budget']=budget
                        else:facts['budget_cny']=budget;facts['per_person_budget']=None
                    if re.search(r'不限|无上限|unlimited',clause,re.I) or re.search(rf'{number}\s*(?:到|至|[-~])\s*{number}',clause) or re.search(r'每天|每日|per day|USD|美元|美金|欧元|EUR',clause,re.I):
                        facts['budget_cny']=None;facts['per_person_budget']=None
                elif re.search(r'预算',value) and re.fullmatch(rf'{number}\s*(?:元|块)(?:总预算|以内)?',clause):
                    facts['budget_cny']=_budget_answer(clause);facts['per_person_budget']=None
            if re.search(r'不含.*(?:机票|交通)|excluding.*(?:flight|transport)',clause,re.I):
                constraints.append(clause);confirmed=True
            if re.search(r'不想|不要|不吃|避免|过敏|高度近视|素食|清真|vegan|vegetarian|allerg|high myopia',clause,re.I):
                constraints.append(clause);confirmed=True
            if re.search(r'只(?:玩|去|安排|逛)?室内|全程室内|不(?:去|玩|安排)室外|(?:只|就)?吃素(?:$|食)|每晚|一晚|电梯|双床|无障碍|(?:步行|走路).*(?:最多|不超过|至多|≤)\s*\d+\s*分钟|indoor only|per night|elevator', clause, re.I):
                constraints.append('素食' if re.fullmatch(r'(?:只|就)?吃素', clause) else clause)
                confirmed=True
            removed=re.search(r'不想以(.+?)为主|不再喜欢(.+)|取消(.+?)偏好',clause)
            if removed:
                term=next(part for part in removed.groups() if part)
                preferences=[pref for pref in preferences if term not in pref]
            pref=re.search(r'(?:希望|喜欢|偏好|优先|主要看|focus on|prefer)\s*[:：]?\s*(.+)',clause,re.I)
            if pref and not removed:preferences.append(pref.group(1));confirmed=True
        protected=base_protected
        # Multiple candidate dates are uncertainty, not a last-match preference.
        if 'start_date' not in protected and re.search(r'(?:或者|或是|还没定)',value) and re.search(r'\d+[月./-]\d+',value):facts['start_date']=None
        if question and not service_only(value):
            city=_city_answer(value)
            if ('从哪里出发' in previous or '从哪个城市出发' in previous or 'departing from' in previous.lower() or 'for your departure city:' in previous.lower()) and 'origin' not in protected:
                if city:facts['origin']=city
            if ('去哪个城市' in previous or '哪个城市或目的地' in previous or 'which city would you like to visit' in previous.lower() or 'for your destination:' in previous.lower()) and 'destination' not in protected:
                destination_answer=value
                if city:facts['destination']=city
            for field,marker,en in [('days','旅行几天','how many days'),('travelers','几位旅行者','how many travelers')]:
                if field not in protected and (marker in previous or en in previous.lower()) and re.fullmatch(number+r'(?:天|个?人|位)?[！!。 ]*',value):
                    facts[field]=whole(re.match(number,value).group())
                    if field == 'days':facts['days_range']=None
            if 'budget_cny' not in protected and ('总预算' in previous or 'total budget' in previous.lower()):
                money = r'(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)'
                approximate = re.search(r'[一二两三四五六七八九]{2}(?:百|千|万)', value)
                if not approximate and re.fullmatch(rf'(?:控制在|最多)?{money}\s*(?:万|千|k|K|元|块)?(?:以内|以下)?',value):
                    facts['budget_cny']=_budget_answer(value);facts['per_person_budget']=None
            if '偏好或必须遵守' in previous or 'preferences or constraints' in previous.lower():
                confirmed=True
                if not _delegates_choice(value) and normalize_place(value).lower() not in {'没有','无','没有了','暂无','没啥','没啥要求','none'} and not re.search(r'过敏|allerg', value, re.I):
                    preferences.append(value)
        if any(facts.get(key)!=before.get(key) for key in keys):
            if status!='cancelled':status='active'
            texts.append(value)
        elif re.search(r'希望|喜欢|偏好|不吃|过敏|主要看',value):texts.append(value)
        if facts['per_person_budget'] is not None:
            facts['budget_cny']=facts['per_person_budget']*facts['travelers'] if facts['travelers'] is not None else None
        if facts!=prior[0] or preferences!=prior[1] or constraints!=prior[2] or confirmed!=prior[3] or status!=prior[4]:
            if not control_saved:remember(prior)
    if facts['per_person_budget'] is not None:
        facts['budget_cny']=facts['per_person_budget']*facts['travelers'] if facts['travelers'] is not None else None
    if facts['budget_cny'] is not None and (not isfinite(facts['budget_cny']) or facts['budget_cny']<0):facts['budget_cny']=None
    facts['_status']=status;facts['_texts']=texts;facts['_epoch_start']=epoch_start
    return facts,list(dict.fromkeys(preferences)),list(dict.fromkeys(constraints)),confirmed,destination_answer


def collect_trip_intake(messages: list[ChatMessage],language='zh',requirements_only=False) -> TripIntakeResponse:
    user_texts = [message.content for message in messages if message.role == "user"]
    text = "；".join(user_texts)
    latest_user_text = user_texts[-1].strip() if user_texts else ''
    if not requirements_only and (re.search(r"收到吗|收得到吗|能看到吗|听得到吗", latest_user_text) or re.fullmatch(
        r"(?:test|测试|测试一下)[？?！!。,.， ]*",
        latest_user_text,
        re.IGNORECASE,
    )):
        return TripIntakeResponse(
            ready=False,
            reply="Received. JARVIS is online." if language=='en' else "收到了，连接正常，JARVIS 在线。",
            collected={},
        )
    if not requirements_only and re.fullmatch(
        r"(?:在吗|在不|在不在|有人吗|喂|忙吗)[？?！!。,.， ]*",
        latest_user_text,
    ):
        return TripIntakeResponse(
            ready=False,
            reply="在的，我在。你想聊旅行灵感、查天气，还是直接规划一趟行程？",
            collected={},
        )
    if not requirements_only and re.search(r"(?:现在)?几点|现在.*时间|时间.*多少", latest_user_text):
        now = datetime.now(timezone(timedelta(hours=8)))
        greeting = "晚上好。" if "晚上好" in latest_user_text else ""
        return TripIntakeResponse(
            ready=False,
            reply=f"{greeting}现在是北京时间 {now:%H:%M}。想规划旅行时，告诉我目的地或大概想法就可以。",
            collected={},
        )

    if not requirements_only and re.fullmatch(r"(?:你好|您好|嗨|hi|hello|早上好|中午好|下午好|晚上好)[！!。,.， ]*", latest_user_text, re.IGNORECASE):
        return TripIntakeResponse(
            ready=False,
            reply="Hello! Tell me where you would like to go, or share your dates, group size and budget." if language=='en' else "你好！我是 JARVIS。你可以先告诉我想去哪里，也可以直接说完整的日期、人数和预算。",
            collected={},
        )

    facts,preferences,hard_constraints,preferences_confirmed,destination_answer=_ordered_slots(messages)
    origin=facts['origin'];destination=facts['destination'];start_date=facts['start_date']
    days=facts['days'];travelers=facts['travelers'];budget=facts['budget_cny']

    collected = {
        "origin": origin,
        "destination": destination,
        "start_date": start_date.isoformat() if start_date else None,
        "days": days,
        "travelers": travelers,
        "budget_cny": budget,
        "preferences": list(dict.fromkeys(preferences)),
        "hard_constraints":hard_constraints,
        'planning_status':facts['_status'],
    }
    if facts['days_range']:
        collected['days_range'] = list(facts['days_range'])
    if start_date and days is not None and 1<=days<=60:
        try:start_date+timedelta(days=days-1)
        except OverflowError:
            start_date=None;collected['start_date']=None
    if facts['_status'] in {'cancelled','reset'}:
        reset=facts['_status']=='reset'
        return TripIntakeResponse(ready=False,collected=collected,reply=(
            ('Previous requirements have been cleared. Where would you like to go?' if reset else 'Planning is paused. Your chat history is kept; tell me when you want to resume.') if language=='en' else
            ('之前的旅行条件已清空。新的旅行想去哪里？' if reset else '已停止这趟旅行的规划，聊天记录会保留。想继续时可以告诉我“恢复行程规划”。')))
    invalid={key:label for key,label,valid in [('days','旅行天数需要在1到60天之间。',days is None or 1<=days<=60),('travelers','旅行人数需要在1到100人之间。',travelers is None or 1<=travelers<=100),('budget_cny','总预算需要大于0元。',budget is None or budget>0)] if not valid}
    if invalid:
        field=next(iter(invalid))
        return TripIntakeResponse(ready=False,reply=invalid[field] if language=='zh' else {'days':'Travel duration must be between 1 and 60 days.','travelers':'There must be between 1 and 100 travelers.','budget_cny':'The total budget must be greater than zero CNY.'}[field],missing=[field],collected={**collected,field:None})
    if destination is None and destination_answer and not _delegates_choice(latest_user_text) and re.search(
        r"推荐|随便|不知道|没想好|都可以|你决定", destination_answer
    ):
        return TripIntakeResponse(
            ready=False,
            reply=(
                "可以。先给你三个不同方向：杭州适合轻松短途，成都适合美食与慢节奏，"
                "北京适合历史文化。你想去哪个城市？也可以告诉我更偏好自然风景、逛吃还是人文。"
            ),
            missing=["destination"],
            collected=collected,
        )
    required = ["origin", "destination", "start_date", "days", "travelers", "budget_cny"]
    pending_places = {
        field: place
        for field, place in (("origin", origin), ("destination", destination))
        if place and place_question(place, field, language)
    }
    if pending_places:
        field, place = next(iter(pending_places.items()))
        question = place_question(place, field, language)
        if start_date and re.search(EXPLICIT_TRIP_DATE, normalized_input(latest_user_text)) and _trip_followup(latest_user_text):
            question = (f"Departure date saved as {start_date.isoformat()}. " if language == 'en' else
                        f"已记下 {start_date.isoformat()} 出发。") + question
        return TripIntakeResponse(
            ready=False, reply=question, missing=[field],
            collected={**collected, **dict.fromkeys(pending_places), 'pending_places': pending_places},
        )
    if destination and needs_city(destination):
        return TripIntakeResponse(
            ready=False,
            reply=(f'{destination} covers multiple cities. Which city will be your base?' if language=='en' else f"{destination}范围比较大，先确定落脚城市，才能安排交通、住宿和每天怎么玩。你想去哪个城市？例如哈尔滨、长春或沈阳。" if destination.startswith('东北') else f"{destination}包含多个城市，你想去哪个城市或以哪个城市为落脚点？"),
            missing=['destination'], collected=collected,
        )
    missing = [field for field in required if collected[field] is None]
    brief = facts['activity_brief']
    has_activity_brief = activity_brief_needed(brief, days)
    if not missing and not preferences_confirmed and not has_activity_brief:
        missing.append("preferences")
    if missing:
        field = missing[0]
        previous = messages[-2].content if len(messages) > 1 and messages[-2].role == 'assistant' else ''
        if days is None and not facts['days_range'] and destination and _relaxation_answer(previous, latest_user_text):
            questions = FIELD_QUESTIONS_EN if language == 'en' else FIELD_QUESTIONS
            return TripIntakeResponse(ready=False, reply=questions['days'], missing=['days', *[key for key in missing if key != 'days']], collected=collected)
        reply = (FIELD_QUESTIONS_EN if language == 'en' else FIELD_QUESTIONS)[field]
        if language == "zh" and _delegates_choice(latest_user_text):
            if field == "destination":
                nearby = SHORT_TRIP_DESTINATIONS.get((origin or "").removesuffix("市"))
                if nearby:
                    reply = f"你想去哪个城市？我建议先去「{nearby}」走走。就选这里吗？"
                else:
                    reply = "你想去哪个城市？我可以帮你挑。你想在出发地附近玩，还是愿意去远一点？"
            elif field == "start_date":
                anchor = datetime.now(timezone(timedelta(hours=8))).date()
                saturday = anchor + timedelta(days=(5 - anchor.weekday()) % 7 or 7)
                reply = f"计划哪天出发？我建议 {saturday.isoformat()} 出发。这天有空吗？"
            elif field == "days":
                reply = "准备旅行几天？我建议先安排两天，可以吗？"
            elif field == "travelers":
                reply = "一共有几位旅行者？你是一个人去，还是有人同行？"
            elif field == "budget_cny":
                reply = "这趟的总预算，你最多愿意花多少钱？给个大概上限就行。"
        if field == "budget_cny" and language == "zh" and re.search(r'[一二两三四五六七八九]{2}(?:百|千|万)', latest_user_text):
            reply = "这趟最多花多少钱？我按这个数当总预算。"
        if field == 'days' and facts['days_range']:
            low, high = facts['days_range']
            reply = (f'You mentioned {low}–{high} days. How many days should I plan for?' if language == 'en' else
                     f'你前面说可以安排 {low}～{high} 天。打算旅行几天？')
        return TripIntakeResponse(
            ready=False,
            reply=reply,
            missing=missing,
            collected=collected,
        )
    if start_date and start_date < datetime.now(timezone(timedelta(hours=8))).date():
        return TripIntakeResponse(
            ready=False,
            reply="That departure date is in the past. Please give a new date." if language=='en' else "这个出发日期已经过去了，请告诉我一个新的出发日期。",
            missing=["start_date"],
            collected={**collected, "start_date": None},
        )

    brief_preferences = [brief[field] for field in ('beach', 'diving', *CHOICES) if has_activity_brief and brief.get(field)]
    collected['preferences'] = list(dict.fromkeys([*preferences, *brief_preferences]))
    if brief.get('diving') and (brief.get('allergy') or brief.get('vision')):
        pending_diving = 'Keep diving tentative until suitability is confirmed.' if language == 'en' else '潜水适宜性待确认，暂不列为确定项目。'
        hard_constraints = [*hard_constraints, pending_diving]
        collected['hard_constraints'] = hard_constraints
    missing, reply = activity_questions(brief, days, language)
    if missing:
        return TripIntakeResponse(ready=False, reply=reply, missing=missing, collected=collected)

    trip_request = TripRequest(
        text=('；'.join(facts['_texts']) or text)[-4000:],
        origin=origin,
        destination=destination,
        start_date=start_date,
        days=days,
        travelers=travelers,
        budget_cny=budget,
        preferences=collected["preferences"],
        hard_constraints=hard_constraints,
        allow_mock=False,
    )
    preference_label = "、".join(collected["preferences"]) or "无额外偏好"
    comparison_reply=None
    if uncommitted_cost_question(latest_user_text):
        comparison_reply=(
            'Your itinerary is unchanged. Without comparable transport and hotel quotes for the same dates, group size and lodging standard, I cannot determine which destination costs more. Compare return transport and accommodation first, then meals and local transport.' if language=='en' else
            '先保留原行程。目前没有同一日期、人数和住宿标准下的两地交通与酒店报价，不能确定哪个更贵。比较时先看往返交通和住宿，再加餐饮及当地交通；预算是否够用也需要这些报价。')
    return TripIntakeResponse(
        ready=True,
        reply=comparison_reply or (f'Ready: {origin} → {destination}, departing {start_date.isoformat()}, {days} days, {travelers} traveler(s), total budget CNY {budget:.0f}. Click “Build itinerary” or tell me what to change.' if language=='en' else
            f"我已整理好：{origin} → {destination}，{start_date.isoformat()} 出发，"
            f"{days} 天，{travelers} 人，总预算 ¥{budget:.0f}；偏好：{preference_label}。"
            "点击下方“生成行程”开始安排，也可以继续告诉我需要修改的内容。"
        ),
        collected=collected,
        trip_request=trip_request,
    )


def format_trip_memory(messages: list[ChatMessage]) -> tuple[dict[str, Any], str]:
    """Rebuild durable trip facts from the full conversation for every model turn."""
    collected = collect_trip_intake(messages,requirements_only=True).collected
    if locality := stated_locality(messages):
        collected['current_locality'] = locality
    labels = {
        "origin": "出发地",
        "destination": "目的地",
        "start_date": "出发日期",
        "days": "天数",
        "days_range": "可安排的天数范围",
        "travelers": "人数",
        "budget_cny": "预算（元）",
        "preferences": "偏好",
        "current_locality": "用户自述所在地",
    }
    facts = [
        f"- {labels[key]}：{value}"
        for key, value in collected.items()
        if key in labels and value not in (None, [], "")
    ]
    destination = collected.get("destination")
    if destination:
        facts.append(f"- 代词约定：用户说“当地、那里、那边”时，默认指目的地{destination}。")
    for field, raw_place in collected.get("pending_places", {}).items():
        facts.append(f"- 待确认的{labels[field]}原文：{raw_place}。确认前不得将它或候选写成已确定的地点，也不得用它查询路线。")
    return collected, "\n".join(facts) or "尚未确认任何行程信息。"
