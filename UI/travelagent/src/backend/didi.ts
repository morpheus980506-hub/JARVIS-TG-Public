import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { version } from '../../package.json'
import type { McpToolInfo } from '../shared'

const ENDPOINT = 'https://mcp.didichuxing.com/mcp-servers'
export const didiReadTools: Readonly<Record<string, string>> = Object.freeze({
  taxi_estimate: '查询车型与预估价格，仅作出行参考，不创建订单',
  taxi_query_order: '查询已有订单状态，仅在用户要求时单次查询',
  taxi_get_driver_location: '查询已有订单的司机位置',
  maps_textsearch: '查询地点与坐标；查价和路线规划前先用此工具获取真实坐标',
  maps_regeocode: '查询坐标对应的地址',
  maps_place_around: '查询周边地点',
  maps_direction_driving: '查询驾车路线',
  maps_direction_transit: '查询公交地铁路线',
  maps_direction_walking: '查询步行路线',
  maps_direction_bicycling: '查询骑行路线',
})

export function assertDidiReadTool(name: string) {
  if (!Object.hasOwn(didiReadTools, name))
    throw new Error('滴滴仅允许查询：禁止创建、取消订单、生成打车链接及其他非白名单操作')
}

function queryData(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(/(?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s<>"']+/gi, '[链接已隐藏]')
  if (Array.isArray(value)) return value.map(queryData)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/link|url|trace_?id|phone|action|button/i.test(key))
        .map(([key, item]) => [key, queryData(item)]),
    )
  return value
}

export class DidiClient {
  private readonly client = new Client({ name: 'TravelAgent', version })
  private readonly lifetime = new AbortController()
  private connected = false
  private discovered = new Set<string>()

  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private error(error: unknown) {
    const text = error instanceof Error ? error.message : String(error)
    return new Error(
      this.key
        ? text
            .replaceAll(this.key, '[REDACTED]')
            .replaceAll(encodeURIComponent(this.key), '[REDACTED]')
        : text,
    )
  }

  private async connect(signal: AbortSignal) {
    signal.throwIfAborted()
    if (this.connected) return
    if (!this.key) throw new Error('请在设置 → MCP 服务中配置滴滴 API Key')
    const url = new URL(ENDPOINT)
    url.searchParams.set('key', this.key)
    const transport = new StreamableHTTPClientTransport(url, {
      fetch: async (target, options) => {
        if (options?.method && !['GET', 'POST'].includes(options.method))
          throw new Error('滴滴 MCP 仅允许查询协议请求')
        const address = new URL(String(target))
        if (
          address.origin + address.pathname !== ENDPOINT ||
          address.searchParams.get('key') !== this.key
        )
          throw new Error('禁止向非官方滴滴 MCP 地址发送请求')
        if (options?.method === 'POST') {
          const message = JSON.parse(String(options.body))
          if (
            !['initialize', 'notifications/initialized', 'tools/list', 'tools/call'].includes(
              message.method,
            )
          )
            throw new Error('滴滴 MCP 不允许此协议操作')
          if (message.method === 'tools/call') assertDidiReadTool(message.params?.name)
        }
        return this.fetcher(target, {
          ...options,
          redirect: 'error',
          signal: AbortSignal.any([
            this.lifetime.signal,
            signal,
            ...(options?.signal ? [options.signal] : []),
            AbortSignal.timeout(30_000),
          ]),
        })
      },
    })
    await this.client.connect(transport, { timeout: 20_000, signal })
    this.connected = true
  }

  async listTools(signal: AbortSignal): Promise<McpToolInfo[]> {
    try {
      await this.connect(signal)
      const tools: McpToolInfo[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        // oxlint-disable-next-line no-await-in-loop -- Tool pages depend on the preceding server cursor.
        const page = await this.client.listTools(cursor ? { cursor } : {}, {
          signal,
          timeout: 20_000,
        })
        for (const item of page.tools) {
          if (
            Object.hasOwn(didiReadTools, item.name) &&
            !tools.some((tool) => tool.name === item.name)
          )
            tools.push({
              name: item.name,
              description: `仅查询：${didiReadTools[item.name]}。禁止任何下单或订单变更。`,
              inputSchema: item.inputSchema,
            })
        }
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new Error('滴滴工具分页游标重复')
        if (cursor) cursors.add(cursor)
        if (cursors.size > 10) throw new Error('滴滴工具分页超出限制')
      } while (cursor)
      this.discovered = new Set(tools.map((item) => item.name))
      return tools
    } catch (error) {
      throw this.error(error)
    }
  }

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    // Keep this guard before connecting: forbidden operations must never reach the provider.
    assertDidiReadTool(name)
    signal.throwIfAborted()
    try {
      if (!this.discovered.has(name)) throw new Error('此滴滴查询工具未由当前服务提供')
      const result = await this.client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 30_000,
      })
      if (result.isError) throw new Error('滴滴查询未成功，请检查地点、参数或服务权限')
      if (name === 'taxi_estimate' && !result.structuredContent)
        throw new Error('滴滴预估未返回可核验的结构化数据')
      // Estimates may include ride links. Rebuild text from query data to hide these in both channels.
      const structuredContent = result.structuredContent
        ? queryData(result.structuredContent)
        : undefined
      return {
        ...result,
        ...(structuredContent
          ? {
              structuredContent,
              content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
            }
          : {}),
        source: '滴滴出行',
        queriedAt: new Date().toISOString(),
        queryOnly: true,
        ...(name === 'taxi_estimate'
          ? { priceKind: 'estimate', note: '预估价格，仅供参考；未创建订单。' }
          : {}),
      }
    } catch (error) {
      throw this.error(error)
    }
  }

  async close() {
    this.lifetime.abort()
    await this.client.close()
  }
}
