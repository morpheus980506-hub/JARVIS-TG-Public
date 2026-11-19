import type { Profile } from './shared'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic'
export const DEEPSEEK_CATALOG_URL = 'https://api.deepseek.com/models'

/** Keep the selected DeepSeek model/effort, dropping legacy provider endpoints and headers. */
export function deepseekProfile(value: unknown, defaultModel: string): Profile {
  const profile = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const compatible =
    ['chat', 'messages'].includes(String(profile.protocol)) &&
    typeof profile.baseURL === 'string' &&
    /^https:\/\/api\.deepseek\.com(?:\/(?:v1|anthropic(?:\/v1)?))?\/?$/.test(profile.baseURL)
  return {
    protocol: 'messages',
    baseURL: DEEPSEEK_BASE_URL,
    headers: {},
    model:
      compatible && typeof profile.model === 'string' && profile.model.trim()
        ? profile.model
        : defaultModel,
    ...(compatible && typeof profile.reasoningEffort === 'string'
      ? { reasoningEffort: profile.reasoningEffort }
      : {}),
  }
}
