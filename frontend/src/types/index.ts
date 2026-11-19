export type AgentStatus = 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRY' | 'WAITING_APPROVAL'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  undo_ignored?: boolean
  web_search?: boolean
  deep_thinking?: boolean
}

export interface ConversationSummary {
  id: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface ConversationDetail extends Omit<ConversationSummary, 'message_count'> {
  messages: ChatMessage[]
  itinerary?: ItinerarySnapshot | null
  travel_results?: TravelResult[]
  ready?:boolean
  trip_request?:TripRequestPayload
  reply_status?:'generating'|'stopped'|'complete'
}

export interface TravelCandidate {candidate_id:string;provider?:'fliggy'|'meituan';category?:string;title:string;price_text:string;url:string|null;tags:string[]}
export interface TravelResult {provider:'fliggy'|'meituan';items:TravelCandidate[];text:string;notice:string;queried_at?:string;category?:string;error?:string}
export interface SelectedCandidate extends TravelCandidate {id:string;provider:'fliggy'|'meituan';category:string;unit_price_cny:number;quantity:number;note:string;needs_review?:boolean}
export interface TripWorkspace {itinerary?:ItinerarySnapshot|null;plan?:TripPlan|null;invalid_itinerary?:boolean;plan_feedback?:{trip_id:string;text:string;created_at?:string};selections:SelectedCandidate[];route_review?:{days:Array<{day:number;origin:string;destination:string;driving_hours?:number;warning:string}>}|null;weather_review?:{facts:SourceFact[];covers_departure:boolean;checked_at:string}|null;budget:{selected_total_cny:number;budget_cny:number|null;remaining_cny:number|null;is_estimate:boolean}}

export interface ItinerarySnapshot {
  days: Array<{day: number; title: string; items: string[]}>
  updated_at: string
  pending_revision?: boolean
  planning_status?: 'active' | 'cancelled' | 'reset'
  previous_trip?: boolean
  incomplete?: boolean
}

export interface TripRequestPayload {
  text: string
  origin: string
  destination: string
  start_date: string
  days: number
  travelers: number
  budget_cny: number
  preferences: string[]
  hard_constraints: string[]
  allow_mock: boolean
}

export interface TripIntakeResponse {
  ready: boolean
  reply: string
  reply_created_at?: string
  missing: string[]
  collected: Record<string, unknown>
  trip_request?: TripRequestPayload
  itinerary?: ItinerarySnapshot | null
  travel_results?:TravelResult[]
  ride_request?:{city:string;origin:string;destination:string}
}

export interface IntakeProgressEvent {
  travel_result?:TravelResult
  type: 'progress' | 'delta' | 'result' | 'error'
  stage?: string
  status?: string
  message?: string
  message_en?: string
  content?: string
  intake?: TripIntakeResponse
}

export interface PlanProgressEvent {
  type: 'progress' | 'result' | 'error'
  stage?: string
  status?: string
  message?: string
  message_en?: string
  plan?: TripPlan
}

export interface SourceFact {
  name: string
  value: string
  source_url: string
  fetched_at: string
  is_mock: boolean
}

export interface AgentTrace {
  agent_id: string
  agent_name: string
  status: AgentStatus
  duration_ms?: number
  input_summary: string
  output_summary: string
  model_provider: string
  fallback_used: boolean
  error?: string
}

export interface TransportOption {
  mode: 'train' | 'flight' | string
  service_number: string
  provider: string
  departure_name: string
  arrival_name: string
  departure_time: string
  arrival_time: string
  duration_minutes?: number
  price_cny?: number
  availability: string
  status: string
  source_url: string
  is_mock: boolean
}

export interface HotelOption {
  hotel_id: string
  name: string
  provider: string
  area: string
  room_type: string
  nightly_price_cny: number|null
  total_price_cny: number|null
  price_text?:string
  candidate_id?:string
  rating?: number
  cancellation_policy: string
  availability: string
  source_url: string
  is_mock: boolean
  map_location?: { address?: string; source_url: string } | null
  pending_checks?: string[]
}

export interface ApprovalRecord {
  id: string
  trip_id: string
  action: string
  level: 'L1' | 'L2' | 'L3'
  status: string
  parameters: Record<string, unknown>
  created_at: string
}

export interface TripPlan {
  trip_id: string
  trace_id: string
  requirement: {
    origin: string
    destination: string
    start_date: string
    days: number
    travelers: number
    budget_cny: number
  }
  weather: SourceFact[]
  research: SourceFact[]
  transport: TransportOption[]
  hotels: HotelOption[]
  itinerary: Array<{ day: number; date: string; title: string; activities: string[]; notes: string[];stops?:Array<{name:string;source_url:string;address?:string}>;route_checks?:Array<{minutes?:number;status?:string}> }>
  costs: Array<{ category: string; description: string; amount_cny: number; is_estimate: boolean }>
  total_cost_cny: number
  remaining_budget_cny: number
  verification: { status: 'PASS' | 'WARNING' | 'FAIL'; issues: Array<{ code: string; status: string; message: string }> }
  traces: AgentTrace[]
  data_mode: string
  ai_summary: string
}

