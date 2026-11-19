import { z } from 'zod'
import { parseStations, type Station } from './stations'
import { type RawInterline, parseTicketRow } from './tickets'
import { addMinutes, calendar, datePart } from './time'

const BASE = 'https://kyfw.12306.cn'
const number = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/).transform(Number),
])
const interlineSchema = z.object({
  fullList: z.array(z.record(z.string(), z.string())).length(2),
  wait_time_minutes: number,
  all_lishi_minutes: number,
  train_date: z.string(),
  middle_date: z.string(),
  arrive_date: z.string(),
  start_time: z.string(),
  arrive_time: z.string(),
})
type Session = { cookie: string; path: string; expires: number }

export function queryPath(value: string, kind: 'direct' | 'interline') {
  const normalized = value.startsWith('/') ? value : `/otn/${value}`
  const valid =
    kind === 'direct'
      ? /^\/otn\/leftTicket\/query[A-Za-z]*$/
      : /^\/(?:otn\/)?lcquery\/query[A-Za-z]*$/
  if (!valid.test(normalized)) throw new Error('12306 返回了无效的查询路径')
  return normalized
}

export class RailwayClient {
  private stationCache?: { value: Station[]; expires: number }
  private sessions: Partial<Record<'direct' | 'interline', Session>> = {}
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async get(url: string, signal: AbortSignal, cookie = '') {
    signal.throwIfAborted()
    const response = await this.fetcher(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: `${BASE}/otn/leftTicket/init`,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    })
    if (!response.ok) throw new Error(`12306 请求失败 (${response.status})`)
    return response
  }

  async stations(signal: AbortSignal) {
    if (this.stationCache && this.stationCache.expires > Date.now()) return this.stationCache.value
    const html = await (await this.get('https://www.12306.cn/index/', signal)).text()
    const match = /["']([^"']*\/station_name[^"']*\.js(?:\?[^"']*)?)["']/.exec(html)
    const url = match
      ? new URL(match[1], 'https://www.12306.cn/index/')
      : new URL('https://kyfw.12306.cn/otn/resources/js/framework/station_name.js')
    if (!['www.12306.cn', 'kyfw.12306.cn'].includes(url.hostname) || url.protocol !== 'https:')
      throw new Error('12306 返回了无效的车站数据地址')
    const value = parseStations(await (await this.get(url.href, signal)).text())
    this.stationCache = { value, expires: Date.now() + 12 * 60 * 60_000 }
    return value
  }

  private async initialize(signal: AbortSignal, kind: 'direct' | 'interline' = 'direct') {
    const cached = this.sessions[kind]
    if (cached && cached.expires > Date.now()) return cached
    const initPath = kind === 'direct' ? '/otn/leftTicket/init' : '/otn/lcQuery/init'
    const response = await this.get(`${BASE}${initPath}`, signal)
    const html = await response.text()
    const cookies = new Map<string, string>()
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0]
      const index = pair.indexOf('=')
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    const pattern =
      kind === 'direct'
        ? /\bCLeftTicketUrl\s*=\s*['"]([^'"]+)['"]/
        : /\blc_search_url\s*=\s*['"]([^'"]+)['"]/
    const discovered = pattern.exec(html)?.[1]
    if (!discovered) throw new Error('12306 查询初始化失败，请稍后重试')
    const session = {
      path: queryPath(discovered, kind),
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      expires: Date.now() + 10 * 60_000,
    }
    this.sessions[kind] = session
    return session
  }
  private async json(url: string, signal: AbortSignal, cookie = '') {
    const response = await this.get(url, signal, cookie)
    const data: unknown = await response.json().catch(() => {
      throw new Error('12306 返回非 JSON 响应，请稍后重试')
    })
    const envelope = z
      .object({ status: z.boolean(), data: z.unknown() })
      .passthrough()
      .safeParse(data)
    if (!envelope.success || !envelope.data.status)
      throw new Error('12306 查询失败或响应异常，不能据此判断无票')
    return envelope.data
  }

  async direct(date: string, from: string, to: string, signal: AbortSignal) {
    const session = await this.initialize(signal)
    const params = new URLSearchParams({
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': from,
      'leftTicketDTO.to_station': to,
      purpose_codes: 'ADULT',
    })
    let response = await this.json(`${BASE}${session.path}?${params}`, signal, session.cookie)
    if (typeof response.c_url === 'string') {
      session.path = queryPath(response.c_url, 'direct')
      response = await this.json(`${BASE}${session.path}?${params}`, signal, session.cookie)
    }
    const data = z.object({ result: z.array(z.string()) }).safeParse(response.data)
    if (!data.success) throw new Error('12306 余票数据格式异常，不能据此判断无票')
    return data.data.result.map(parseTicketRow)
  }

  async interlinePage(params: URLSearchParams, signal: AbortSignal) {
    const session = await this.initialize(signal, 'interline')
    const response = await this.json(`${BASE}${session.path}?${params}`, signal, session.cookie)
    const data = z
      .object({
        flag: z.literal(true),
        middleList: z.array(interlineSchema),
        can_query: z.enum(['Y', 'N']),
        result_index: number,
      })
      .safeParse(response.data)
    if (!data.success) throw new Error('12306 中转查询失败或响应异常，不能据此判断无方案')
    return {
      rows: data.data.middleList as RawInterline[],
      next: data.data.result_index,
      more: data.data.can_query === 'Y',
    }
  }

  async route(trainCode: string, originDate: string, signal: AbortSignal, trainNo?: string) {
    calendar(originDate)
    if (!trainNo) {
      const params = new URLSearchParams({
        keyword: trainCode,
        date: originDate.replaceAll('-', ''),
      })
      const response = await this.get(
        `https://search.12306.cn/search/v1/train/search?${params}`,
        signal,
      )
      const parsed = z
        .object({
          data: z.array(z.object({ train_no: z.string(), station_train_code: z.string() })),
        })
        .parse(await response.json())
      const matches = parsed.data.filter((item) =>
        trainAliases(item.station_train_code).includes(trainCode.toUpperCase()),
      )
      const unique = [...new Set(matches.map((item) => item.train_no))]
      if (unique.length !== 1)
        throw new Error('车次未精确匹配或存在歧义，请使用余票结果中的 train_no 与 start_train_date')
      trainNo = unique[0]
    }
    const session = await this.initialize(signal)
    const params = new URLSearchParams({
      'leftTicketDTO.train_no': trainNo,
      'leftTicketDTO.train_date': originDate,
      rand_code: '',
    })
    const response = await this.json(
      `${BASE}/otn/queryTrainInfo/query?${params}`,
      signal,
      session.cookie,
    )
    const parsed = z
      .object({
        data: z.array(
          z.object({
            station_name: z.string(),
            station_train_code: z.string(),
            start_time: z.string(),
            arrive_time: z.string(),
            arrive_day_diff: number,
            stopover_time: z.string().optional(),
          }),
        ),
      })
      .parse(response.data)
    const stations = parsed.data.map((item) => {
      const date = datePart(addMinutes(calendar(originDate), item.arrive_day_diff * 1440))
      const arriveDate = /^\d{2}:\d{2}$/.test(item.arrive_time) ? date : null
      const startDate = /^\d{2}:\d{2}$/.test(item.start_time)
        ? datePart(
            addMinutes(calendar(date), arriveDate && item.start_time < item.arrive_time ? 1440 : 0),
          )
        : null
      return Object.assign(item, {
        arrive_date: arriveDate,
        start_date: startDate,
        stopover_minutes:
          arriveDate && startDate
            ? (calendar(startDate, item.start_time) - calendar(arriveDate, item.arrive_time)) /
              60_000
            : null,
      })
    })
    return { train_no: trainNo, origin_date: originDate, stations }
  }
}

export const trainAliases = (value: string) => value.split(/[（(]/)[0].toUpperCase().split('/')
