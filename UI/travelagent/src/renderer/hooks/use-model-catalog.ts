import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelInfo } from '../../shared'
import { api } from '../lib/api'

export function useModelCatalog(enabled: boolean) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [failed, setFailed] = useState(false)
  const sequence = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++sequence.current
    setFailed(false)
    try {
      const values = await api.models()
      if (requestId === sequence.current) setModels(values)
    } catch {
      if (requestId === sequence.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const requestId = ++sequence.current
    const lifetime = new AbortController()
    void api
      .models()
      .then((values) => {
        if (!lifetime.signal.aborted && requestId === sequence.current) setModels(values)
      })
      .catch(() => {})
    return () => {
      lifetime.abort()
    }
  }, [enabled])

  return { models, failed, refresh }
}
