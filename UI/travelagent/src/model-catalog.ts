import { z } from 'zod'
import { DEEPSEEK_BASE_URL, DEEPSEEK_CATALOG_URL } from './deepseek-config'
import { DEFAULT_REASONING_EFFORT } from './reasoning'
import type { ModelInfo, Profile } from './shared'

export function modelCatalogURL(profile: Profile) {
  if (profile.baseURL.replace(/\/+$/, '') === DEEPSEEK_BASE_URL) return DEEPSEEK_CATALOG_URL
  const url = new URL(profile.baseURL)
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models'
  return url.href
}

export function parseModelCatalog(data: unknown): ModelInfo[] {
  const result = z
    .object({
      data: z.array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).nullish(),
          context_window: z.number().int().positive().nullish(),
          input_modalities: z.array(z.string()).nullish(),
          effort: z
            .object({
              supported_levels: z.array(z.string().min(1).max(64)),
              default_level: z.string().nullish(),
            })
            .nullish(),
        }),
      ),
    })
    .parse(data)
  const models = new Map<string, ModelInfo>()
  for (const item of result.data) {
    if (models.has(item.id)) continue
    models.set(item.id, {
      id: item.id,
      name: item.name ?? undefined,
      contextWindow: item.context_window ?? undefined,
      inputModalities: item.input_modalities ?? undefined,
      effort: item.effort
        ? {
            supportedLevels: [...new Set(item.effort.supported_levels)],
            defaultLevel: item.effort.default_level ?? undefined,
          }
        : undefined,
    })
  }
  return [...models.values()]
}

export function modelEfforts(model?: ModelInfo) {
  return [...new Set(['none', ...(model?.effort?.supportedLevels || [])])]
}

export function modelEffort(model?: ModelInfo, current = DEFAULT_REASONING_EFFORT) {
  if (!model) return current
  const choices = modelEfforts(model)
  if (choices.includes(current)) return current
  const fallback = model?.effort?.defaultLevel
  return fallback && choices.includes(fallback) ? fallback : 'none'
}

export function formatContext(tokens?: number) {
  if (!tokens) return ''
  if (tokens >= 1024 * 1024) return `${Number((tokens / (1024 * 1024)).toFixed(1))}M`
  if (tokens >= 1024) return `${Number((tokens / 1024).toFixed(1))}K`
  return String(tokens)
}
