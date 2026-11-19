import type { LocationRequest, LocationResponse } from './location'
export interface LocalAccount {
  username: string
  displayName: string
  kind: 'demo'
}
export interface Profile {
  reasoningEffort?: string
  protocol: 'messages'
  baseURL: string
  model: string
  headers: Record<string, string>
}
export interface KeySource {
  kind: 'account' | 'demo' | 'custom' | 'none'
}
export const defaultWorkspaceId = 'default'
export interface Workspace {
  id: string
  name: string
  path: string
}
export interface Settings {
  keySources: Record<string, KeySource>
  demoAccount: { username: string }
  profile: Profile
  workspaces: Workspace[]
  theme: 'system' | 'light' | 'dark'
  configured: Record<string, boolean>
  masked: Record<string, string>
  mcpServers: McpServerConfig[]
}
export type McpTransport = 'stdio' | 'http' | 'builtin'
export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  builtin?: '12306' | 'didi' | 'rollinggo-hotel' | 'variflight'
}
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}
export interface ModelInfo {
  id: string
  name?: string
  contextWindow?: number
  inputModalities?: string[]
  effort?: { supportedLevels: string[]; defaultLevel?: string }
}
export interface Trace {
  id: string
  name: string
  input: any
  state: 'running' | 'reviewing' | 'approval' | 'done' | 'error'
  output?: any
  explanation?: string
}
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  traces?: Trace[]
  processNotes?: string[]
  processSteps?: ProcessStep[]
  clarification?: Clarification
  clarificationReplyTo?: string
  contextUsage?: ContextUsage
  startedAt?: number
  manuallyStopped?: boolean
  completedAt?: number
  hotelLookups?: HotelLookup[]
}
export const hotelProviders = ['fliggy', 'meituan'] as const
export type HotelProvider = (typeof hotelProviders)[number]
export interface HotelCandidate {
  id: string
  title: string
  url: string
  quotedPrice?: string
  address?: string
  distanceMeters?: number
}
export interface HotelSource {
  provider: HotelProvider
  status:
    | 'running'
    | 'stopped'
    | 'ok'
    | 'no_usable_results'
    | 'not_configured'
    | 'client_missing'
    | 'auth'
    | 'timeout'
    | 'upstream_error'
    | 'invalid_response'
    | 'local_service_unavailable'
  queriedAt?: string
  items: HotelCandidate[]
}
export interface HotelLookup {
  id: string
  city: string
  area?: string
  checkIn?: string
  checkOut?: string
  sources: HotelSource[]
}
export interface HotelBudgetEntry {
  id: string
  title: string
  provider: HotelProvider
  url: string
  city: string
  checkIn?: string
  checkOut?: string
  amount: number | null
}
export interface ContextUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  contextWindow?: number
  estimatedBreakdown?: {
    systemPrompt: number
    toolDefinitions: number
    messages: number
  }
}
export interface ClarificationOption {
  label: string
  description?: string
  recommended?: boolean
}
export interface Clarification {
  questions: { question: string; options?: (string | ClarificationOption)[] }[]
}
export interface ReasoningStep {
  type: 'reasoning'
  id: string
  startedAt: number
  endedAt?: number
  text?: string
}
export type ProcessStep =
  | { type: 'note'; text: string }
  | { type: 'trace'; traceId: string }
  | ReasoningStep
export interface Attachment {
  id: string
  name: string
  mimeType: string
  size: number
  preview?: string
}
export interface Trip {
  title: string
  days: {
    date: string
    title: string
    items: {
      time: string
      name: string
      description: string
      location?: string
      coordinateSystem?: 'GCJ-02' | 'WGS84'
      poiId?: string
    }[]
  }[]
  budget: {
    label: string
    amount: number | null
    kind: 'quote' | 'estimate' | 'unknown'
    source?: string
    queriedAt?: string
  }[]
}
export interface Session {
  id: string
  workspace?: Workspace
  title: string
  titleManual?: boolean
  messages: Message[]
  history: any[]
  trip?: Trip
  hotelBudget?: HotelBudgetEntry[]
  updatedAt: number
}
export interface AgentEvent {
  sessionId: string
  completedSession?: Session
  type:
    | 'start'
    | 'delta'
    | 'trace'
    | 'done'
    | 'error'
    | 'trip'
    | 'approval'
    | 'progress'
    | 'reasoning'
    | 'context-usage'
    | 'hotels'
    | 'hotel-budget'
  hotelLookup?: HotelLookup
  messageId?: string
  hotelBudget?: HotelBudgetEntry[]
  contextUsage?: ContextUsage
  startedMessages?: { userId: string; assistantId: string; startedAt: number }
  text?: string
  trace?: Trace
  reasoning?: ReasoningStep
  trip?: Trip
  approval?: {
    id: string
    command: string
    explanation: string
    cwd: string
    reason: string
  }
}
export interface Bridge {
  onLocationRequest: (callback: (request: LocationRequest) => void) => () => void
  locationResponse: (id: string, response: LocationResponse) => Promise<void>
  startDictation: (id: string) => Promise<void>
  dictationReady: (id: string) => Promise<void>
  cancelDictation: (id: string) => Promise<void>
  transcribeDictation: (id: string, audio: Uint8Array) => Promise<string>
  chooseAttachments: () => Promise<Attachment[]>
  pasteAttachment: (name: string, bytes: Uint8Array) => Promise<Attachment>
  attachmentImage: (id: string) => Promise<string>
  composerMenu: () => Promise<Attachment | null>
  models: () => Promise<ModelInfo[]>
  account: () => Promise<LocalAccount | null>
  login: (username: string, password: string) => Promise<LocalAccount>
  logout: () => Promise<void>
  openMenu: (menu: 'file' | 'edit' | 'view' | 'help') => Promise<void>
  onDesktopAction: (fn: (action: string) => void) => () => void
  windowState: () => Promise<boolean>
  windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<void>
  onWindowState: (fn: (maximized: boolean) => void) => () => void
  settings: () => Promise<Settings>
  panelWidth: (panel: 'sidebar' | 'workbench', width?: number) => Promise<number | undefined>
  mcpServers: () => Promise<McpServerConfig[]>
  saveMcpServers: (value: McpServerConfig[]) => Promise<McpServerConfig[]>
  testMcpServer: (value: McpServerConfig) => Promise<{ name: string; tools: McpToolInfo[] }>
  saveSettings: (value: any) => Promise<Settings>
  validate: (key?: string) => Promise<{
    available: boolean
    models: string[]
    balance: any
  }>
  addWorkspace: () => Promise<Settings | null>
  removeWorkspace: (id: string) => Promise<Settings>
  openWorkspace: (sessionId: string) => Promise<string>
  sessions: () => Promise<Session[]>
  createSession: (workspaceId: string) => Promise<Session>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  saveHotelBudget: (
    sessionId: string,
    lookupId: string,
    candidateId: string,
    amount: number | null,
  ) => Promise<void>
  removeHotelBudget: (sessionId: string, entryId: string) => Promise<void>
  run: (
    id: string,
    text: string,
    editMessageId?: string,
    attachmentIds?: string[],
    clarificationReplyTo?: string,
  ) => Promise<void>
  cancel: (id: string) => Promise<void>
  approve: (id: string, allow: boolean) => Promise<void>
  staticMap: (locations: string[]) => Promise<string>
  mapConfig: () => Promise<{
    key: string
    proxy: string
    frame: string
  }>
  openExternal: (url: string) => Promise<void>
  onEvent: (fn: (event: AgentEvent) => void) => () => void
}
declare global {
  interface Window {
    travel: Bridge
  }
}
