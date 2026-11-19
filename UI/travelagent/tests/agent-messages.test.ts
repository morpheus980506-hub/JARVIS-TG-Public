import assert from 'node:assert/strict'
import test from 'node:test'
import { AIMessage } from '@langchain/core/messages'
import { fromAIMessage, toLangChainMessages } from '../src/backend/agent-messages'
import { validateModelResponse } from '../src/backend/agent-stream'

test('Messages history preserves thinking signatures, block order and multiple tool ids without duplicates', () => {
  const blocks = [
    { type: 'thinking', thinking: 'private thought', signature: 'opaque-signature' },
    { type: 'text', text: '查询中' },
    { type: 'tool_use', id: 'a', name: 'query', input: { city: '上海' } },
    { type: 'tool_use', id: 'b', name: 'query', input: { city: '杭州' } },
  ]
  const original = new AIMessage({
    content: blocks,
    tool_calls: [
      { id: 'a', name: 'query', args: { city: '上海' }, type: 'tool_call' },
      { id: 'b', name: 'query', args: { city: '杭州' }, type: 'tool_call' },
    ],
  })
  const stored = fromAIMessage(original)
  const [restored] = toLangChainMessages([stored])
  assert.deepEqual(restored.content, blocks)
  assert.deepEqual((restored as AIMessage).tool_calls, original.tool_calls)
  assert.equal(restored.text, '查询中')
  assert.ok(!restored.text.includes('private thought'))
})

test('unrecognized provider blocks survive persistence and reload', () => {
  const block = {
    type: 'web_search_tool_result',
    tool_use_id: 's',
    content: [
      {
        type: 'web_search_result',
        url: 'https://example.test',
        title: 'source',
        encrypted_content: 'opaque',
      },
    ],
  }
  const original = new AIMessage({ content: [block, { type: 'text', text: '完成' }] })
  assert.deepEqual(toLangChainMessages([fromAIMessage(original)])[0].content, original.content)
})

test('Messages stop reasons work for both non-streaming and streamed LangChain metadata', () => {
  validateModelResponse(
    new AIMessage({ content: '完成', response_metadata: { stop_reason: 'end_turn' } }),
  )
  validateModelResponse(
    new AIMessage({ content: '查询', additional_kwargs: { stop_reason: 'tool_use' } }),
  )
  for (const metadata of [
    { response_metadata: { stop_reason: 'max_tokens' } },
    { additional_kwargs: { stop_reason: 'max_tokens' } },
  ])
    assert.throws(
      () => validateModelResponse(new AIMessage({ content: '', ...metadata })),
      /长度上限/,
    )
  assert.throws(() => validateModelResponse(new AIMessage('partial')), /未完整结束/)
  assert.throws(
    () =>
      validateModelResponse(
        new AIMessage({
          content: '',
          additional_kwargs: { stop_reason: 'tool_use' },
          invalid_tool_calls: [{ name: 'query', args: '{', error: 'invalid JSON' }],
        }),
      ),
    /无效工具参数/,
  )
})
