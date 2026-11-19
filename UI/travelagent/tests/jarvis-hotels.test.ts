import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jarvisHotelSchema, searchJarvisHotels } from '../src/backend/jarvis-hotels'
import { saveHotelBudgetEntry } from '../src/hotel-budget'
import { applyAgentEvent } from '../src/renderer/lib/session-events'
import type { HotelLookup, Session } from '../src/shared'

test('hotel lookup uses both local providers and keeps undated results separate from quotes', async (t) => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    calls.push(input)
    const body = JSON.parse(String(init.body))
    assert.equal(body.city, '通化')
    assert.match(body.query, /通化站附近|通化火车站附近/)
    assert.match(body.query, /日期未定/)
    return Response.json({
      queried_at: '2026-11-16T00:00:00Z',
      items: input.endsWith('fliggy')
        ? [
            { title: '通化某酒店', url: 'https://router.feizhu.com/details', price_text: '¥300' },
            { title: '伪造链接', url: 'https://fliggy.com.example/details' },
          ]
        : [{ title: '通化某宾馆', url: 'https://www.meituan.com/details' }],
    })
  })
  const result = await searchJarvisHotels(
    { city: '通化', area: '通化火车站' },
    new AbortController().signal,
  )
  assert.deepEqual(calls, [
    'http://127.0.0.1:8000/api/v1/travel/search/fliggy',
    'http://127.0.0.1:8000/api/v1/travel/search/meituan',
  ])
  assert.deepEqual(
    result.sources.map(({ status, items }) => [status, items.length]),
    [
      ['ok', 1],
      ['ok', 1],
    ],
  )
  assert(!('quotedPrice' in result.sources[0].items[0]))
})

test('valid dates reach the platforms and one failure preserves the other result', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.match(String(init.body), /入住：2026-12-25；退房：2026-12-27/)
    if (input.endsWith('meituan'))
      return Response.json({ detail: { code: 'timeout' } }, { status: 504 })
    return Response.json({
      queried_at: '2026-11-16T00:00:00Z',
      items: [
        { title: '通化某酒店', url: 'https://router.feizhu.com/details', price_text: '¥300' },
      ],
    })
  })
  const result = await searchJarvisHotels(
    { city: '通化', checkIn: '2026-12-25', checkOut: '2026-12-27' },
    new AbortController().signal,
  )
  assert.equal(result.sources[0].items[0].quotedPrice, '¥300')
  assert.equal(result.sources[1].status, 'timeout')
  assert(!jarvisHotelSchema.safeParse({ city: '通化', checkIn: '2026-12-25' }).success)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

test(
  'streams the faster provider and verified location before the slower provider finishes',
  { timeout: 6000 },
  async (t) => {
    const slow = deferred<Response>()
    const verified = deferred<void>()
    const updates: HotelLookup[] = []
    t.mock.method(globalThis, 'fetch', (input: string) =>
      input.endsWith('meituan')
        ? slow.promise
        : Promise.resolve(
            Response.json({
              queried_at: '2026-11-16T00:00:00Z',
              items: [{ title: '通化某酒店', url: 'https://router.feizhu.com/details' }],
            }),
          ),
    )
    const task = searchJarvisHotels(
      { city: '通化', area: '通化火车站' },
      new AbortController().signal,
      (lookup) => {
        updates.push(lookup)
        if (lookup.sources[0].items[0]?.distanceMeters !== undefined) verified.resolve()
      },
      async (keyword) =>
        keyword === '通化火车站'
          ? [{ name: '通化站', cityname: '通化市', location: '126,42' }]
          : [
              {
                name: '通化某酒店',
                cityname: '长春市',
                address: '异地地址',
                location: '126,42.001',
              },
              {
                name: '通化某酒店',
                cityname: '通化市',
                address: '已核对地址',
                location: '126,42.01',
              },
            ],
    )
    await verified.promise
    assert.equal(updates[0].sources[0].status, 'running')
    assert.equal(updates[1].sources[0].items[0].address, undefined)
    assert.equal(updates.at(-1)!.sources[1].status, 'running')
    assert.equal(updates.at(-1)!.sources[0].items[0].distanceMeters, 1112)
    slow.resolve(Response.json({ detail: { code: 'timeout' } }, { status: 504 }))
    const result = await task
    assert.equal(result.sources[0].items[0].address, '已核对地址')
    assert.equal(result.sources[1].status, 'timeout')
    const session: Session = {
      id: 'chat',
      history: [],
      title: '测试',
      updatedAt: 0,
      messages: [{ id: 'assistant', role: 'assistant', content: '' }],
    }
    const [patched] = applyAgentEvent([session], {
      type: 'hotels',
      sessionId: 'chat',
      messageId: 'assistant',
      hotelLookup: result,
    })
    const candidateId = result.sources[0].items[0].id
    patched.hotelBudget = saveHotelBudgetEntry(patched, result.id, candidateId, null)
    patched.hotelBudget = saveHotelBudgetEntry(patched, result.id, candidateId, 520)
    assert.equal(patched.hotelBudget.length, 1)
    assert.equal(patched.hotelBudget[0].amount, 520)
    assert.throws(() => saveHotelBudgetEntry(session, result.id, candidateId, 520), /找不到/)
  },
)
