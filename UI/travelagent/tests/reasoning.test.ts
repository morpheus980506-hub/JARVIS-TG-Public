import assert from 'node:assert/strict'
import test from 'node:test'
import { reasoningParameters } from '../src/backend/deepseek-model'
import type { Profile } from '../src/shared'

const profile: Profile = {
  protocol: 'messages',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  headers: {},
}
test('DeepSeek Messages toggles thinking and passes effort in output_config', () => {
  assert.deepEqual(reasoningParameters(profile), {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  })
  assert.deepEqual(reasoningParameters({ ...profile, reasoningEffort: 'none' }), {
    thinking: { type: 'disabled' },
  })
  assert.deepEqual(reasoningParameters({ ...profile, reasoningEffort: 'max' }), {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'max' },
  })
})
test('DeepSeek forwards catalog-defined effort values without a hardcoded strength list', () => {
  assert.deepEqual(reasoningParameters({ ...profile, reasoningEffort: 'future-effort' }), {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'future-effort' },
  })
})
