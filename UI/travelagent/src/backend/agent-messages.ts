import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { ModelMessage } from './agent-history-types'

/** Keep the persisted wire format compatible with existing sessions and message editing. */
export function toLangChainMessages(history: ModelMessage[]): BaseMessage[] {
  return history.flatMap((message): BaseMessage[] => {
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
    if (message.role === 'user') return [new HumanMessage(content)]
    if (message.role === 'system') return [new SystemMessage(content)]
    if (message.role === 'assistant') {
      const parts = Array.isArray(message.content) ? message.content : []
      return [
        new AIMessage({
          content:
            typeof message.content === 'string'
              ? content
              : parts.map((part) => {
                  if (part.type === 'text') return { type: 'text', text: part.text }
                  if (part.type === 'reasoning')
                    return {
                      type: 'thinking',
                      thinking: part.text,
                      signature: part.signature ?? '',
                    }
                  if (part.type === 'provider-content') return part.block
                  return {
                    type: 'tool_use',
                    id: part.toolCallId,
                    name: part.toolName,
                    input: part.input,
                  }
                }),
          tool_calls: parts
            .filter((part) => part.type === 'tool-call')
            .map((part) => ({
              id: part.toolCallId,
              name: part.toolName,
              args: part.input as Record<string, unknown>,
              type: 'tool_call' as const,
            })),
          additional_kwargs: Object.fromEntries(
            parts
              .filter((part) => part.type === 'reasoning')
              .map((part) => ['reasoning_content', part.text]),
          ),
        }),
      ]
    }
    return message.content.map(
      (part) =>
        new ToolMessage({
          tool_call_id: part.toolCallId,
          name: part.toolName,
          content: part.output.type === 'text' ? part.output.value : JSON.stringify(part.output),
        }),
    )
  })
}

export function fromAIMessage(message: AIMessage): ModelMessage {
  const content: Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string> = []
  const represented = new Set<string>()
  if (typeof message.content === 'string') {
    if (message.content) content.push({ type: 'text', text: message.content })
  } else {
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: String(block.text) })
      else if (block.type === 'thinking')
        content.push({
          type: 'reasoning',
          text: String(block.thinking),
          signature: typeof block.signature === 'string' ? block.signature : '',
        })
      else if (block.type === 'tool_use') {
        const call = message.tool_calls?.find((item) => item.id === block.id)
        if (!call?.id) throw new Error('模型返回的工具调用缺少有效 ID 或参数')
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
        })
        represented.add(call.id)
      } else content.push({ type: 'provider-content', block })
    }
  }
  // Legacy Chat sessions have reasoning_content rather than Anthropic thinking blocks.
  if (message.additional_kwargs.reasoning_content)
    content.unshift({
      type: 'reasoning',
      text: String(message.additional_kwargs.reasoning_content),
    })
  for (const call of message.tool_calls || []) {
    if (!call.id) throw new Error('模型返回的工具调用缺少 ID')
    if (!represented.has(call.id))
      content.push({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      })
  }
  return { role: 'assistant', content }
}
