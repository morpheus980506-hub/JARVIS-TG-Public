import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observedTrip } from '../src/backend/trip'
import type { Trip } from '../src/shared'
const trip: Trip = {
  budget: [
    {
      label: '交通',
      amount: 0,
      kind: 'unknown',
      queriedAt: 'invented',
    },
    {
      label: '酒店',
      amount: 300,
      kind: 'estimate',
      queriedAt: 'invented',
    },
    {
      label: '公交',
      amount: 3,
      kind: 'quote',
      source: '高德',
      queriedAt: 'invented',
    },
  ],
  days: [],
  title: 'test',
}
test('unknown cost remains null and estimated costs have no query timestamp', () => {
  const result = observedTrip(trip, [])
  assert.equal(result.budget[0].amount, null)
  assert.equal(result.budget[1].queriedAt, undefined)
  assert.equal(result.budget[2].kind, 'estimate')
})
test('quote time is taken from real application tool output', () => {
  const time = '2026-11-05T05:00:00.000Z'
  const result = observedTrip(trip, [
    {
      content: '',
      id: 'a',
      role: 'assistant',
      traces: [
        {
          id: 'b',
          name: 'get_routes',
          input: {},
          state: 'done',
          output: {
            queriedAt: time,
          },
        },
      ],
    },
  ])
  assert.equal(result.budget[2].queriedAt, time)
  assert.equal(result.budget[2].kind, 'quote')
  assert.equal(trip.budget[2].queriedAt, 'invented')
})

test('12306 quotes retain the observed MCP query time while estimates stay unverified', () => {
  const time = '2026-11-07T10:00:00.000Z'
  const railwayTrip: Trip = {
    title: 'railway',
    days: [],
    budget: [
      { label: '火车票', amount: 54.5, kind: 'quote', source: '12306' },
      { label: '未知票价', amount: null, kind: 'unknown', source: '12306' },
    ],
  }
  const result = observedTrip(railwayTrip, [
    {
      id: 'assistant',
      role: 'assistant',
      content: '',
      traces: [
        {
          id: 'rail',
          name: 'mcp_builtin-12306_get-tickets',
          input: {},
          state: 'done',
          output: { queriedAt: time },
        },
      ],
    },
  ])
  assert.equal(result.budget[0].kind, 'quote')
  assert.equal(result.budget[0].queriedAt, time)
  assert.equal(result.budget[1].amount, null)
  assert.equal(result.budget[1].queriedAt, undefined)
})

test('DiDi price estimates cannot become confirmed budget quotes', () => {
  const result = observedTrip(
    {
      title: 'taxi',
      days: [],
      budget: [
        { label: '打车', amount: 30, source: '滴滴出行', kind: 'quote', queriedAt: 'invented' },
      ],
    },
    [],
  )
  assert.equal(result.budget[0].kind, 'estimate')
  assert.equal(result.budget[0].queriedAt, undefined)
})
