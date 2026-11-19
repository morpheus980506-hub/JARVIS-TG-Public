import type { KeySource } from '../shared'

export function keySources(
  current: Record<string, string>,
  defaults: Record<string, string>,
  signedIn: boolean,
) {
  return Object.fromEntries(
    Object.keys(defaults).map((name) => {
      const value = current[name]
      const kind: KeySource['kind'] = !value
        ? 'none'
        : value === defaults[name]
          ? signedIn
            ? 'account'
            : 'demo'
          : 'custom'
      return [name, { kind }]
    }),
  ) as Record<string, KeySource>
}
