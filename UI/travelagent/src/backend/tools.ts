import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { HotelLookup } from '../shared'
import { defineTool as tool } from './agent-tools'
import { dataPath } from './data-directory'
import { jarvisHotelSchema, searchJarvisHotels } from './jarvis-hotels'
import { createLocationTool } from './location-tool'
import { amap, deepseekTool } from './network'
import { resolveFile } from './policy'
import { defaultWorkspace } from './store'
export const tripSchema = z.object({
  budget: z.array(
    z.object({
      label: z.string(),
      amount: z.number().nonnegative().nullable(),
      kind: z.enum(['quote', 'estimate', 'unknown']),
      source: z.string().optional(),
      queriedAt: z.string().optional(),
    }),
  ),
  days: z.array(
    z.object({
      date: z.string(),
      title: z.string(),
      items: z.array(
        z.object({
          time: z.string(),
          name: z.string(),
          description: z.string(),
          location: z.string().optional(),
          coordinateSystem: z.literal('GCJ-02').optional(),
          poiId: z.string().optional(),
        }),
      ),
    }),
  ),
  title: z.string(),
})
export async function listFiles(target: string, workspace = defaultWorkspace().path) {
  const dir = resolveFile(workspace, target)
  const entries = await fs.readdir(dir, {
    withFileTypes: true,
  })
  return {
    entries: entries.slice(0, 300).map((event) => ({
      name: event.name,
      directory: event.isDirectory(),
      link: event.isSymbolicLink(),
    })),
    path: dir,
  }
}
export async function readFile(
  target: string,
  start = 1,
  limit = 200,
  workspace = defaultWorkspace().path,
) {
  const file = resolveFile(workspace, target)
  const stat = await fs.stat(file)
  if (stat.size > 8 * 1024 * 1024) {
    throw new Error('文件超过 8 MB，请使用命令分段处理')
  }
  const text = await fs.readFile(file, 'utf8')
  if (text.includes('\0')) {
    throw new Error('请提供文本文件')
  }
  const lines = text.split(/\r?\n/)
  return {
    lines: lines.slice(start - 1, start - 1 + limit).join('\n'),
    path: file,
    start,
    totalLines: lines.length,
    truncated: start - 1 + limit < lines.length,
  }
}
export async function writeFile(
  target: string,
  content: string,
  workspace = defaultWorkspace().path,
) {
  const file = resolveFile(workspace, target)
  await fs.mkdir(path.dirname(file), {
    recursive: true,
  })
  let backup: string | undefined
  try {
    await fs.access(file)
    backup = dataPath('backups', crypto.randomUUID())
    await fs.mkdir(path.dirname(backup), {
      recursive: true,
    })
    await fs.copyFile(file, backup)
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, {
      force: true,
    })
  }
  return {
    backup,
    bytes: Buffer.byteLength(content),
    path: file,
  }
}
const define = (description: string, inputSchema: any, execute: any) =>
  tool({
    description,
    execute,
    inputSchema,
  })
export function buildTools(context: {
  signal: AbortSignal
  workspace: string
  command: (input: any) => Promise<any>
  publish: (trip: any) => any
  hotelUpdate?: (lookup: HotelLookup) => void
}) {
  return {
    get_current_location: createLocationTool(context.signal),
    get_routes: define(
      '高德市内路线。起终点格式 经度,纬度；公交须指定城市。出租车费是预估。',
      z.object({
        origin: z.string(),
        destination: z.string(),
        mode: z.enum(['walking', 'bicycling', 'driving', 'transit']),
        city: z.string().default(''),
      }),
      async (index: any) => {
        const endpoints: Record<string, string> = {
          walking: 'v3/direction/walking',
          bicycling: 'v4/direction/bicycling',
          driving: 'v5/direction/driving',
          transit: 'v3/direction/transit/integrated',
        }
        return amap(
          endpoints[index.mode],
          {
            origin: index.origin,
            destination: index.destination,
            city: index.city,
            cityd: index.city,
            show_fields: 'cost,polyline',
            extensions: 'all',
          },
          context.signal,
        )
      },
    ),
    list_files: define(
      '浏览本地目录。优先在工作区工作，允许访问工作区外。',
      z.object({
        path: z.string().default('.'),
      }),
      async ({ path: target }: any) => listFiles(target, context.workspace),
    ),
    place_details: define(
      '高德 POI 详情查询。',
      z.object({
        id: z.string(),
      }),
      async (index: any) => amap('v3/place/detail', index, context.signal),
    ),
    publish_trip: define(
      '将已核实或明确标注估算的行程发布到右侧面板。未知费用金额须为 null，不可虚构班次票价；地点 location 仅使用工具返回的 GCJ-02 高德坐标（经度,纬度），coordinateSystem 标为 GCJ-02；不得填入原始 WGS84。',
      tripSchema,
      async (index: any) => context.publish(index),
    ),
    read_file: define(
      '读取文本文件，支持绝对路径与相对工作区路径，分页读取。',
      z.object({
        path: z.string(),
        start: z.number().int().positive().default(1),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      async (index: any) => readFile(index.path, index.start, index.limit, context.workspace),
    ),
    run_command: define(
      '执行 PowerShell 命令，必须解释用途与影响；由独立 subagent 审查，危险操作由人工审批。',
      z.object({
        command: z.string().min(1),
        explanation: z.string().min(1),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(600000).default(120000),
      }),
      context.command,
    ),
    search_places: define(
      '高德地点搜索，返回真实 POI ID 和 GCJ-02 坐标。',
      z.object({
        keywords: z.string(),
        city: z.string().default(''),
      }),
      async (index: any) =>
        amap(
          'v3/place/text',
          {
            ...index,
            offset: '10',
            extensions: 'all',
          },
          context.signal,
        ),
    ),
    search_jarvis_hotels: define(
      '通过本机 JARVIS-TG 并行查询飞猪、美团酒店。按城市及区域找具体酒店；未知入住日期时仍可查名单，已知入住退房日期时可查报价。只读，返回各平台状态与详情链接。',
      jarvisHotelSchema,
      (input: z.infer<typeof jarvisHotelSchema>) =>
        searchJarvisHotels(
          input,
          context.signal,
          context.hotelUpdate,
          async (keywords, city, signal) => {
            const { pois } = await amap(
              'v3/place/text',
              { keywords, city, citylimit: 'true', offset: '5' },
              signal,
            )
            return Array.isArray(pois) ? pois : []
          },
        ),
    ),
    web_fetch: define(
      '使用 DeepSeek 抓取网页 Markdown 正文。',
      z.object({
        url: z
          .string()
          .url()
          .max(8192)
          .refine((session) => {
            const value = new URL(session)
            return (
              ['http:', 'https:'].includes(value.protocol) && !value.username && !value.password
            )
          }),
      }),
      async (input: any) => ({
        ...(await deepseekTool('fetch', input, context.signal)),
        url: input.url,
        fetchedAt: new Date().toISOString(),
      }),
    ),
    web_search: define(
      '使用 DeepSeek 搜索实时网页，结果有来源，按需抓取正文。',
      z.object({
        query: z
          .string()
          .min(1)
          .refine((session) => [...session].length <= 128 && !/^\s*$/.test(session)),
        count: z.number().int().min(1).max(50).default(5),
        need_content: z.boolean().default(false),
      }),
      async (input: any) => ({
        ...(await deepseekTool('search', input, context.signal)),
        queriedAt: new Date().toISOString(),
      }),
    ),
    write_file: define(
      '写入 UTF-8 文本，覆盖前自动备份；建议把产物放在工作区。',
      z.object({
        path: z.string(),
        content: z.string().max(2_000_000),
      }),
      async (index: any) => writeFile(index.path, index.content, context.workspace),
    ),
  }
}
