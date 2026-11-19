import assert from 'node:assert/strict'
import test from 'node:test'
import { processDuration } from '../src/renderer/lib/process-summary'
import type { Message } from '../src/shared'

const message: Message = {
  id: 'reply',
  role: 'assistant',
  content: '最终答复',
  startedAt: 1000,
  completedAt: 148000,
  traces: [{ id: 'search', name: 'web_search', state: 'error', input: {} }],
}

test('completed process reports only its elapsed time', () => {
  assert.equal(processDuration(message, false, 999999), '用时 2分27秒')
})

test('live process uses the current time', () => {
  assert.equal(processDuration({ ...message, completedAt: undefined }, true, 6000), '用时 5秒')
})

test('legacy records do not invent elapsed time', () => {
  assert.equal(
    processDuration({ ...message, startedAt: undefined, completedAt: undefined }, false, 999999),
    '用时未知',
  )
})
