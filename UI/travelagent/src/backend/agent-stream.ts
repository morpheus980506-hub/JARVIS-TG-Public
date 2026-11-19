import type { AIMessage } from '@langchain/core/messages'

/** Validate the accumulated Messages response before persisting or executing any calls. */
export function validateModelResponse(message: AIMessage) {
  if (message.invalid_tool_calls?.length) throw new Error('模型返回无效工具参数，请重试')
  const reason = message.response_metadata.stop_reason ?? message.additional_kwargs.stop_reason
  if (reason === 'max_tokens') throw new Error('单次模型输出达到长度上限，请继续对话')
  if (!reason) throw new Error('模型流式响应未完整结束，请重试')
}
