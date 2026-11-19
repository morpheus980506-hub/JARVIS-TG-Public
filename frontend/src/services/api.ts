import axios from 'axios'
import { useSettings } from '../stores/settings'
import { readJsonLines } from './jsonLines'
import { requestFailure } from './requestFailure'
import type { ServiceConfig } from '../pages/ServiceSettings'
import type { ApprovalRecord, ChatMessage, ConversationDetail, ConversationSummary, IntakeProgressEvent, ItinerarySnapshot, PlanProgressEvent, TripIntakeResponse, TripPlan, TripRequestPayload } from '../types'

const api = axios.create({ baseURL: '/api/v1', timeout: 60000 })

export interface SavedItinerary {conversation_id:string;title:string;origin?:string;destination?:string;start_date?:string;days:number;travelers?:number;updated_at:string;pending_revision:boolean;planning_status?:'active'|'cancelled'|'reset';previous_trip?:boolean;incomplete?:boolean;preview:string[]}
export async function listItineraries():Promise<SavedItinerary[]> {return (await api.get('/itineraries')).data}

export async function getServiceSettings():Promise<ServiceConfig[]> {
  return (await api.get('/settings/services')).data
}
export async function updateServiceSettings(id:string,values:Record<string,string|boolean>) {
  await api.patch(`/settings/services/${id}`,{values})
}

export async function createPlan(text: string): Promise<TripPlan> {
  const response = await api.post<TripPlan>('/trips/plan', { text, allow_mock: true })
  return response.data
}

export async function intakeTrip(messages: ChatMessage[]): Promise<TripIntakeResponse> {
  return (await api.post<TripIntakeResponse>('/trips/intake', { messages })).data
}

export async function intakeTripStream(
  messages: ChatMessage[],
  onEvent: (event: IntakeProgressEvent) => void,
  conversationId?: string,
  signal?:AbortSignal,
): Promise<TripIntakeResponse> {
  const response = await fetch('/api/v1/trips/intake/stream', {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, conversation_id: conversationId, language: useSettings.getState().language }),
  })
  if (!response.ok || !response.body) {
    const body=await response.json().catch(()=>({}))
    throw new Error(requestFailure(body,response.status,useSettings.getState().language))
  }
  let intake: TripIntakeResponse | undefined
  for await(const event of readJsonLines<IntakeProgressEvent>(response.body)) {
      onEvent(event)
      if (event.type === 'error') throw new Error(event.message || '对话处理失败')
      if (event.type === 'result') intake = event.intake
  }
  if (!intake) throw new Error('对话结束但未返回内容')
  return intake
}

export async function createConversation(title = '新对话',message?:ChatMessage): Promise<ConversationDetail> {
  return (await api.post<ConversationDetail>('/conversations', { title,message })).data
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await api.get<ConversationSummary[]>('/conversations')).data
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return (await api.get<ConversationDetail>(`/conversations/${id}`)).data
}

export async function deleteConversation(id: string): Promise<void> {
  await api.delete(`/conversations/${id}`)
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await api.patch(`/conversations/${id}`, { title })
}

export async function saveConversationItinerary(id: string, snapshot: ItinerarySnapshot): Promise<void> {
  await api.put(`/conversations/${id}/itinerary`, {days:snapshot.days})
}

export async function createPlanStream(
  payload: TripRequestPayload,
  onEvent: (event: PlanProgressEvent) => void,
  signal?:AbortSignal,
): Promise<TripPlan> {
  const response = await fetch('/api/v1/trips/plan/stream', {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok || !response.body) {
    const body=await response.json().catch(()=>({}))
    throw new Error(requestFailure(body,response.status,useSettings.getState().language,'plan'))
  }
  let plan: TripPlan | undefined
  for await(const event of readJsonLines<PlanProgressEvent>(response.body)) {
      onEvent(event)
      if (event.type === 'error') throw new Error(event.message || '规划失败')
      if (event.type === 'result') plan = event.plan
  }
  if (!plan) throw new Error('规划结束但未返回方案')
  return plan
}

export async function getHealth() {
  return (await api.get('/health')).data
}

export interface MapConfig {
  enabled: boolean
  key: string
  version: string
  service_host: string
}

export async function getMapConfig(): Promise<MapConfig> {
  return (await api.get<MapConfig>('/config/map')).data
}

export async function requestApproval(tripId: string, action: string, parameters: Record<string, unknown>) {
  return (await api.post('/approvals', { trip_id: tripId, action, level: 'L2', parameters })).data
}

export async function getApprovals(tripId?: string): Promise<ApprovalRecord[]> {
  return (await api.get<ApprovalRecord[]>('/approvals', { params: tripId ? { trip_id: tripId } : {} })).data
}

export async function decideApproval(id: string, approved: boolean, reason = '') {
  return (await api.post(`/approvals/${id}/decision`, { approved, reason })).data
}

