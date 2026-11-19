import { randomUUID } from 'node:crypto'
import { MCPAdapter } from '@langchain/mcp-adapters'
import { z } from 'zod'
import { builtinMcpServers, isBuiltinMcp } from '../mcp-config'
import type { McpServerConfig } from '../shared'
import { defineTool as tool, type AgentTool } from './agent-tools'
import { DidiClient } from './didi'
import { createRailwayTools } from './railway/tools'
import { assertRollinggoQuery, rollinggoConnection, rollinggoService } from './rollinggo'
import { get, put, secret } from './store'
import {
  assertVariflightQuery,
  isVariflight,
  variflightConnection,
  variflightReadTools,
} from './variflight'

export const defaultMcpServers = (): McpServerConfig[] =>
  builtinMcpServers.map((server) => ({ ...server }))

export function mcpServers(): McpServerConfig[] {
  const value = get('mcpServers')
  return [
    ...defaultMcpServers(),
    ...(Array.isArray(value) ? value : []).filter((server) => !isBuiltinMcp(server?.id)),
  ]
}

export function saveMcpServers(value: McpServerConfig[]) {
  put('mcpServers', value.filter((server) => !isBuiltinMcp(server.id)).map(normalizeServer))
  return mcpServers()
}
export function normalizeServer(value: McpServerConfig): McpServerConfig {
  const id = value.id.trim()
  const name = value.name.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new Error('MCP 服务 ID 只能包含字母、数字、下划线和短横线')
  }
  if (!name || name.length > 80) throw new Error('MCP 服务名称无效')
  if (!['stdio', 'http', 'builtin'].includes(value.transport)) {
    throw new Error('MCP 传输类型无效')
  }
  if (
    value.transport === 'builtin' &&
    !builtinMcpServers.some((server) => server.id === id && server.builtin === value.builtin)
  ) {
    throw new Error('未知内置 MCP 服务')
  }
  if (value.transport === 'stdio' && !value.command?.trim()) {
    throw new Error('stdio MCP 服务需要填写启动命令')
  }
  if (value.transport === 'http' && !value.url?.trim()) {
    throw new Error('HTTP MCP 服务需要填写 URL')
  }
  return {
    ...value,
    id,
    name,
    enabled: value.enabled !== false,
    args: value.args?.map((item) => String(item)).slice(0, 32),
    env: value.env
      ? Object.fromEntries(Object.entries(value.env).map(([key, item]) => [key, String(item)]))
      : {},
  }
}

function adapterConnection(server: McpServerConfig) {
  if (isVariflight(server)) return variflightConnection(secret('variflight'))
  if (rollinggoService(server)) return rollinggoConnection(server, secret('rollinggo'))
  if (server.transport === 'stdio') {
    return {
      transport: 'stdio' as const,
      command: server.command!,
      args: server.args || [],
      env: server.env,
      stderr: 'ignore' as const,
      mode: 'auto' as const,
    }
  }
  if (server.transport === 'http') {
    return {
      url: server.url!,
      transport: 'http' as const,
      mode: 'auto' as const,
    }
  }
  throw new Error('内置 MCP 不使用 LangChain 连接器')
}

async function discoverExternalTools(server: McpServerConfig, signal?: AbortSignal) {
  const adapter = new MCPAdapter({
    servers: { [server.id]: adapterConnection(server) },
    onConnectionError: 'throw',
    prefixToolNameWithServerName: false,
  })
  try {
    const toolsets = await adapter.listToolsets()
    if (signal) signal.throwIfAborted()
    const discovered = toolsets[server.id] || []
    const service = isVariflight(server) ? { tools: variflightReadTools } : rollinggoService(server)
    return {
      adapter,
      tools: service
        ? discovered.filter((item) => (service.tools as readonly string[]).includes(item.name))
        : discovered,
    }
  } catch (error) {
    await adapter.close()
    throw error
  }
}

export function wrapExternalTool(server: McpServerConfig, external: any): AgentTool {
  return {
    description: `[${server.name}] ${external.description || external.name}`,
    inputSchema: external.schema,
    execute: async (input: unknown, options?: { abortSignal?: AbortSignal }) => {
      if (isVariflight(server)) assertVariflightQuery(external.name)
      if (rollinggoService(server)) assertRollinggoQuery(server, external.name)
      const result = await external.invoke(input, { signal: options?.abortSignal })
      return isVariflight(server)
        ? {
            data: result,
            source: 'VariFlight 飞常准',
            queriedAt: new Date().toISOString(),
            queryOnly: true,
          }
        : result
    },
  }
}

function schemaToZod(schema: any): z.ZodType {
  if (!schema || typeof schema !== 'object') return z.any()
  if (Array.isArray(schema.enum)) return z.enum(schema.enum.map(String) as [string, ...string[]])
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const shape: Record<string, z.ZodType> = {}
    for (const [key, value] of Object.entries(schema.properties || {})) {
      const item = schemaToZod(value)
      shape[key] = required.has(key) ? item : item.optional()
    }
    return z.object(shape).passthrough()
  }
  if (schema.type === 'array') return z.array(schemaToZod(schema.items))
  if (schema.type === 'string') return z.string()
  if (schema.type === 'integer' || schema.type === 'number') return z.number()
  if (schema.type === 'boolean') return z.boolean()
  return z.any()
}
function toolName(server: McpServerConfig, name: string) {
  return `mcp_${server.id}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
}

const builtinTools = createRailwayTools()

export async function testMcpServer(config: McpServerConfig) {
  const normalized = normalizeServer(config)
  if (
    normalized.transport === 'builtin' &&
    !rollinggoService(normalized) &&
    !isVariflight(normalized)
  ) {
    if (normalized.builtin === 'didi') {
      const client = new DidiClient(secret('didi'))
      try {
        return { name: normalized.name, tools: await client.listTools(AbortSignal.timeout(30_000)) }
      } finally {
        await client.close()
      }
    }
    return {
      name: normalized.name,
      tools: builtinTools.map(({ name, description }) => ({ name, description })),
    }
  }
  const connected = await discoverExternalTools(normalized, AbortSignal.timeout(30_000))
  try {
    return {
      name: normalized.name,
      tools: connected.tools.map((item: any) => ({
        name: item.name,
        description: item.description,
        inputSchema: item.schema,
      })),
    }
  } finally {
    await connected.adapter.close()
  }
}

export async function buildMcpTools(signal: AbortSignal) {
  const tools: Record<string, any> = {}
  const clients: Array<{ close: () => void | Promise<void> }> = []
  const failures: string[] = []
  for (const server of mcpServers().filter((item) => item.enabled)) {
    if (server.transport === 'builtin' && server.builtin === 'didi') {
      if (!secret('didi')) continue
      const client = new DidiClient(secret('didi'))
      try {
        // oxlint-disable-next-line no-await-in-loop -- Initialize configured MCP services in order.
        const descriptors = await client.listTools(signal)
        clients.push(client)
        for (const descriptor of descriptors) {
          tools[toolName(server, descriptor.name)] = tool({
            description: `[滴滴 · 仅查询] ${descriptor.description}`,
            inputSchema: schemaToZod(descriptor.inputSchema),
            execute: (input: any) => client.callTool(descriptor.name, input, signal),
          })
        }
      } catch (error: any) {
        // oxlint-disable-next-line no-await-in-loop -- Close this failed connection before continuing.
        await client.close()
        failures.push(`滴滴: ${error.message}`)
      }
      continue
    }
    if (server.transport === 'builtin' && server.builtin === '12306') {
      for (const descriptor of builtinTools) {
        tools[toolName(server, descriptor.name)] = tool({
          description: `[${server.name}] ${descriptor.description || ''}`,
          execute: (input: any) => descriptor.execute(input, signal),
          inputSchema: schemaToZod(descriptor.inputSchema),
        })
      }
      continue
    }
    if (rollinggoService(server) && !secret('rollinggo')) continue
    if (isVariflight(server) && !secret('variflight')) continue
    let connected: Awaited<ReturnType<typeof discoverExternalTools>> | undefined
    try {
      // oxlint-disable-next-line no-await-in-loop -- MCP servers are initialized in configuration order.
      connected = await discoverExternalTools(server, signal)
      clients.push(connected.adapter)
      for (const external of connected.tools) {
        tools[toolName(server, external.name)] = wrapExternalTool(server, external)
      }
    } catch (error: any) {
      // oxlint-disable-next-line no-await-in-loop -- Close a failed connection before continuing.
      await connected?.adapter.close()
      failures.push(`${server.name}: ${error.message || String(error)}`)
    }
  }
  return {
    tools,
    failures,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    },
  }
}

export function mcpConfigId() {
  return randomUUID()
}
