// One shared reveal path handles both streaming chunks and a single final result.
export function createTypewriter(render: (text: string) => void) {
  let target = ''
  let shown = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveDone: (() => void) | undefined
  let stopped = false
  function tick() {
    timer = undefined
    if (stopped) return
    const chars = Array.from(target)
    shown = Math.min(chars.length, shown + Math.max(1, Math.min(12, Math.ceil((chars.length - shown) / 45))))
    render(chars.slice(0, shown).join(''))
    if (shown < chars.length) timer = setTimeout(tick, 16)
    else { resolveDone?.(); resolveDone = undefined }
  }
  function wake() { if (!timer && !stopped) timer = setTimeout(tick, 16) }
  return {
    append(chunk: string) { target += chunk; wake() },
    finish(text: string) {
      if(stopped)return Promise.resolve()
      target = text
      return new Promise<void>(resolve => {
        resolveDone?.()
        if (shown >= Array.from(target).length) { render(target); resolve(); return }
        resolveDone = resolve
        wake()
      })
    },
    stop() { stopped = true; clearTimeout(timer); resolveDone?.(); resolveDone = undefined },
  }
}
