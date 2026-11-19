import type { ContextUsage } from './shared'

/** Allocate the observed input total by request size; provider tokenization is not available. */
export function estimateContextBreakdown(
  inputTokens: number,
  outputTokens: number,
  sizes: { systemPrompt: number; toolDefinitions: number; messages: number },
): ContextUsage['estimatedBreakdown'] {
  const total = sizes.systemPrompt + sizes.toolDefinitions + sizes.messages
  if (total <= 0) return undefined
  const systemPrompt = Math.floor((inputTokens * sizes.systemPrompt) / total)
  const toolDefinitions = Math.floor((inputTokens * sizes.toolDefinitions) / total)
  return {
    systemPrompt,
    toolDefinitions,
    messages: inputTokens - systemPrompt - toolDefinitions + outputTokens,
  }
}
