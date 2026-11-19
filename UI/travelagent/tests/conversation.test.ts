import assert from 'node:assert/strict'
import test from 'node:test'
import { beforeEditedMessage } from '../src/conversation'
import type { Session } from '../src/shared'

const session: Session = {
  id: 'session',
  title: '手动标题',
  titleManual: true,
  updatedAt: 0,
  messages: [
    { id: 'u1', role: 'user', content: '原问题' },
    { id: 'a1', role: 'assistant', content: '先前答复' },
    { id: 'u2', role: 'user', content: '修改这里' },
    { id: 'a2', role: 'assistant', content: '过期答复' },
    { id: 'u3', role: 'user', content: '后续问题' },
  ],
  history: [
    { role: 'user', content: '原问题' },
    { role: 'assistant', content: [{ type: 'tool-call' }] },
    { role: 'tool', content: [{ type: 'tool-result' }] },
    { role: 'assistant', content: '先前答复' },
    { role: 'user', content: '修改这里' },
    { role: 'assistant', content: '过期答复' },
    { role: 'user', content: '后续问题' },
  ],
  trip: { title: '过期行程', days: [], budget: [] },
}

test('editing an earlier user turn preserves complete prior tool history and clears stale results', () => {
  const result = beforeEditedMessage(session, 'u2')
  assert.deepEqual(
    result.messages.map((message) => message.id),
    ['u1', 'a1'],
  )
  assert.deepEqual(result.history, session.history.slice(0, 4))
  assert.equal(result.trip, undefined)
  assert.equal(result.title, session.title)
  assert.equal(result.titleManual, true)
  assert.equal(session.messages.length, 5)
  assert.ok(session.trip)
})

test('editing the first message starts with an empty conversation', () => {
  const result = beforeEditedMessage(session, 'u1')
  assert.deepEqual(result.messages, [])
  assert.deepEqual(result.history, [])
})

test('assistant and missing message ids cannot be edited', () => {
  for (const id of ['a1', 'missing'])
    assert.throws(() => beforeEditedMessage(session, id), /不可编辑/)
})
