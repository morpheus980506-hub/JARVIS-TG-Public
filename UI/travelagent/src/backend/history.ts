import type { ModelMessage } from './agent-history-types'
/** Supply observations for interrupted calls before accepting the next user turn. */
export function repairInterruptedCalls(history: ModelMessage[]): ModelMessage[] {
  const pending = new Map<
    string,
    {
      toolCallId: string
      toolName: string
    }
  >()
  for (const message of history) {
    if (!Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (part.type === 'tool-call') {
        pending.set(part.toolCallId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
        })
      }
      if (part.type === 'tool-result') {
        pending.delete(part.toolCallId)
      }
    }
  }
  if (!pending.size) {
    return history
  }
  return [
    ...history,
    {
      content: [...pending.values()].map((call) => ({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'text',
          value:
            '上次工具调用已中止或应用已重启，执行结果未知。请先检查状态，不得假设命令已完成或自动重复执行。',
        },
      })),
      role: 'tool',
    },
  ]
}
