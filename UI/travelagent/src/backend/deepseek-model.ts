import { ChatAnthropic } from '@langchain/anthropic'
import type { Profile } from '../shared'
import { modelReasoningEffort } from './model-context'

class DeepSeekChatModel extends ChatAnthropic {
  protected override async createStreamWithRetry(
    ...args: Parameters<ChatAnthropic['createStreamWithRetry']>
  ) {
    const stream = await super.createStreamWithRetry(...args)
    const events = stream[Symbol.asyncIterator]()
    stream[Symbol.asyncIterator] = async function* () {
      for await (const event of { [Symbol.asyncIterator]: () => events }) {
        // ChatAnthropic uses the opening input counts and forwards the closing delta fields.
        // DeepSeek reports the authoritative input and output counts in the closing usage.
        yield event.type === 'message_delta'
          ? { ...event, delta: { ...event.delta, deepseekUsage: event.usage } }
          : event
      }
    }
    return stream
  }
}

export function deepSeekTokenUsage(
  finalUsage: unknown,
  fallback: import('@langchain/core/messages').AIMessageChunk['usage_metadata'],
) {
  if (finalUsage && typeof finalUsage === 'object' && 'input_tokens' in finalUsage) {
    const {
      input_tokens: uncached,
      cache_read_input_tokens: cached = 0,
      cache_creation_input_tokens: created = 0,
      output_tokens: output,
    } = finalUsage as Record<string, unknown>
    if (
      isTokenCount(uncached) &&
      isTokenCount(cached) &&
      isTokenCount(created) &&
      isTokenCount(output)
    ) {
      return {
        inputTokens: uncached + cached + created,
        outputTokens: output,
        cachedInputTokens: cached,
      }
    }
  }
  if (!fallback || !isTokenCount(fallback.input_tokens) || !isTokenCount(fallback.output_tokens))
    return
  const cached = fallback.input_token_details?.cache_read
  return {
    inputTokens: fallback.input_tokens,
    outputTokens: fallback.output_tokens,
    ...(isTokenCount(cached) && cached <= fallback.input_tokens && { cachedInputTokens: cached }),
  }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function createDeepSeekModel(profile: Profile, key: string, enableTitle = false) {
  if (!key) throw new Error('请先配置 DeepSeek API Key')
  const { thinking, output_config } = reasoningParameters(profile)
  return new DeepSeekChatModel({
    apiKey: key,
    model: profile.model,
    anthropicApiUrl: profile.baseURL,
    maxRetries: 0,
    maxTokens: 8192,
    ...(enableTitle && { invocationKwargs: { title: { enabled: true } } }),
    thinking,
    // DeepSeek effort values come from /models, rather than Claude's fixed union.
    outputConfig: output_config as NonNullable<
      ConstructorParameters<typeof ChatAnthropic>[0]
    >['outputConfig'],
  })
}

export function reasoningParameters(profile: Profile) {
  const effort = modelReasoningEffort(profile)
  return {
    thinking: { type: effort === 'none' ? ('disabled' as const) : ('adaptive' as const) },
    ...(effort === 'none' ? {} : { output_config: { effort } }),
  }
}
