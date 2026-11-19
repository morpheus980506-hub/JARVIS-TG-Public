import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRollinggoQuery, rollinggoConnection } from '../src/backend/rollinggo'
import { builtinMcpServers } from '../src/mcp-config'

test('RollingGo permits only exact service-specific query names regardless of provider annotations', () => {
  const hotel = builtinMcpServers.find((server) => server.builtin === 'rollinggo-hotel')!
  for (const name of [
    'searchHotels',
    'getHotelDetail',
    'getHotelSearchTags',
    'getHotelStaticInfo',
  ]) {
    assert.doesNotThrow(() => assertRollinggoQuery(hotel, name))
  }
  for (const server of [hotel]) {
    for (const name of [
      'createOrder',
      'cancelOrder',
      'payOrder',
      'searchHotels_createOrder',
      'SEARCHHOTELS',
      '__proto__',
    ]) {
      assert.throws(() => assertRollinggoQuery(server, name), /仅允许查询/)
    }
    assert.throws(() => rollinggoConnection(server, ''), /API Key/)
    const connection = rollinggoConnection({ ...server, url: 'https://evil.example' }, 'test-key')
    assert.equal(connection.headers.Authorization, 'Bearer test-key')
    assert.ok(connection.url.startsWith('https://mcp.rollinggo.cn/mcp'))
  }
})
