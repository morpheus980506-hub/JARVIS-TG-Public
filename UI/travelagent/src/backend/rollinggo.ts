import type { McpServerConfig } from '../shared'

const services = {
  'rollinggo-hotel': {
    url: 'https://mcp.rollinggo.cn/mcp',
    tools: ['searchHotels', 'getHotelDetail', 'getHotelSearchTags', 'getHotelStaticInfo'],
  },
} as const

export function rollinggoService(server: McpServerConfig) {
  return server.transport === 'builtin' && server.builtin && Object.hasOwn(services, server.builtin)
    ? services[server.builtin as keyof typeof services]
    : undefined
}

export function assertRollinggoQuery(server: McpServerConfig, name: string) {
  const service = rollinggoService(server)
  if (!service || !(service.tools as readonly string[]).includes(name)) {
    throw new Error('RollingGo 仅允许查询，禁止创建订单、支付、取消及未知操作')
  }
}

export function rollinggoConnection(server: McpServerConfig, key: string) {
  const service = rollinggoService(server)
  if (!service) throw new Error('未知 RollingGo 服务')
  if (!key) throw new Error('请先配置 RollingGo API Key')
  return {
    transport: 'http' as const,
    url: service.url,
    headers: { Authorization: `Bearer ${key}` },
    defaultToolTimeout: 30_000,
    mode: 'auto' as const,
  }
}
