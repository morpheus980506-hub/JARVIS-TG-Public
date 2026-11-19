import assert from 'node:assert/strict'
import test from 'node:test'
import { RailwayClient, queryPath, trainAliases } from '../src/backend/railway/client'
import { parseStations, resolveEndpoint } from '../src/backend/railway/stations'
import {
  normalizeTicket,
  normalizeInterline,
  parseTicketRow,
  ticketPrices,
  type RawTicket,
} from '../src/backend/railway/tickets'
import {
  addMinutes,
  calendar,
  chinaToday,
  datePart,
  validateBookingDate,
} from '../src/backend/railway/time'
import { createRailwayTools } from '../src/backend/railway/tools'

const stationJS = `var station_names ='@bjb|北京北|VAP|beijingbei|bjb|0|1|北京||
@bj|北京|BJP|beijing|bj|1|2|北京||@bjn|北京南|VNP|beijingnan|bjn|2|3|北京||
@bjft|北京丰台|FTP|beijingfengtai|bjft|3|4|北京||@tj|天津|TJP|tianjin|tj|4|5|天津||
@sh|上海|SHH|shanghai|sh|5|6|上海||@shhq|上海虹桥|AOH|shanghaihongqiao|shhq|6|7|上海||
@njn|南京南|NKH|nanjingnan|njn|7|8|南京||@nj|南京|NJH|nanjing|nj|8|9|南京||';`
const stations = parseStations(stationJS)
const signal = new AbortController().signal
const now = () => Date.parse('2026-10-05T10:00:00Z')
const ticket = (change: Partial<RawTicket> = {}): RawTicket => ({
  train_no: 'id-G65',
  station_train_code: 'G65',
  from_station_telecode: 'VNP',
  to_station_telecode: 'NKH',
  start_time: '19:50',
  arrive_time: '23:30',
  lishi: '03:40',
  start_train_date: '20261005',
  ...change,
})
const transfer = () => ({
  fullList: [
    ticket(),
    ticket({
      train_no: 'id-G4791',
      station_train_code: 'G4791',
      from_station_telecode: 'NKH',
      to_station_telecode: 'AOH',
      start_time: '00:10',
      arrive_time: '01:17',
      lishi: '01:07',
      start_train_date: '20261006',
    }),
  ],
  train_date: '2026-10-06',
  middle_date: '2026-10-07',
  arrive_date: '2026-10-07',
  start_time: '19:50',
  arrive_time: '01:17',
  wait_time_minutes: 40,
  all_lishi_minutes: 327,
})
const from = resolveEndpoint(stations, '北京南')
const to = resolveEndpoint(stations, '上海虹桥')
const middle = resolveEndpoint(stations, '南京南')

test('station records preserve names/cities and distinguish explicit codes from city scope', () => {
  assert.equal(stations[0].name, '北京北')
  assert.equal(resolveEndpoint(stations, '北京').codes.size, 4)
  assert.deepEqual([...resolveEndpoint(stations, 'BJP').codes], ['BJP'])
  assert.equal(resolveEndpoint(stations, 'BJP', 'city').codes.size, 4)
  assert.deepEqual([...resolveEndpoint(stations, '北京站', 'exact').codes], ['BJP'])
  assert.deepEqual([...resolveEndpoint(stations, '北京站').codes], ['BJP'])
  assert.deepEqual([...from.codes], ['VNP'])
  assert.throws(() => parseStations('garbage'), /格式异常/)
  assert.throws(() => resolveEndpoint(stations, '不存在'), /未找到/)
})

test('calendar arithmetic handles China midnight, leap days, month/year boundaries and invalid dates', () => {
  assert.equal(chinaToday(Date.parse('2026-12-31T16:01:00Z')), '2027-01-01')
  assert.equal(datePart(addMinutes(calendar('2024-02-28', '23:50'), 20)), '2024-02-29')
  assert.equal(datePart(addMinutes(calendar('2026-12-31', '23:50'), 20)), '2027-01-01')
  assert.throws(() => calendar('2026-02-29'), /无效/)
  assert.throws(() => calendar('2026-11-07', '24:00'), /无效/)
  assert.throws(() => validateBookingDate('2026-10-04', now()), /预售期/)
  assert.throws(() => validateBookingDate('2026-10-20', now()), /预售期/)
})

test('direct tickets use boarding date instead of origin date, with prices only from encoded payload', () => {
  const normalized = normalizeTicket(
    ticket({ start_time: '00:22', arrive_time: '02:05', lishi: '01:43' }),
    '2026-10-06',
    stations,
  )
  assert.equal(normalized.start_date, '2026-10-06')
  assert.equal(normalized.arrive_date, '2026-10-06')
  assert.equal(normalized.start_train_date, '20261005')
  assert.deepEqual(normalized.prices, [])
  assert.deepEqual(ticketPrices(ticket({ yp_info_new: 'O055300021', ze_num: '有' })), [
    { seat_name: '二等座', seat_type_code: 'O', price: 553, num: '有' },
  ])
  assert.deepEqual(ticketPrices(ticket({ yp_info_new: 'not-a-price' })), [])
  assert.throws(
    () => normalizeTicket(ticket({ country_flag: '1' }), '2026-10-06', stations),
    /跨境/,
  )
  const fields = Array(55).fill('')
  for (const [index, value] of Object.entries({
    2: 'id-G65',
    3: 'G65',
    6: 'VNP',
    7: 'NKH',
    8: '19:50',
    9: '23:30',
    10: '03:40',
    30: '有',
  }))
    fields[Number(index)] = value
  assert.equal(parseTicketRow(fields.join('|')).ze_num, '有')
  assert.throws(() => parseTicketRow('broken|row'), /格式异常/)
})

test('issue 72 transfer chronology derives both legs, retaining origin date and padded duration', () => {
  const result = normalizeInterline(transfer(), '2026-10-06', stations, from, to, middle)!
  assert.equal(result.middle_date, '2026-10-07')
  assert.equal(result.ticketList[1].start_date, '2026-10-07')
  assert.equal(result.ticketList[1].arrive_date, '2026-10-07')
  assert.equal(result.ticketList[1].start_train_date, '20261006')
  assert.equal(result.lishi, '05:27')
  const padded = transfer()
  padded.fullList[0] = ticket({ arrive_time: '23:08', lishi: '03:18' })
  padded.wait_time_minutes = 62
  // Same total: valid independent duration changes still preserve the computed arrival.
  assert.equal(normalizeInterline(padded, '2026-10-06', stations, from, to, middle)!.lishi, '05:27')
})

test('issue 72 checks actual first/last stations and both transfer endpoints', () => {
  const wrongDestination = transfer()
  wrongDestination.fullList[1].to_station_telecode = 'SHH'
  assert.equal(normalizeInterline(wrongDestination, '2026-10-06', stations, from, to, middle), null)
  const wrongOrigin = transfer()
  wrongOrigin.fullList[0].from_station_telecode = 'FTP'
  assert.equal(normalizeInterline(wrongOrigin, '2026-10-06', stations, from, to, middle), null)
  const crossStation = transfer()
  crossStation.fullList[1].from_station_telecode = 'NJH'
  assert.equal(normalizeInterline(crossStation, '2026-10-06', stations, from, to, middle), null)
  const cityResult = normalizeInterline(
    crossStation,
    '2026-10-06',
    stations,
    from,
    to,
    resolveEndpoint(stations, '南京'),
  )!
  assert.equal(cityResult.middle_arrival_station, '南京南')
  assert.equal(cityResult.middle_departure_station, '南京')
  assert.equal(cityResult.same_station, false)
})

test('transfer calendar handles leap/year rollover and formats five minutes as 05', () => {
  for (const [date, next] of [
    ['2024-02-28', '2024-02-29'],
    ['2026-12-31', '2027-01-01'],
  ]) {
    const raw = transfer()
    raw.train_date = date
    raw.middle_date = next
    raw.arrive_date = next
    raw.start_time = '23:50'
    raw.fullList[0] = ticket({ start_time: '23:50', arrive_time: '00:10', lishi: '00:20' })
    raw.fullList[1] = ticket({
      train_no: 'next',
      start_time: '00:30',
      arrive_time: '04:55',
      lishi: '04:25',
      from_station_telecode: 'NKH',
      to_station_telecode: 'AOH',
    })
    raw.arrive_time = '04:55'
    raw.wait_time_minutes = 20
    raw.all_lishi_minutes = 305
    const result = normalizeInterline(raw, date, stations, from, to, middle)!
    assert.equal(result.ticketList[1].start_date, next)
    assert.equal(result.ticketList[1].arrive_date, next)
    assert.equal(result.lishi, '05:05')
  }
})

test('transfer rejects inconsistent summaries, clocks, durations and additional legs', () => {
  for (const change of [
    { middle_date: '2026-10-06' },
    { all_lishi_minutes: 326 },
    { wait_time_minutes: -1 },
    { train_date: '2026-10-05' },
  ]) {
    assert.throws(() =>
      normalizeInterline({ ...transfer(), ...change }, '2026-10-06', stations, from, to, middle),
    )
  }
  const badClock = transfer()
  badClock.fullList[1].start_time = '00:11'
  assert.throws(
    () => normalizeInterline(badClock, '2026-10-06', stations, from, to, middle),
    /时刻不一致/,
  )
  assert.throws(
    () =>
      normalizeInterline(
        { ...transfer(), fullList: [ticket()] },
        '2026-10-06',
        stations,
        from,
        to,
        middle,
      ),
    /两段/,
  )
})

function mockClient() {
  const client = new RailwayClient()
  client.stations = async () => stations
  return client
}
function getTool(client: RailwayClient, name: string) {
  return createRailwayTools(client, now).find((item) => item.name === name)!
}

test('tool schemas keep defaulted filters optional for the model', () => {
  const schema = getTool(mockClient(), 'get-tickets').inputSchema as { required: string[] }
  assert.deepEqual(schema.required, ['date', 'fromStation', 'toStation'])
})

test('issue 72 filters wrong direct stations before sorting and limit, deduplicates and keeps metadata', async () => {
  const client = mockClient()
  client.direct = async () => [
    ticket({
      from_station_telecode: 'FTP',
      to_station_telecode: 'TJP',
      start_time: '00:22',
      arrive_time: '02:05',
      lishi: '01:43',
    }),
    ticket({
      to_station_telecode: 'TJP',
      start_time: '06:00',
      arrive_time: '06:30',
      lishi: '00:30',
    }),
    ticket({
      to_station_telecode: 'TJP',
      start_time: '06:00',
      arrive_time: '06:30',
      lishi: '00:30',
    }),
  ]
  const result = (await getTool(client, 'get-tickets').execute(
    { date: '2026-10-06', fromStation: 'VNP', toStation: 'TJP', limitedNum: 1 },
    signal,
  )) as any
  assert.equal(result.tickets.length, 1)
  assert.equal(result.tickets[0].from_station_telecode, 'VNP')
  assert.equal(result.tickets[0].start_date, '2026-10-06')
  assert.equal(result.total_matches, 1)
  assert.equal(result.source, '12306')
  assert.equal(result.queriedAt, new Date(now()).toISOString())
})

test('transfer pagination continues through an empty filtered page and applies limit after filtering', async () => {
  const client = mockClient()
  let calls = 0
  client.interlinePage = async (params) => {
    calls++
    if (calls === 1) {
      assert.equal(params.get('result_index'), '0')
      const wrong = transfer()
      wrong.fullList[1].to_station_telecode = 'SHH'
      return { rows: [wrong], more: true, next: 10 }
    }
    assert.equal(params.get('result_index'), '10')
    return { rows: [transfer(), transfer()], more: false, next: 20 }
  }
  const result = (await getTool(client, 'get-interline-tickets').execute(
    {
      date: '2026-10-06',
      fromStation: 'VNP',
      toStation: 'AOH',
      middleStation: 'NKH',
      limitedNum: 1,
    },
    signal,
  )) as any
  assert.equal(calls, 2)
  assert.equal(result.transfers.length, 1)
  assert.equal(result.search_complete, true)
  assert.equal(result.total_matches, 1)
})

test('bounded or repeated pagination and invalid chronology always report incomplete search', async () => {
  const client = mockClient()
  let calls = 0
  client.interlinePage = async () => ({ rows: [], more: true, next: ++calls })
  const tool = getTool(client, 'get-interline-tickets')
  const input = { date: '2026-10-06', fromStation: 'VNP', toStation: 'AOH' }
  const bounded = (await tool.execute(input, signal)) as any
  assert.equal(calls, 3)
  assert.equal(bounded.search_complete, false)
  client.interlinePage = async () => ({ rows: [], more: true, next: 0 })
  assert.equal(((await tool.execute(input, signal)) as any).pages_read, 1)
  client.interlinePage = async () => ({
    rows: [{ ...transfer(), middle_date: '2026-10-06' }],
    more: false,
    next: 1,
  })
  const invalid = (await tool.execute(input, signal)) as any
  assert.equal(invalid.search_complete, false)
  assert.equal(invalid.invalid_records, 1)
})

test('query errors are not reported as no tickets, and cancellation prevents requests', async () => {
  const client = mockClient()
  client.direct = async () => {
    throw new Error('service refused')
  }
  const tool = getTool(client, 'get-tickets')
  const input = { date: '2026-10-06', fromStation: 'VNP', toStation: 'TJP' }
  await assert.rejects(tool.execute(input, signal), /service refused/)
  await assert.rejects(tool.execute(input, AbortSignal.abort()), /abort/i)
  await assert.rejects(tool.execute({ ...input, date: '2026-02-30' }, signal), /无效/)
})

test('discovered query URLs are confined to official query paths and train aliases match exactly', () => {
  assert.equal(queryPath('leftTicket/queryG', 'direct'), '/otn/leftTicket/queryG')
  assert.equal(queryPath('/lcquery/queryG', 'interline'), '/lcquery/queryG')
  for (const path of ['https://evil.com', '/otn/../admin', '/lcquery/queryG?evil=1'])
    assert.throws(() => queryPath(path, 'interline'), /无效/)
  assert.deepEqual(trainAliases('G4794/G4791(郑州东-上海虹桥)'), ['G4794', 'G4791'])
  assert.equal(trainAliases('G10(北京-上海)').includes('G1'), false)
})

test('network client rejects HTML, failed upstream status and malformed transfer pages', async () => {
  for (const payload of [
    null,
    { status: false, data: {} },
    { status: true, data: { flag: false } },
  ]) {
    const fake: typeof fetch = async (url) => {
      if (String(url).endsWith('/init'))
        return new Response(
          "var CLeftTicketUrl='leftTicket/queryG'; var lc_search_url='/lcquery/queryG';",
        )
      return payload === null ? new Response('<html>blocked</html>') : Response.json(payload)
    }
    const client = new RailwayClient(fake)
    // oxlint-disable-next-line no-await-in-loop -- Each isolated fake client tests a distinct invalid response.
    await assert.rejects(client.interlinePage(new URLSearchParams(), signal), /12306/)
  }
})

test('route search selects an exact alias instead of the first prefix match and computes stop dates', async () => {
  const requests: string[] = []
  const fake: typeof fetch = async (url) => {
    requests.push(String(url))
    const value = new URL(String(url))
    if (value.pathname.endsWith('/search'))
      return Response.json({
        data: [
          { train_no: 'wrong', station_train_code: 'G10(北京-上海)' },
          { train_no: 'right', station_train_code: 'G4/G1(北京-上海)' },
        ],
      })
    if (value.pathname.endsWith('/init'))
      return new Response("var CLeftTicketUrl='leftTicket/queryG';", {
        headers: { 'Set-Cookie': 'sid=local; Path=/' },
      })
    assert.equal(value.searchParams.get('leftTicketDTO.train_no'), 'right')
    assert.equal(value.searchParams.get('leftTicketDTO.train_date'), '2026-12-31')
    return Response.json({
      status: true,
      data: {
        data: [
          {
            station_name: '中途站',
            station_train_code: 'G1',
            arrive_time: '23:58',
            start_time: '00:05',
            arrive_day_diff: '0',
          },
        ],
      },
    })
  }
  const result = await new RailwayClient(fake).route('G1', '2026-12-31', signal)
  assert.equal(result.train_no, 'right')
  assert.equal(result.stations[0].arrive_date, '2026-12-31')
  assert.equal(result.stations[0].start_date, '2027-01-01')
  assert.equal(requests.length, 3)
})

test('direct network discovery does not depend on the transfer service and forwards session cookies', async () => {
  let calls = 0
  const fake: typeof fetch = async (url, options) => {
    calls++
    if (String(url).endsWith('/leftTicket/init'))
      return new Response("var CLeftTicketUrl='leftTicket/queryG';", {
        headers: { 'Set-Cookie': 'sid=local; Path=/' },
      })
    assert.match(String(url), /\/otn\/leftTicket\/queryG\?/)
    assert.equal(new Headers(options?.headers).get('Cookie'), 'sid=local')
    return Response.json({ status: true, data: { result: [] } })
  }
  assert.deepEqual(await new RailwayClient(fake).direct('2026-10-06', 'VNP', 'TJP', signal), [])
  assert.equal(calls, 2)
})
