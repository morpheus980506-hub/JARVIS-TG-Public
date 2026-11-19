export function redactText(text: string, secrets: string[]) {
  for (const secret of secrets.filter(Boolean).toSorted((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[已隐藏密钥]')
  }
  return text
}

export function redactData<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') return redactText(value, secrets) as T
  if (Array.isArray(value)) return value.map((item) => redactData(item, secrets)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactData(item, secrets)]),
    ) as T
  }
  return value
}

/** Hold secret prefixes until the next chunk so split keys never reach the renderer. */
export function streamRedactor(secrets: string[]) {
  const keys = secrets.filter(Boolean).toSorted((a, b) => b.length - a.length)
  let pending = ''
  return (chunk: string, flush = false) => {
    pending += chunk
    let output = ''
    while (pending) {
      const match = keys.find((key) => pending.startsWith(key))
      if (match) {
        output += '[已隐藏密钥]'
        pending = pending.slice(match.length)
      } else if (!flush && keys.some((key) => key.startsWith(pending))) {
        break
      } else {
        output += pending[0]
        pending = pending.slice(1)
      }
    }
    return output
  }
}
