import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelMessage } from '../src/backend/agent-history-types'
import { repairInterruptedCalls } from '../src/backend/history'
test('interrupted tools receive an observation before resuming', () => {
  const history: ModelMessage[] = [
    {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'a',
          toolName: 'run_command',
          input: {},
        },
      ],
      role: 'assistant',
    },
  ]
  const repaired = repairInterruptedCalls(history)
  assert.equal(repaired.length, 2)
  assert.equal(repaired[1].role, 'tool')
  assert.equal(repairInterruptedCalls(repaired).length, 2)
})
