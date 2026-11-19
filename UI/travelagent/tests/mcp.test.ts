import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultMcpServers, normalizeServer, testMcpServer } from '../src/backend/mcp'

test('MCP defaults include the built-in 12306 server and normalize stdio config', () => {
  assert.deepEqual(
    defaultMcpServers().map((server) => server.id),
    ['builtin-variflight', 'builtin-rollinggo-hotel', 'builtin-12306', 'builtin-didi'],
  )
  const value = normalizeServer({
    id: 'weather',
    name: 'Weather',
    transport: 'stdio',
    enabled: true,
    command: 'node',
    args: ['server.js'],
  })
  assert.equal(value.id, 'weather')
  assert.throws(
    () => normalizeServer({ id: 'bad id', name: 'Bad', transport: 'stdio', enabled: true }),
    /MCP 服务 ID/,
  )
})

test('built-in 12306 exposes station, ticket, transfer and route tools without network startup', async () => {
  const result = await testMcpServer(
    defaultMcpServers().find((server) => server.builtin === '12306')!,
  )
  assert.equal(result.tools.length, 8)
  assert.ok(result.tools.some((item) => item.name === 'get-interline-tickets'))
  assert.ok(result.tools.some((item) => item.name === 'get-train-route-stations'))
})
