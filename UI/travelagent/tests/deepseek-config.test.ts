import assert from 'node:assert/strict'
import test from 'node:test'
import { DEEPSEEK_BASE_URL, deepseekProfile } from '../src/deepseek-config'

test('legacy providers reset to DeepSeek and discard custom headers and reasoning', () => {
  const result = deepseekProfile(
    {
      protocol: 'messages',
      baseURL: 'https://example.test',
      model: 'other',
      headers: { Authorization: 'old' },
      reasoningEffort: 'high',
    },
    'deepseek-flash',
  )
  assert.deepEqual(result, {
    protocol: 'messages',
    baseURL: DEEPSEEK_BASE_URL,
    model: 'deepseek-flash',
    headers: {},
  })
})
test('existing DeepSeek model IDs and effort survive while headers and endpoint aliases normalize', () => {
  const result = deepseekProfile(
    {
      protocol: 'chat',
      baseURL: 'https://api.deepseek.com/v1/',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      headers: { extra: 'old' },
    },
    'deepseek-flash',
  )
  assert.equal(result.model, 'deepseek-v4-pro')
  assert.equal(result.reasoningEffort, 'high')
  assert.equal(result.baseURL, DEEPSEEK_BASE_URL)
  assert.equal(result.protocol, 'messages')
  assert.deepEqual(result.headers, {})
})

test('existing official Messages profiles survive migration without accepting third-party endpoints', () => {
  for (const baseURL of [DEEPSEEK_BASE_URL, `${DEEPSEEK_BASE_URL}/`, `${DEEPSEEK_BASE_URL}/v1/`]) {
    const result = deepseekProfile(
      { protocol: 'messages', baseURL, model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      'deepseek-flash',
    )
    assert.equal(result.model, 'deepseek-v4-pro')
    assert.equal(result.reasoningEffort, 'max')
    assert.equal(result.baseURL, DEEPSEEK_BASE_URL)
  }
  assert.equal(
    deepseekProfile(
      { protocol: 'messages', baseURL: 'https://api.deepseek.com.evil.test', model: 'other' },
      'deepseek-flash',
    ).model,
    'deepseek-flash',
  )
})
