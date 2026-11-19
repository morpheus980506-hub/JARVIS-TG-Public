import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { api } from '@/lib/api'

export function usePanelWidth(
  panel: 'sidebar' | 'workbench',
  initial: number,
  min: number,
  max: number,
  ref: RefObject<PanelImperativeHandle | null>,
) {
  const [width, setWidth] = useState(initial)
  const interacted = useRef(false)
  useEffect(() => {
    const lifetime = new AbortController()
    void api.panelWidth(panel).then(
      (saved) => {
        if (
          lifetime.signal.aborted ||
          interacted.current ||
          typeof saved !== 'number' ||
          !Number.isFinite(saved)
        )
          return
        const next = Math.min(max, Math.max(min, Math.round(saved)))
        setWidth(next)
        if (!ref.current?.isCollapsed()) ref.current?.resize(next)
      },
      () => {},
    )
    return () => lifetime.abort()
  }, [panel, min, max, ref])
  const resize = useCallback(
    (next: number) => {
      const value = Math.min(max, Math.max(min, Math.round(next)))
      interacted.current = true
      setWidth(value)
      void api.panelWidth(panel, value).catch(() => {})
    },
    [panel, min, max],
  )
  return [width, resize] as const
}
