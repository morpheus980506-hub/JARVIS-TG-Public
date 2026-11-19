import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAgentEvent } from '../src/renderer/lib/session-events'
import type { Session, Trace } from '../src/shared'

function session(id = 'chat'): Session {
  return {
    id,
    title: '旅行',
    messages: [{ id: 'answer', role: 'assistant', content: '中间说明', traces: [] }],
    history: [],
    updatedAt: 0,
  }
}

test('streamed progress stays in the process while the final answer accumulates independently', () => {
  const original = session()
  const unrelated = session('other')
  const progress = applyAgentEvent([original, unrelated], {
    sessionId: 'chat',
    type: 'progress',
    text: '正在查找地点',
  })
  const answer = applyAgentEvent(progress, { sessionId: 'chat', type: 'delta', text: '行程' })
  const complete = applyAgentEvent(answer, { sessionId: 'chat', type: 'delta', text: '已完成' })
  assert.equal(complete[0].messages[0].content, '行程已完成')
  assert.deepEqual(complete[0].messages[0].processNotes, ['正在查找地点'])
  assert.deepEqual(complete[0].messages[0].processSteps, [{ type: 'note', text: '正在查找地点' }])
  assert.equal(original.messages[0].content, '中间说明')
  assert.equal(progress[0].messages[0].content, '')
  assert.equal(complete[1], unrelated)
})

test('tool updates replace the same call without duplicating or mutating its earlier state', () => {
  const trace: Trace = { id: 'tool', name: 'search', state: 'running', input: {} }
  const running = applyAgentEvent([session()], { sessionId: 'chat', type: 'trace', trace })
  const finished = applyAgentEvent(running, {
    sessionId: 'chat',
    type: 'trace',
    trace: { ...trace, state: 'done', output: ['故宫'] },
  })
  assert.equal(finished[0].messages[0].traces?.length, 1)
  assert.equal(finished[0].messages[0].traces?.[0].state, 'done')
  assert.equal(running[0].messages[0].traces?.[0].state, 'running')
  assert.deepEqual(running[0].messages[0].processSteps, [{ type: 'trace', traceId: 'tool' }])
})

test('a restored transcript can receive a new assistant event after its last user message', () => {
  const original = session()
  original.messages = [{ id: 'question', role: 'user', content: '去北京' }]
  const next = applyAgentEvent([original], { sessionId: 'chat', type: 'delta', text: '好的' })
  assert.equal(next[0].messages.length, 2)
  assert.equal(next[0].messages[1].role, 'assistant')
  assert.equal(next[0].messages[1].content, '好的')
  assert.equal(original.messages.length, 1)
})
