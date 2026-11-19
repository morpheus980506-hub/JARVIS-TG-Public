// Wire fields and seat-price encoding follow Joooook/12306-mcp (MIT); see THIRD_PARTY_NOTICES.md.
import type { Endpoint, Station } from './stations'
import { addMinutes, calendar, clockPart, datePart, durationMinutes, formatDuration } from './time'

export type RawTicket = Record<string, string>
const ROW_KEYS = [
  'secret',
  'button_text_info',
  'train_no',
  'station_train_code',
  'start_station_telecode',
  'end_station_telecode',
  'from_station_telecode',
  'to_station_telecode',
  'start_time',
  'arrive_time',
  'lishi',
  'canWebBuy',
  'yp_info',
  'start_train_date',
  'train_seat_feature',
  'location_code',
  'from_station_no',
  'to_station_no',
  'is_support_card',
  'controlled_train_flag',
  'gg_num',
  'gr_num',
  'qt_num',
  'rw_num',
  'rz_num',
  'tz_num',
  'wz_num',
  'yb_num',
  'yw_num',
  'yz_num',
  'ze_num',
  'zy_num',
  'swz_num',
  'srrb_num',
  'yp_ex',
  'seat_types',
  'exchange_train_flag',
  'houbu_train_flag',
  'houbu_seat_limit',
  'yp_info_new',
  '40',
  '41',
  '42',
  '43',
  '44',
  '45',
  'dw_flag',
  '47',
  'stopcheckTime',
  'country_flag',
  'local_arrive_time',
  'local_start_time',
  '52',
  'bed_level_info',
  'seat_discount_info',
]
const SEATS: Record<string, [string, string]> = {
  '9': ['商务座', 'swz'],
  P: ['特等座', 'tz'],
  M: ['一等座', 'zy'],
  D: ['优选一等座', 'zy'],
  O: ['二等座', 'ze'],
  S: ['二等包座', 'ze'],
  '6': ['高级软卧', 'gr'],
  A: ['高级动卧', 'gr'],
  '4': ['软卧', 'rw'],
  I: ['一等卧', 'rw'],
  F: ['动卧', 'rw'],
  '3': ['硬卧', 'yw'],
  J: ['二等卧', 'yw'],
  '2': ['软座', 'rz'],
  '1': ['硬座', 'yz'],
  W: ['无座', 'wz'],
  H: ['其他', 'qt'],
}

export function parseTicketRow(row: string): RawTicket {
  const fields = row.split('|')
  if (fields.length < 33 || !fields[2] || !fields[3]) throw new Error('12306 余票记录格式异常')
  return Object.fromEntries(ROW_KEYS.map((key, index) => [key, fields[index] || '']))
}

export function ticketPrices(raw: RawTicket) {
  const encoded = raw.yp_info_new || raw.yp_info || ''
  if (!encoded || encoded.length % 10 !== 0) return []
  const prices = []
  for (let offset = 0; offset < encoded.length; offset += 10) {
    const block = encoded.slice(offset, offset + 10)
    if (!/^.[0-9]{9}$/.test(block)) continue
    const code = Number(block.slice(6)) >= 3000 ? 'W' : block[0]
    const seat = SEATS[code]
    if (!seat) continue
    prices.push({
      seat_name: seat[0],
      seat_type_code: code,
      price: Number(block.slice(1, 6)) / 10,
      num: raw[`${seat[1]}_num`] || null,
    })
  }
  return prices
}

export function normalizeTicket(raw: RawTicket, date: string, stations: Station[]) {
  if (
    (raw.country_flag && !['0', 'CHN,CHN'].includes(raw.country_flag)) ||
    (raw.local_start_time && raw.local_start_time !== raw.start_time) ||
    (raw.local_arrive_time && raw.local_arrive_time !== raw.arrive_time)
  )
    throw new Error('暂不支持跨境或跨时区车次')
  if (
    !raw.train_no ||
    !raw.station_train_code ||
    !/^[A-Z]{3}$/.test(raw.from_station_telecode) ||
    !/^[A-Z]{3}$/.test(raw.to_station_telecode)
  )
    throw new Error('车次或站点信息异常')
  const departure = calendar(date, raw.start_time)
  const minutes = durationMinutes(raw.lishi)
  const arrival = addMinutes(departure, minutes)
  if (clockPart(arrival) !== raw.arrive_time) throw new Error('列车历时与到达时刻不一致')
  return {
    train_no: raw.train_no,
    start_train_code: raw.station_train_code,
    start_train_date: raw.start_train_date,
    start_date: date,
    arrive_date: datePart(arrival),
    start_time: raw.start_time,
    arrive_time: raw.arrive_time,
    lishi: formatDuration(minutes),
    from_station:
      stations.find((item) => item.code === raw.from_station_telecode)?.name ||
      raw.from_station_name ||
      raw.from_station_telecode,
    to_station:
      stations.find((item) => item.code === raw.to_station_telecode)?.name ||
      raw.to_station_name ||
      raw.to_station_telecode,
    from_station_telecode: raw.from_station_telecode,
    to_station_telecode: raw.to_station_telecode,
    seats: Object.fromEntries(
      [...new Set(Object.values(SEATS).map(([, short]) => short))].map((short) => [
        short,
        raw[`${short}_num`] || null,
      ]),
    ),
    prices: ticketPrices(raw),
    price_note: '仅列出接口返回的人民币票价，缺失票价为未知，不按 0 元计算。',
    dw_flag: (raw.dw_flag || '').split('#'),
  }
}
export type Ticket = ReturnType<typeof normalizeTicket>

export function matchesEndpoints(ticket: Ticket, from: Endpoint, to: Endpoint) {
  return from.codes.has(ticket.from_station_telecode) && to.codes.has(ticket.to_station_telecode)
}

export type RawInterline = {
  fullList: RawTicket[]
  wait_time_minutes: number
  all_lishi_minutes: number
  train_date: string
  middle_date: string
  arrive_date: string
  start_time: string
  arrive_time: string
}
export function normalizeInterline(
  raw: RawInterline,
  date: string,
  stations: Station[],
  from: Endpoint,
  to: Endpoint,
  middle?: Endpoint,
) {
  if (
    !Array.isArray(raw.fullList) ||
    raw.fullList.length !== 2 ||
    !Number.isInteger(raw.wait_time_minutes) ||
    raw.wait_time_minutes < 0 ||
    !Number.isInteger(raw.all_lishi_minutes) ||
    raw.all_lishi_minutes < 0
  )
    throw new Error('中转记录须包含两段车票及有效历时')
  const first = normalizeTicket(raw.fullList[0], date, stations)
  const start = calendar(date, first.start_time)
  const secondStart = addMinutes(start, durationMinutes(first.lishi) + raw.wait_time_minutes)
  const second = normalizeTicket(raw.fullList[1], datePart(secondStart), stations)
  const end = addMinutes(secondStart, durationMinutes(second.lishi))
  if (
    clockPart(secondStart) !== second.start_time ||
    raw.train_date !== date ||
    raw.middle_date !== second.start_date ||
    raw.arrive_date !== second.arrive_date ||
    raw.start_time !== first.start_time ||
    raw.arrive_time !== second.arrive_time ||
    (end - start) / 60_000 !== raw.all_lishi_minutes
  )
    throw new Error('中转时序与上游摘要不一致')
  if (
    !from.codes.has(first.from_station_telecode) ||
    !to.codes.has(second.to_station_telecode) ||
    (middle &&
      (!middle.codes.has(first.to_station_telecode) ||
        !middle.codes.has(second.from_station_telecode)))
  )
    return null
  // Even without an explicit middle endpoint, transfers must stay within one known city.
  const arrivalStation = stations.find((item) => item.code === first.to_station_telecode)
  const departureStation = stations.find((item) => item.code === second.from_station_telecode)
  if (
    first.to_station_telecode !== second.from_station_telecode &&
    (!arrivalStation?.city || arrivalStation.city !== departureStation?.city)
  )
    throw new Error('换乘站不在同一城市')
  return {
    start_date: date,
    start_time: first.start_time,
    arrive_date: second.arrive_date,
    arrive_time: second.arrive_time,
    middle_date: second.start_date,
    middle_arrival_station: first.to_station,
    middle_departure_station: second.from_station,
    same_station: first.to_station_telecode === second.from_station_telecode,
    same_train: first.train_no === second.train_no,
    wait_time_minutes: raw.wait_time_minutes,
    lishi: formatDuration(raw.all_lishi_minutes),
    start_train_code: first.start_train_code,
    dw_flag: first.dw_flag,
    ticketList: [first, second],
  }
}

export type TicketFilters = {
  trainFilterFlags?: string
  earliestStartTime?: number
  latestStartTime?: number
  sortFlag?: string
  sortReverse?: boolean
  limitedNum?: number
}
type Sortable = Pick<
  Ticket,
  | 'start_time'
  | 'arrive_time'
  | 'start_date'
  | 'arrive_date'
  | 'lishi'
  | 'start_train_code'
  | 'dw_flag'
>
export function filterTickets<T extends Sortable>(tickets: T[], filters: TicketFilters) {
  let result = tickets.filter((item) => {
    const time = durationMinutes(item.start_time) / 60
    if (time < (filters.earliestStartTime ?? 0) || time >= (filters.latestStartTime ?? 24))
      return false
    return (
      !filters.trainFilterFlags ||
      [...filters.trainFilterFlags].some((flag) => {
        if (flag === 'G') return /^[GC]/.test(item.start_train_code)
        if (flag === 'O') return !/^[GCDZTK]/.test(item.start_train_code)
        if (flag === 'F') return item.dw_flag[1] === '1'
        if (flag === 'S') return item.dw_flag[0] === '5'
        return item.start_train_code.startsWith(flag)
      })
    )
  })
  const sortValue = (item: T) =>
    filters.sortFlag === 'duration'
      ? durationMinutes(item.lishi)
      : filters.sortFlag === 'arriveTime'
        ? calendar(item.arrive_date, item.arrive_time)
        : calendar(item.start_date, item.start_time)
  if (filters.sortFlag)
    result.sort(
      (left, right) => (sortValue(left) - sortValue(right)) * (filters.sortReverse ? -1 : 1),
    )
  if (filters.limitedNum) result = result.slice(0, filters.limitedNum)
  return result
}
