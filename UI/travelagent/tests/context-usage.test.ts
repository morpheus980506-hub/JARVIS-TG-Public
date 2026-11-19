import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateContextBreakdown } from '../src/context-usage'

test('context estimates apportion observed input and include output only in messages', () => {
  assert.deepEqual(
    estimateContextBreakdown(10000, 200, {
      systemPrompt: 1500,
      toolDefinitions: 7500,
      messages: 1000,
    }),
    { systemPrompt: 1500, toolDefinitions: 7500, messages: 1200 },
  )
})

test('rounding keeps estimated sections equal to the actual input and output total', () => {
  const result = estimateContextBreakdown(13, 1, {
    systemPrompt: 1,
    toolDefinitions: 1,
    messages: 1,
  })!
  assert.deepEqual(result, { systemPrompt: 4, toolDefinitions: 4, messages: 6 })
  assert.equal(
    Object.values(result).reduce((total, value) => total + value, 0),
    14,
  )
})

test('missing size measurements do not fabricate a breakdown', () => {
  assert.equal(
    estimateContextBreakdown(100, 20, { systemPrompt: 0, toolDefinitions: 0, messages: 0 }),
    undefined,
  )
})
