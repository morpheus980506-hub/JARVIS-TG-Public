import { modelEffort } from '../model-catalog'
import type { ModelInfo, Profile } from '../shared'

const catalogs = new Map<string, ModelInfo[]>()
function catalogModel(profile: Profile) {
  return catalogs.get(profile.baseURL)?.find((model) => model.id === profile.model)
}

export function modelReasoningEffort(profile: Profile) {
  return modelEffort(catalogModel(profile), profile.reasoningEffort)
}

export function modelAcceptsImages(profile: Profile) {
  return catalogModel(profile)?.inputModalities?.includes('image')
}
export function rememberModelCatalog(profile: Profile, models: ModelInfo[]) {
  catalogs.set(profile.baseURL, models)
  return models
}
export function modelContextWindow(profile: Profile) {
  return knownContextWindow(profile) ?? 65536
}

export function knownContextWindow(profile: Profile) {
  return catalogModel(profile)?.contextWindow
}
