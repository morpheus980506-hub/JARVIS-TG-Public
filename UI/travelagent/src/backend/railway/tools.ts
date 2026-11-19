/* oxlint-disable no-await-in-loop -- Transfer pages depend on the previous page's cursor. */
import { z } from 'zod'
import type { McpToolInfo } from '../../shared'
import { RailwayClient } from './client'
import { resolveEndpoint } from './stations'
import { filterTickets, matchesEndpoints, normalizeInterline, normalizeTicket } from './tickets'
import { chinaToday, validateBookingDate } from './time'

export type BuiltinTool = McpToolInfo & {
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>
}
const scope = z
  .enum(['auto', 'exact', 'city'])
  .default('auto')
  .describe('auto：裸城市名查询全市，具体站名/电报码精确查询；编码如需全市请显式 city')
const filters = {
  trainFilterFlags: z
    .string()
    .regex(/^[GCDZTKOFS]*$/)
    .default('')
    .describe('车型，可组合 G/C/D/Z/T/K/O；G 含城际，F 复兴号，S 智能动车组'),
  earliestStartTime: z.number().min(0).max(24).default(0),
  latestStartTime: z.number().min(0).max(24).default(24),
  sortFlag: z.enum(['', 'startTime', 'arriveTime', 'duration']).default('startTime'),
  sortReverse: z.boolean().default(false),
  limitedNum: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(20)
    .describe('结果上限，0 时也最多返回 100 条，并标记截断'),
  format: z.enum(['json', 'text', 'csv']).default('json'),
}
const queryFields = {
  date: z
    .string()
    .describe('北京时间乘车日 YYYY-MM-DD；相对日期先用 get-current-date 解析，限 15 天预售期'),
  fromStation: z.string().min(1),
  toStation: z.string().min(1),
  fromScope: scope,
  toScope: scope,
  ...filters,
}
const querySchema = z.object(queryFields)
const interlineSchema = z.object({
  ...queryFields,
  middleStation: z.string().default(''),
  middleScope: scope,
  showWZ: z.boolean().default(false),
})

const escapeCSV = (value: unknown) =>
  `"${(typeof value === 'string' ? value : JSON.stringify(value ?? null)).replaceAll('"', '""')}"`

function outputFormat(rows: unknown[], format: string) {
  if (format === 'json') return rows
  if (format === 'text')
    return (
      rows.map((row) => JSON.stringify(row)).join('\n') ||
      '无匹配记录；请结合 search_complete 判断搜索是否完整。'
    )
  const objects = rows as Record<string, unknown>[]
  const keys = [...new Set(objects.flatMap(Object.keys))]
  return [
    keys.map(escapeCSV).join(','),
    ...objects.map((row) => keys.map((key) => escapeCSV(row[key])).join(',')),
  ].join('\n')
}

export function createRailwayTools(
  client = new RailwayClient(),
  now = () => Date.now(),
): BuiltinTool[] {
  const register = <T extends z.ZodObject>(
    name: string,
    description: string,
    schema: T,
    run: (input: z.output<T>, signal: AbortSignal) => Promise<unknown>,
  ): BuiltinTool => ({
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { io: 'input' }),
    execute: async (input, signal) => {
      signal.throwIfAborted()
      const result = await run(schema.parse(input), signal)
      return {
        source: '12306',
        source_url: 'https://www.12306.cn/',
        queriedAt: new Date(now()).toISOString(),
        timezone: 'Asia/Shanghai',
        ...(result as object),
      }
    },
  })

  return [
    register(
      'get-current-date',
      '获取北京时间当前日期，用于解析明天、下周等相对日期。',
      z.object({}),
      async () => ({ date: chinaToday(now()) }),
    ),
    register(
      'get-stations-code-in-city',
      '按中文城市名列出全市车站及电报码。',
      z.object({ city: z.string().min(1) }),
      async ({ city }, signal) => {
        const stations = (await client.stations(signal)).filter((item) => item.city === city.trim())
        if (!stations.length) throw new Error('未找到该城市的车站')
        return { stations }
      },
    ),
    register(
      'get-station-code-of-citys',
      '获取城市代表站编码；用于全市查询时必须传 fromScope/toScope=city。多个城市用 | 分隔。',
      z.object({ citys: z.string().min(1) }),
      async ({ citys }, signal) => {
        const stations = await client.stations(signal)
        return {
          cities: citys
            .split('|')
            .slice(0, 20)
            .map((city) => {
              const endpoint = resolveEndpoint(stations, city, 'city')
              return { city: endpoint.name, station_code: endpoint.code, scope: 'city' }
            }),
        }
      },
    ),
    register(
      'get-station-code-by-names',
      '按具体站名查询电报码（精确站语义），多个站名用 | 分隔。',
      z.object({ stationNames: z.string().min(1) }),
      async ({ stationNames }, signal) => {
        const stations = await client.stations(signal)
        return {
          stations: stationNames
            .split('|')
            .slice(0, 20)
            .map((name) => {
              const endpoint = resolveEndpoint(stations, name, 'exact')
              return { station_name: endpoint.name, station_code: endpoint.code, scope: 'exact' }
            }),
        }
      },
    ),
    register(
      'get-station-by-telecode',
      '通过三位电报码查询车站名称、拼音及城市。',
      z.object({ stationTelecode: z.string().regex(/^[A-Za-z]{3}$/) }),
      async ({ stationTelecode }, signal) => {
        const station = (await client.stations(signal)).find(
          (item) => item.code === stationTelecode.toUpperCase(),
        )
        if (!station) throw new Error('未找到该电报码对应的车站')
        return { station }
      },
    ),
    register(
      'get-tickets',
      '查询直达车次、席别余票和接口返回的票价。明确区分城市/精确站，按乘车日计算跨夜日期；缺失票价为未知，不得虚构票价或余票。',
      querySchema,
      async (input, signal) => {
        validateBookingDate(input.date, now())
        const stations = await client.stations(signal)
        const from = resolveEndpoint(stations, input.fromStation, input.fromScope)
        const to = resolveEndpoint(stations, input.toStation, input.toScope)
        const rows = await client.direct(input.date, from.code, to.code, signal)
        const tickets = []
        let invalid = 0
        for (const raw of rows) {
          if (!from.codes.has(raw.from_station_telecode) || !to.codes.has(raw.to_station_telecode))
            continue
          try {
            const ticket = normalizeTicket(raw, input.date, stations)
            if (matchesEndpoints(ticket, from, to)) tickets.push(ticket)
          } catch {
            invalid++
          }
        }
        const unique = [
          ...new Map(
            tickets.map((ticket) => [
              `${ticket.train_no}/${ticket.from_station_telecode}/${ticket.to_station_telecode}`,
              ticket,
            ]),
          ).values(),
        ]
        const all = filterTickets(unique, { ...input, limitedNum: 0 })
        const selected = all.slice(0, input.limitedNum || 100)
        return {
          date: input.date,
          from_scope: from.scope,
          to_scope: to.scope,
          search_complete: invalid === 0,
          invalid_records: invalid,
          truncated: selected.length < all.length,
          total_matches: all.length,
          tickets: outputFormat(selected, input.format),
          ...(invalid ? { warning: '已剔除时序异常或跨境记录，不能据此断言无其他车次。' } : {}),
        }
      },
    ),
    register(
      'get-interline-tickets',
      '查询两段中转方案（最多读取 3 页），校验两端及两个换乘站，按历时推导跨午夜日期。search_complete=false 时不能断言无其他方案；跨站换乘保留两个站名。',
      interlineSchema,
      async (input, signal) => {
        validateBookingDate(input.date, now())
        const stations = await client.stations(signal)
        const from = resolveEndpoint(stations, input.fromStation, input.fromScope)
        const to = resolveEndpoint(stations, input.toStation, input.toScope)
        const middle = input.middleStation
          ? resolveEndpoint(stations, input.middleStation, input.middleScope)
          : undefined
        const params = new URLSearchParams({
          train_date: input.date,
          from_station_telecode: from.code,
          to_station_telecode: to.code,
          middle_station: middle?.code || '',
          result_index: '0',
          can_query: 'Y',
          isShowWZ: input.showWZ ? 'Y' : 'N',
          purpose_codes: '00',
          channel: 'E',
        })
        const records = new Map<string, NonNullable<ReturnType<typeof normalizeInterline>>>()
        const cursors = new Set(['0'])
        let more = true,
          pages = 0,
          invalid = 0
        while (more && pages < 3) {
          const page = await client.interlinePage(params, signal)
          pages++
          for (const raw of page.rows) {
            try {
              const item = normalizeInterline(raw, input.date, stations, from, to, middle)
              if (item)
                records.set(
                  item.ticketList
                    .map(
                      (ticket) =>
                        `${ticket.train_no}/${ticket.start_date}/${ticket.from_station_telecode}/${ticket.to_station_telecode}`,
                    )
                    .join('|'),
                  item,
                )
            } catch {
              invalid++
            }
          }
          more = page.more
          if (!more || cursors.has(String(page.next))) break
          cursors.add(String(page.next))
          params.set('result_index', String(page.next))
        }
        const all = filterTickets([...records.values()], { ...input, limitedNum: 0 })
        const selected = all.slice(0, input.limitedNum || 100)
        return {
          date: input.date,
          from_scope: from.scope,
          to_scope: to.scope,
          middle_scope: middle?.scope,
          search_complete: !more && invalid === 0,
          pages_read: pages,
          invalid_records: invalid,
          total_matches: all.length,
          truncated: selected.length < all.length,
          ...(more || invalid
            ? { warning: '候选未全部读取或部分记录校验失败，不能断言无其他中转方案。' }
            : {}),
          transfers: outputFormat(selected, input.format),
        }
      },
    ),
    register(
      'get-train-route-stations',
      '查询精确车次的经停站和日期。departDate 是列车始发运行日，不是中间站乘车日；优先使用余票结果的 train_no 和 start_train_date。',
      z.object({
        trainCode: z.string().regex(/^[A-Za-z]?\d{1,5}$/),
        trainNo: z
          .string()
          .regex(/^[A-Za-z0-9]+$/)
          .optional(),
        departDate: z.string(),
        format: z.enum(['json', 'text', 'csv']).default('json'),
      }),
      async ({ trainCode, trainNo, departDate, format }, signal) => {
        const origin = /^\d{8}$/.test(departDate)
          ? `${departDate.slice(0, 4)}-${departDate.slice(4, 6)}-${departDate.slice(6)}`
          : departDate
        const result = await client.route(trainCode, origin, signal, trainNo)
        return { ...result, stations: outputFormat(result.stations, format) }
      },
    ),
  ]
}
