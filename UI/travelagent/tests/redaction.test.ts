import assert from 'node:assert/strict'
import test from 'node:test'
import { redactData, streamRedactor } from '../src/backend/redaction'

test('session redaction covers nested history, tool inputs and escaped characters', () => {
  const key = 'secret-"\\\n-value'
  const session = {
    messages: [{ content: key, traces: [{ input: { key } }] }],
    history: [{ content: [{ text: key }] }],
  }
  const clean = redactData(session, [key])
  assert.equal(clean.history[0].content[0].text, '[已隐藏密钥]')
  assert.equal(clean.messages[0].traces[0].input.key, '[已隐藏密钥]')
  assert.equal(session.messages[0].content, key)
})

test('streaming never emits a key split across any chunk boundary', () => {
  const key = 'sk-example-secret'
  for (let split = 1; split < key.length; split++) {
    const push = streamRedactor([key])
    const first = push('before ' + key.slice(0, split))
    assert.equal(first, 'before ')
    assert.equal(
      first + push(key.slice(split) + ' after') + push('', true),
      'before [已隐藏密钥] after',
    )
  }
})

test('streaming preserves ordinary text and flushes incomplete matches', () => {
  const push = streamRedactor(['secret', 'secret-long'])
  assert.equal(push('普通文本 se'), '普通文本 ')
  assert.equal(push('', true), 'se')
  assert.equal(push('secret-long'), '[已隐藏密钥]')
})
