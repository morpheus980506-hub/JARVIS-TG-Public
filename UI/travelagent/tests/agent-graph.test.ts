import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AIMessage } from '@langchain/core/messages'
import { runAgentGraph } from '../src/backend/agent-graph'
test('model may continue past twenty steps and finish on its own', async () => {
  let calls = 0
  let tools = 0
  await runAgentGraph({
    signal: new AbortController().signal,
    model: async () =>
      new AIMessage({
        content: 'step',
        tool_calls: ++calls === 31 ? [] : [{ id: String(calls), name: 'test', args: {} }],
      }),
    tools: async () => {
      tools++
    },
  })
  assert.equal(tools, 30)
  assert.equal(calls, 31)
})
test('user cancellation prevents another model step', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(
    runAgentGraph({
      signal: controller.signal,
      model: async () => {
        calls++
        controller.abort()
        return new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'test', args: {} }] })
      },
      tools: async () => {
        throw new Error('must not execute after cancellation')
      },
    }),
    /abort/i,
  )
  assert.equal(calls, 1)
})

test('cancellation waits for active tool cleanup before allowing session reuse', async () => {
  const controller = new AbortController()
  let markStarted!: () => void
  let finishCleanup!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })
  let cleaned = false
  let settled = false
  const run = runAgentGraph({
    signal: controller.signal,
    model: async () =>
      new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'test', args: {} }] }),
    tools: async () => {
      markStarted()
      await cleanup
      cleaned = true
    },
  }).finally(() => {
    settled = true
  })
  const rejection = assert.rejects(run, /abort/i)
  await started
  controller.abort()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  finishCleanup()
  await rejection
  assert.equal(cleaned, true)
})
