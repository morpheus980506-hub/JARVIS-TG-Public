export const DEFAULT_REASONING_EFFORT = 'high'

export function effortLabel(effort: string) {
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}
