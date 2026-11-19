import { freshLocation, LocationError, type BrowserLocation } from '../../location'

export function browserPosition(
  geolocation: Geolocation | undefined,
  signal: AbortSignal,
): Promise<BrowserLocation> {
  signal.throwIfAborted()
  if (!geolocation) return Promise.reject(new LocationError('unavailable', '浏览器不支持定位'))
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (error?: unknown, position?: BrowserLocation) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(position!)
    }
    const abort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(new LocationError('timeout', '浏览器定位超时')), 18_000)
    signal.addEventListener('abort', abort, { once: true })
    try {
      geolocation.getCurrentPosition(
        (value) => {
          try {
            finish(
              undefined,
              freshLocation({
                latitude: value.coords.latitude,
                longitude: value.coords.longitude,
                accuracy: value.coords.accuracy,
                timestamp: value.timestamp,
              }),
            )
          } catch {
            finish(new LocationError('unavailable', '浏览器定位结果无效'))
          }
        },
        (error) =>
          finish(
            new LocationError(
              error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable',
              '浏览器定位失败',
            ),
          ),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      )
    } catch {
      finish(new LocationError('unavailable', '浏览器定位服务不可用'))
    }
  })
}
