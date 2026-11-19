import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/services/tripPlaces.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const { hasTripStays, isTripPlace, itineraryRoute } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('legacy transport text cannot act as a city or an accommodation destination', () => {
  assert.equal(isTripPlace('骑自行车'), false)
  assert.equal(itineraryRoute('我在兰州新区', '骑自行车'), null)
  assert.equal(hasTripStays({ days: 2, destination: '骑自行车' }), false)
})

test('only multi-day trips with a destination show stays', () => {
  assert.equal(hasTripStays({ days: 1, destination: '兰州新区' }), false)
  assert.equal(hasTripStays({ days: 2, destination: '兰州新区' }), true)
})
