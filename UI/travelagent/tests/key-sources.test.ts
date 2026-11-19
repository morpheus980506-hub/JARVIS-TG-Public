import assert from 'node:assert/strict'
import test from 'node:test'
import { keySources } from '../src/backend/key-sources'

const defaults = {
  deepseek: 'demo-key',
  model: '',
  review: '',
  didi: 'demo-didi',
}
test('signed-in demo presets expose account ownership', () => {
  const sources = keySources(defaults, defaults, true)
  assert.equal(sources.deepseek.kind, 'account')
  assert.equal(sources.didi.kind, 'account')
})
test('custom overrides, signed-out presets and missing effective keys have distinct sources', () => {
  const sources = keySources({ ...defaults, deepseek: 'custom', didi: '' }, defaults, true)
  assert.equal(sources.deepseek.kind, 'custom')
  assert.equal(sources.didi.kind, 'none')
  assert.equal(keySources(defaults, defaults, false).deepseek.kind, 'demo')
})
