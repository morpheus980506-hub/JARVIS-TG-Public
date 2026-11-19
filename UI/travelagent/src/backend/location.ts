import { freshLocation, LocationError, type BrowserLocation } from '../location'
import { windowsPosition } from './location-windows'
import { amap } from './network'

export interface LocationResult {
  position: BrowserLocation
  mapLocation?: string
  address?: string
  warning?: string
}

export async function resolveLocation(
  position: BrowserLocation,
  lookup: typeof amap = amap,
  parentSignal?: AbortSignal,
): Promise<LocationResult> {
  freshLocation(position)
  const result: LocationResult = { position }
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(parentSignal ? [parentSignal] : []),
  ])
  try {
    const converted = await lookup(
      'v3/assistant/coordinate/convert',
      {
        locations: `${position.longitude.toFixed(6)},${position.latitude.toFixed(6)}`,
        coordsys: 'gps',
      },
      signal,
    )
    if (
      typeof converted.locations !== 'string' ||
      !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(converted.locations)
    ) {
      throw new Error('高德未返回有效转换坐标')
    }
    const [longitude, latitude] = converted.locations.split(',').map(Number)
    freshLocation({ ...position, longitude, latitude })
    result.mapLocation = `${longitude.toFixed(6)},${latitude.toFixed(6)}`
    const resolved = await lookup(
      'v3/geocode/regeo',
      { location: result.mapLocation, extensions: 'base' },
      signal,
    )
    if (
      typeof resolved.regeocode?.formatted_address === 'string' &&
      resolved.regeocode.formatted_address.trim()
    ) {
      result.address = resolved.regeocode.formatted_address.slice(0, 500)
    } else throw new Error('高德未返回地址')
  } catch {
    parentSignal?.throwIfAborted()
    result.warning = '地址解析未完成，请确认出发城市；原始坐标仍可查看'
  }
  return result
}

let browserProvider: ((signal: AbortSignal) => Promise<BrowserLocation>) | undefined
export function setBrowserLocationProvider(provider: typeof browserProvider) {
  browserProvider = provider
}
export function requestBrowserPosition(signal: AbortSignal) {
  if (!browserProvider) throw new LocationError('unavailable', '浏览器定位尚未就绪')
  return browserProvider(signal)
}

export async function locateCurrentPosition(
  signal: AbortSignal,
  providers = {
    windows: windowsPosition,
    browser: requestBrowserPosition,
    resolve: resolveLocation,
  },
) {
  signal.throwIfAborted()
  let position: BrowserLocation
  let source: 'Windows 系统定位' | '浏览器 Geolocation' = 'Windows 系统定位'
  try {
    position = freshLocation(await providers.windows(signal))
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof LocationError && error.code === 'denied') throw error
    source = '浏览器 Geolocation'
    try {
      position = freshLocation(await providers.browser(signal))
    } catch (browserError) {
      signal.throwIfAborted()
      if (browserError instanceof LocationError && browserError.code === 'denied')
        throw browserError
      throw new LocationError(
        'unavailable',
        'Windows 系统定位和浏览器定位均未获取位置，请手动提供出发城市或地点；不要猜测位置或自动重试。',
      )
    }
  }
  signal.throwIfAborted()
  const result = await providers.resolve(position, undefined, signal)
  signal.throwIfAborted()
  return {
    ...result,
    source,
    coordinateSystem: 'WGS84',
    mapCoordinateSystem: result.mapLocation ? 'GCJ-02' : undefined,
    addressSource: result.address ? '高德地图' : undefined,
    queriedAt: new Date().toISOString(),
    approximate: position.accuracy > 1000,
  }
}
