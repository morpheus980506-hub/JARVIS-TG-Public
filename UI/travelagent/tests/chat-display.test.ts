import assert from 'node:assert/strict'
import test from 'node:test'
import { chatDisplay } from '../src/renderer/lib/chat-display'
import { processDuration } from '../src/renderer/lib/process-summary'
import type { Message } from '../src/shared'

test('questionnaire replies continue one timeline without counting the waiting interval', () => {
  const messages: Message[] = [
    { id: 'request', role: 'user', content: '规划周末旅行' },
    {
      id: 'ask',
      role: 'assistant',
      content: '先核对目的地。',
      startedAt: 1000,
      completedAt: 4000,
      traces: [{ id: 'tool', name: 'ask_user', input: {}, state: 'done' }],
      clarification: { questions: [{ question: '去哪儿？' }] },
    },
    { id: 'answer', role: 'user', content: '去哪儿？\n杭州', clarificationReplyTo: 'ask' },
    {
      id: 'followup',
      role: 'assistant',
      content: '这是杭州的安排。',
      startedAt: 20000,
      completedAt: 25000,
      traces: [{ id: 'tool', name: 'search_places', input: {}, state: 'done' }],
    },
    { id: 'normal', role: 'user', content: '还有别的建议吗？' },
  ]
  const projection = chatDisplay(messages)
  assert.deepEqual(
    projection.map(({ message }) => message.id),
    ['request', 'ask', 'normal'],
  )
  const { message, latestId, previousWorkMs } = projection[1]
  assert.equal(latestId, 'followup')
  assert.equal(message.content, '这是杭州的安排。')
  assert.deepEqual(message.processSteps, [
    { type: 'trace', traceId: 'ask:tool' },
    { type: 'note', text: '先核对目的地。' },
    { type: 'trace', traceId: 'followup:tool' },
  ])
  assert.equal(processDuration(message, false, 90000, previousWorkMs), '用时 8秒')
  assert.equal(messages[2].content, '去哪儿？\n杭州')
})
