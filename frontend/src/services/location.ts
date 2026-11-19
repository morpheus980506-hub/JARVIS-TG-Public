export interface MapLocation {
  position: any
  accuracy: number
  timestamp: number
  source?: 'device' | 'manual'
}

// Browser coordinates are WGS84; convert before drawing on the AMap basemap.
export function locateOnMap(AMap: any, geolocation: (Pick<Geolocation, 'getCurrentPosition'> & Partial<Pick<Geolocation, 'watchPosition' | 'clearWatch'>>) | undefined, secure: boolean): Promise<MapLocation> {
  if (!secure) return Promise.reject(new Error('定位需要 HTTPS 或本机 localhost，请使用安全地址打开。'))
  if (!geolocation) return Promise.reject(new Error('当前浏览器不支持定位，请手动填写起点。'))
  return new Promise((resolve, reject) => {
    let finished = false
    let selected = false
    let watch: number | undefined
    let sampleTimer: ReturnType<typeof setTimeout> | undefined
    let best: GeolocationPosition | undefined
    function stopSampling() {
      clearTimeout(sampleTimer)
      if (watch !== undefined) geolocation?.clearWatch?.(watch)
    }
    const timer = setTimeout(() => fail('定位超时，请检查设备定位和网络后重试。'), 25000)
    function fail(message: string) {
      if (finished) return
      finished = true
      stopSampling()
      clearTimeout(timer)
      reject(new Error(message))
    }
    const convert = (result: GeolocationPosition) => {
      if (finished) return
      selected = true
      stopSampling()
      const { longitude, latitude, accuracy } = result.coords
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
        fail('设备返回了无效位置，请重新定位。')
        return
      }
      try {
        AMap.convertFrom([longitude, latitude], 'gps', (status: string, converted: any) => {
          if (finished) return
          if (status !== 'complete' || !converted.locations?.[0]) {
            fail('位置已获取，但地图坐标转换失败，请重试。')
            return
          }
          finished = true
          clearTimeout(timer)
          resolve({ position: converted.locations[0], accuracy: Number.isFinite(accuracy) ? Math.max(accuracy, 1) : 0, timestamp: result.timestamp, source: 'device' })
        })
      } catch {
        fail('地图坐标转换失败，请重新定位。')
      }
    }
    const failed = (reason: GeolocationPositionError) => {
      if (selected || finished) return
      if (best && reason.code !== 1) { convert(best); return }
      fail(reason.code === 1 ? '定位权限被拒绝。请在浏览器地址栏允许位置权限后重试，也可以手动填写起点。'
        : reason.code === 3 ? '定位超时，请检查设备定位和网络后重试。' : '暂时无法获取位置，请开启系统定位或手动填写起点。')
    }
    const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    try {
      if (geolocation.watchPosition && geolocation.clearWatch) {
        watch = geolocation.watchPosition(result => {
          if (finished || selected) return
          if (!best || result.coords.accuracy < best.coords.accuracy) best = result
          if (best.coords.accuracy <= 100) convert(best)
          else if (!sampleTimer) sampleTimer = setTimeout(() => { if (best) convert(best) }, 5000)
        }, failed, options)
        if (finished || selected) stopSampling()
      } else geolocation.getCurrentPosition(convert, failed, options)
    } catch { fail('浏览器无法发起定位，请检查权限或手动填写起点。') }
  })
}
