import type { McpServerConfig } from '../shared'

export const variflightReadTools = Object.freeze([
  'searchFlightsByDepArr',
  'searchFlightsByNumber',
  'getFlightTransferInfo',
  'flightHappinessIndex',
  'getRealtimeLocationByAnum',
  'getTodayDate',
  'getFutureWeatherByAirport',
  'searchFlightItineraries',
  'getFlightPriceByCities',
])

export const isVariflight = (server: McpServerConfig) =>
  server.transport === 'builtin' && server.builtin === 'variflight'

export function assertVariflightQuery(name: string) {
  if (!variflightReadTools.includes(name)) {
    throw new Error('VariFlight 仅允许航空数据查询，禁止下单、支付、订单变更及未知操作')
  }
}

export function variflightConnection(key: string) {
  if (!key) throw new Error('请先配置 VariFlight API Key')
  return {
    transport: 'http' as const,
    url: 'https://ai.variflight.com/servers/aviation/mcp',
    headers: { 'X-API-Key': key },
    defaultToolTimeout: 30_000,
    mode: 'auto' as const,
  }
}
