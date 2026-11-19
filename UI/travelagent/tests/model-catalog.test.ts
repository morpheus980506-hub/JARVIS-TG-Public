import assert from 'node:assert/strict'
import test from 'node:test'
import {
  modelCatalogURL,
  parseModelCatalog,
  modelEfforts,
  modelEffort,
  formatContext,
} from '../src/model-catalog'

test('model catalog retains provider path prefixes and removes trailing slashes', () => {
  for (const baseURL of ['https://example.test/v1', 'https://example.test/v1/']) {
    assert.equal(
      modelCatalogURL({ baseURL, protocol: 'messages', model: 'current', headers: {} }),
      'https://example.test/v1/models',
    )
  }
})

test('official Messages profiles use the DeepSeek model catalog outside the Anthropic prefix', () => {
  for (const baseURL of [
    'https://api.deepseek.com/anthropic',
    'https://api.deepseek.com/anthropic/',
  ]) {
    assert.equal(
      modelCatalogURL({ baseURL, protocol: 'messages', model: 'deepseek-flash', headers: {} }),
      'https://api.deepseek.com/models',
    )
  }
})

test('catalog uses actual returned ids and removes duplicate entries', () => {
  assert.deepEqual(
    parseModelCatalog({
      data: [{ id: 'model-a' }, { id: 'model-b', name: 'B' }, { id: 'model-a' }],
    }).map((model) => model.id),
    ['model-a', 'model-b'],
  )
  assert.throws(() => parseModelCatalog({ error: 'unauthorized' }))
  assert.throws(() => parseModelCatalog({ data: [{ id: '' }] }))
})

test('model metadata and effort options come from the API rather than a fixed list', () => {
  const [model] = parseModelCatalog({
    data: [
      {
        id: 'api-id',
        name: 'API Display Name',
        context_window: 1048576,
        effort: { supported_levels: ['low', 'new-level'], default_level: 'new-level' },
      },
    ],
  })
  assert.equal(model.name, 'API Display Name')
  assert.equal(model.contextWindow, 1048576)
  assert.deepEqual(modelEfforts(model), ['none', 'low', 'new-level'])
  assert.equal(modelEffort(model, 'max'), 'new-level')
  assert.equal(modelEffort(model), 'new-level')
  assert.equal(
    modelEffort({ ...model, effort: { supportedLevels: ['high', 'low'], defaultLevel: 'low' } }),
    'high',
  )
  assert.equal(modelEffort(model, 'low'), 'low')
  assert.equal(formatContext(model.contextWindow), '1M')
  assert.equal(formatContext(131072), '128K')
  assert.equal(formatContext(undefined), '')
  assert.deepEqual(modelEfforts(undefined), ['none'])
})
