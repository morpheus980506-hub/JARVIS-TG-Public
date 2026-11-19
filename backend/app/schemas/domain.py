from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import AwareDatetime, BaseModel, Field, model_validator


class StrEnum(str, Enum):
    """JSON-friendly string enum."""


class AgentStatus(StrEnum):
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRY = "RETRY"
    WAITING_APPROVAL = "WAITING_APPROVAL"


class VerificationStatus(StrEnum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"


class TripRequest(BaseModel):
    text: str = Field(min_length=2, max_length=4000)
    origin: str | None = None
    destination: str | None = None
    start_date: date | None = None
    days: int | None = Field(default=None, ge=1, le=60)
    travelers: int = Field(default=1, ge=1, le=100)
    budget_cny: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    preferences: list[str] = Field(default_factory=list)
    hard_constraints: list[str] = Field(default_factory=list)
    allow_mock: bool = False


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=64000)
    created_at: AwareDatetime | None = None
    undo_ignored: bool = False
    web_search: bool | None = None
    deep_thinking: bool | None = None

    @model_validator(mode='after')
    def user_length(self):
        if self.role=='user' and not self.content.strip():raise ValueError('用户消息不能为空白。')
        if self.role=='user' and len(self.content)>4000:raise ValueError('用户消息请控制在4000字以内。')
        return self


class TripIntakeRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=200)
    conversation_id: str | None = Field(default=None, max_length=64)
    language: Literal['zh', 'en'] = 'zh'

    @model_validator(mode='after')
    def ends_with_user(self):
        if self.messages[-1].role!='user':raise ValueError('请以用户问题结束本轮消息。')
        return self


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class SnapshotDay(BaseModel):
    day: int = Field(ge=1, le=60)
    title: str = Field(max_length=300)
    items: list[str] = Field(min_length=1, max_length=50)


class ConversationItinerary(BaseModel):
    days: list[SnapshotDay] = Field(min_length=1, max_length=60)

    @model_validator(mode='after')
    def unique_days(self):
        if len({day.day for day in self.days})!=len(self.days):raise ValueError('行程中不能有重复的天数编号。')
        self.days.sort(key=lambda day:day.day)
        return self


class ConversationCreate(BaseModel):
    title: str = Field(default="新对话", min_length=1, max_length=160)
    message: ChatMessage | None = None

    @model_validator(mode='after')
    def initial_user_message(self):
        self.title=self.title.strip()
        if not self.title:raise ValueError('对话名称不能为空白。')
        if self.message and self.message.role!='user':raise ValueError('新对话只能预存用户发送的问题。')
        return self


class TripIntakeResponse(BaseModel):
    ready: bool
    reply: str
    missing: list[str] = Field(default_factory=list)
    collected: dict[str, Any] = Field(default_factory=dict)
    trip_request: TripRequest | None = None


class Requirement(BaseModel):
    origin: str
    destination: str
    start_date: date
    days: int = Field(ge=1,le=60)
    travelers: int = Field(ge=1,le=100)
    budget_cny: float = Field(gt=0,allow_inf_nan=False)
    preferences: list[str] = Field(default_factory=list)
    hard_constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class SourceFact(BaseModel):
    name: str
    value: str
    source_url: str
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_mock: bool = False
    place_type: str | None = None
    address: str | None = None
    opening_hours: str | None = None


class TransportOption(BaseModel):
    mode: str
    service_number: str
    provider: str
    departure_name: str
    arrival_name: str
    departure_time: str
    arrival_time: str
    duration_minutes: int | None = Field(default=None, ge=0)
    price_cny: float | None = Field(default=None, ge=0,allow_inf_nan=False)
    availability: str = "待核验"
    status: str = ""
    source_url: str
    is_mock: bool = False


class HotelOption(BaseModel):
    hotel_id: str
    name: str
    provider: str
    area: str
    room_type: str
    nightly_price_cny: float | None = Field(default=None,ge=0,allow_inf_nan=False)
    total_price_cny: float | None = Field(default=None,ge=0,allow_inf_nan=False)
    price_text: str = ''
    candidate_id: str = ''
    rating: float | None = Field(default=None, ge=0, le=5)
    cancellation_policy: str
    availability: str
    source_url: str = ""
    is_mock: bool = True
    map_location: SourceFact | None = None
    pending_checks: list[str] = Field(default_factory=list)


class CostItem(BaseModel):
    category: str
    description: str
    amount_cny: float = Field(ge=0,allow_inf_nan=False)
    is_estimate: bool = True


class DayPlan(BaseModel):
    day: int
    date: date
    title: str
    activities: list[str]
    notes: list[str] = Field(default_factory=list)
    stops: list[dict[str, Any]] = Field(default_factory=list)
    route_checks: list[dict[str, Any]] = Field(default_factory=list)


class AgentTrace(BaseModel):
    agent_id: str
    agent_name: str
    status: AgentStatus
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    input_summary: str = ""
    output_summary: str = ""
    model_provider: str = "deterministic"
    fallback_used: bool = False
    error: str | None = None


class VerificationIssue(BaseModel):
    code: str
    status: VerificationStatus
    message: str


class VerificationReport(BaseModel):
    status: VerificationStatus
    issues: list[VerificationIssue] = Field(default_factory=list)


class TripPlan(BaseModel):
    trip_id: str = Field(default_factory=lambda: uuid4().hex)
    trace_id: str
    requirement: Requirement
    weather: list[SourceFact] = Field(default_factory=list)
    research: list[SourceFact] = Field(default_factory=list)
    transport: list[TransportOption] = Field(default_factory=list)
    hotels: list[HotelOption] = Field(default_factory=list)
    itinerary: list[DayPlan]
    costs: list[CostItem]
    total_cost_cny: float = Field(ge=0,allow_inf_nan=False)
    remaining_budget_cny: float = Field(allow_inf_nan=False)
    verification: VerificationReport
    traces: list[AgentTrace]
    data_mode: str
    ai_summary: str = "模型未配置；当前结果由确定性编排生成。"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ApprovalLevel(StrEnum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class ApprovalRequest(BaseModel):
    trip_id: str
    action: str
    level: ApprovalLevel
    amount_cny: float | None = Field(default=None, ge=0)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecision(BaseModel):
    approved: bool
    reason: str = ""

