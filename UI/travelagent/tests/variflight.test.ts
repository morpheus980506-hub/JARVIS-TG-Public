import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertVariflightQuery,
  variflightConnection,
  variflightReadTools,
} from '../src/backend/variflight'

test('VariFlight exposes only the verified aviation query tools', () => {
  assert.equal(variflightReadTools.length, 9)
  for (const name of variflightReadTools) assert.doesNotThrow(() => assertVariflightQuery(name))
  for (const name of [
    'createOrder',
    'payOrder',
    'cancelOrder',
    'monitorFlightPrice',
    'searchFlightsByDepArr_createOrder',
    'SEARCHFLIGHTSBYDEPARR',
    '__proto__',
  ]) {
    assert.throws(() => assertVariflightQuery(name), /仅允许航空数据查询/)
  }
  assert.throws(() => variflightConnection(''), /API Key/)
  const connection = variflightConnection('test-key')
  assert.equal(connection.url, 'https://ai.variflight.com/servers/aviation/mcp')
  assert.deepEqual(connection.headers, { 'X-API-Key': 'test-key' })
})
