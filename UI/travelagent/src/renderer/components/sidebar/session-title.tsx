import { useEffect, useRef } from 'react'

const SCROLL_SPEED_PX_PER_SECOND = 64
const SCROLL_PAUSE_MS = 750
const SCROLL_CLEARANCE_PX = 12

export function SessionTitle({ title }: { title: string }) {
  const viewport = useRef<HTMLSpanElement>(null)
  const animation = useRef<Animation | undefined>(undefined)
  useEffect(() => {
    const element = viewport.current
    const text = element?.firstElementChild
    const row = element?.closest('li')
    if (!(element instanceof HTMLElement) || !(text instanceof HTMLElement) || !row) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const distanceToScroll = () =>
      Math.max(
        0,
        Math.ceil(text.getBoundingClientRect().width - element.clientWidth + SCROLL_CLEARANCE_PX),
      )
    const stop = () => {
      animation.current?.cancel()
      animation.current = undefined
    }
    const start = () => {
      stop()
      const distance = distanceToScroll()
      if (distance <= SCROLL_CLEARANCE_PX || reducedMotion.matches) return

      const travelMs = (distance / SCROLL_SPEED_PX_PER_SECOND) * 1000
      const duration = travelMs + SCROLL_PAUSE_MS
      const hold = SCROLL_PAUSE_MS / (2 * duration)
      animation.current = text.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: hold },
          { transform: `translateX(${-distance}px)`, offset: 1 - hold },
          { transform: `translateX(${-distance}px)`, offset: 1 },
        ],
        { duration, iterations: Infinity, direction: 'alternate', easing: 'linear' },
      )
    }
    const measure = () => {
      element.dataset.overflow = String(distanceToScroll() > SCROLL_CLEARANCE_PX)
      if (row.matches(':hover, :focus-within')) start()
    }
    const onPointerEnter = () => start()
    const onPointerLeave = () => {
      if (!row.matches(':focus-within')) stop()
    }
    const onFocusIn = () => start()
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return
      if (!row.matches(':hover')) stop()
    }

    row.addEventListener('pointerenter', onPointerEnter)
    row.addEventListener('pointerleave', onPointerLeave)
    row.addEventListener('focusin', onFocusIn)
    row.addEventListener('focusout', onFocusOut)
    reducedMotion.addEventListener('change', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(text)
    measure()

    return () => {
      observer.disconnect()
      row.removeEventListener('pointerenter', onPointerEnter)
      row.removeEventListener('pointerleave', onPointerLeave)
      row.removeEventListener('focusin', onFocusIn)
      row.removeEventListener('focusout', onFocusOut)
      reducedMotion.removeEventListener('change', measure)
      stop()
    }
  }, [])
  return (
    <span
      className="block overflow-hidden group-focus-within/session:mr-12 group-focus-within/session:[mask-image:linear-gradient(to_right,black_calc(100%_-_12px),transparent)] group-hover/session:mr-12 group-hover/session:[mask-image:linear-gradient(to_right,black_calc(100%_-_12px),transparent)] data-[overflow=true]:[mask-image:linear-gradient(to_right,black_calc(100%_-_12px),transparent)]"
      ref={viewport}
    >
      <span className="inline-block">{title}</span>
    </span>
  )
}
