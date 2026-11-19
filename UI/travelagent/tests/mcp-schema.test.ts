import assert from 'node:assert/strict'
import test from 'node:test'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { bindAgentTools, parseToolInput, toolSchemaSize } from '../src/backend/agent-tools'
import { wrapExternalTool } from '../src/backend/mcp'
import { builtinMcpServers } from '../src/mcp-config'

test('MCP JSON Schema survives budgeting, model binding, validation and invocation', async () => {
  let calls = 0
  let receivedSignal: AbortSignal | undefined
  const schema = {
    type: 'object' as const,
    properties: {
      count: { type: 'integer' as const, minimum: 1 },
      detail: {
        anyOf: [{ type: 'string' as const, enum: ['summary', 'full'] }, { type: 'null' as const }],
      },
    },
    required: ['count'],
    additionalProperties: false,
  }
  const external = new DynamicStructuredTool({
    name: 'searchFlightsByDepArr',
    description: 'Test query',
    schema,
    func: async (args, _manager, config) => {
      calls++
      receivedSignal = config?.signal
      return args
    },
  })
  const descriptor = wrapExternalTool(
    builtinMcpServers.find((s) => s.builtin === 'variflight')!,
    external,
  )
  assert.equal(descriptor.inputSchema, external.schema)
  const tools = {
    query: descriptor,
    local: { inputSchema: z.object({ text: z.string() }), execute: () => null },
  }
  assert.ok(toolSchemaSize(tools) > 0)
  assert.deepEqual(bindAgentTools(tools)[0].schema, schema)
  await Promise.all(
    [
      {},
      { count: 0 },
      { count: 1.5 },
      { count: 1, detail: 'invalid' },
      { count: 1, extra: true },
    ].map((input) => assert.rejects(() => parseToolInput(descriptor, input))),
  )
  assert.equal(calls, 0)
  const input = await parseToolInput(descriptor, { count: 1, detail: null })
  const controller = new AbortController()
  const output = await descriptor.execute(input, { abortSignal: controller.signal })
  assert.equal(calls, 1)
  assert.equal(receivedSignal, controller.signal)
  assert.deepEqual(output.data, input)
  assert.equal(output.source, 'VariFlight 飞常准')
  assert.ok(Number.isFinite(Date.parse(output.queriedAt)))
  assert.deepEqual(await parseToolInput(tools.local, { text: 'valid' }), { text: 'valid' })
  await assert.rejects(() => parseToolInput(tools.local, { text: 1 }))
})

test('MCP wrapper rejects forbidden tools before invoking the remote service', async () => {
  let called = false
  await Promise.all(
    ['variflight', 'rollinggo-hotel'].map(async (builtin) => {
      const descriptor = wrapExternalTool(
        builtinMcpServers.find((s) => s.builtin === builtin)!,
        {
          name: 'createOrder',
          schema: { type: 'object', properties: {} },
          invoke: () => {
            called = true
          },
        },
      )
      await assert.rejects(() => descriptor.execute({}), /仅允许查询|仅允许航空数据查询/)
    }),
  )
  assert.equal(called, false)
})
