import assert from 'node:assert/strict'
import test from 'node:test'
import { AIMessage } from '@langchain/core/messages'
import { createContextManager, contextSize } from '../src/backend/agent-context'
import type { ModelMessage } from '../src/backend/agent-history-types'
import { fromAIMessage, toLangChainMessages } from '../src/backend/agent-messages'
import { repairInterruptedCalls } from '../src/backend/history'
import { modelContextWindow, rememberModelCatalog } from '../src/backend/model-context'
import type { Profile } from '../src/shared'

test('LangChain round trip preserves reasoning and tool ids; legacy interrupted calls remain usable', () => {
  const original = new AIMessage({
    content: '查询中',
    additional_kwargs: { reasoning_content: 'private reasoning' },
    tool_calls: [{ id: 'call-1', name: 'query', args: { city: '上海' }, type: 'tool_call' }],
  })
  const history = repairInterruptedCalls([fromAIMessage(original)])
  const [reply, observation] = toLangChainMessages(history)
  assert.equal(reply.additional_kwargs.reasoning_content, 'private reasoning')
  assert.deepEqual((reply as AIMessage).tool_calls, original.tool_calls)
  assert.equal(observation.getType(), 'tool')
  assert.match(observation.text, /执行结果未知/)
})

test('context summarizes complete older turns, caches summary and never mutates stored history', async () => {
  let summaries = 0
  const manager = createContextManager({
    contextWindow: 32768,
    overhead: 1000,
    summarize: async (source) => {
      summaries++
      assert.match(source, /预算/)
      assert.ok(!source.includes('private reasoning'))
      return '用户预算 5000 元，目的地上海；还需确认出发日期。'
    },
  })
  const history: ModelMessage[] = [
    { role: 'user', content: '预算5000元。' + '历史内容'.repeat(6000) },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'private reasoning' },
        { type: 'text', text: '准备查询' },
      ],
    },
    { role: 'user', content: '查询上海' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: '1', toolName: 'query', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '1',
          toolName: 'query',
          output: { type: 'text', value: '来源：https://example.com；查询时间：今天' },
        },
      ],
    },
  ]
  const snapshot = structuredClone(history)
  const packed = await manager.prepare(history)
  assert.match(String(packed[0].content), /历史摘要/)
  assert.deepEqual(packed.slice(1), history.slice(2))
  await manager.prepare(history)
  assert.equal(summaries, 1)
  assert.deepEqual(history, snapshot)
  assert.ok(contextSize(packed) < 17000)
})

test('oversized tool observations retain head, tail and truncation notice; summary failure falls back', async () => {
  const manager = createContextManager({
    contextWindow: 32768,
    overhead: 1000,
    summarize: async () => {
      throw new Error('offline')
    },
  })
  const history: ModelMessage[] = [
    { role: 'user', content: '预算5000元' + '旧对话'.repeat(7000) },
    { role: 'assistant', content: '已记录' },
    { role: 'user', content: '继续查询' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'query', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a',
          toolName: 'query',
          output: { type: 'text', value: 'HEAD' + 'x'.repeat(60000) + 'TAIL' },
        },
      ],
    },
  ]
  const packed = await manager.prepare(history)
  assert.match(String(packed[0].content), /预算5000元/)
  const result = JSON.stringify(packed.at(-1))
  assert.match(result, /HEAD/)
  assert.match(result, /TAIL/)
  assert.match(result, /内容已截断/)
})

test('an oversized current turn fails explicitly instead of dropping the user request or tool pairs', async () => {
  const manager = createContextManager({
    contextWindow: 32768,
    overhead: 1000,
    summarize: async () => '',
  })
  await assert.rejects(
    manager.prepare([{ role: 'user', content: '大'.repeat(20000) }]),
    /当前轮次内容超过/,
  )
})

test('context budget uses catalog metadata for the selected endpoint and model with conservative fallback', () => {
  const profile: Profile = {
    protocol: 'messages',
    baseURL: 'https://context.example',
    model: 'test',
    headers: {},
  }
  assert.equal(modelContextWindow(profile), 65536)
  rememberModelCatalog(profile, [{ id: 'test', contextWindow: 1048576 }])
  assert.equal(modelContextWindow(profile), 1048576)
  assert.equal(modelContextWindow({ ...profile, model: 'unknown' }), 65536)
  assert.equal(modelContextWindow({ ...profile, baseURL: 'https://other.example' }), 65536)
})
