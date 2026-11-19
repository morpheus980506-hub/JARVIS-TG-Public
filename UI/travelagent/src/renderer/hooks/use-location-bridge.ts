import { useEffect } from 'react'
import { LocationError } from '../../location'
import { api } from '../lib/api'
import { browserPosition } from '../lib/geolocation'

export function useLocationBridge() {
  useEffect(() => {
    const active = new Map<string, AbortController>()
    const unsubscribe = api.onLocationRequest((request) => {
      if (request.type === 'cancel') {
        active.get(request.id)?.abort()
        active.delete(request.id)
        return
      }
      if (active.has(request.id)) return
      const controller = new AbortController()
      active.set(request.id, controller)
      void browserPosition(navigator.geolocation, controller.signal)
        .then(
          (position) => {
            if (!controller.signal.aborted)
              return api.locationResponse(request.id, { ok: true, position })
          },
          (error) => {
            if (!controller.signal.aborted)
              return api.locationResponse(request.id, {
                ok: false,
                code: error instanceof LocationError ? error.code : 'unavailable',
              })
          },
        )
        .catch(() => {})
        .finally(() => active.delete(request.id))
    })
    return () => {
      unsubscribe()
      for (const controller of active.values()) controller.abort()
    }
  }, [])
}
