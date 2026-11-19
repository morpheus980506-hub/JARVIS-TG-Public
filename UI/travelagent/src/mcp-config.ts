import type { McpServerConfig } from './shared'

export const builtinMcpServers: McpServerConfig[] = [
  {
    id: 'builtin-variflight',
    name: 'VariFlight 航空（仅查询）',
    transport: 'builtin',
    enabled: true,
    builtin: 'variflight',
  },
  {
    id: 'builtin-rollinggo-hotel',
    name: 'RollingGo 酒店（仅查询）',
    transport: 'builtin',
    enabled: true,
    builtin: 'rollinggo-hotel',
  },
  { id: 'builtin-12306', name: '12306', transport: 'builtin', enabled: true, builtin: '12306' },
  {
    id: 'builtin-didi',
    name: '滴滴（仅查询）',
    transport: 'builtin',
    enabled: true,
    builtin: 'didi',
  },
]

export const isBuiltinMcp = (id: string) => builtinMcpServers.some((server) => server.id === id)
