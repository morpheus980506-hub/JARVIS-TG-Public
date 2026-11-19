import assert from 'node:assert/strict'
import test from 'node:test'
import { locateCurrentPosition, resolveLocation } from '../src/backend/location'
import { createLocationTool } from '../src/backend/location-tool'
import { freshLocation, LocationError } from '../src/location'
import { browserPosition } from '../src/renderer/lib/geolocation'

const position = () => ({ latitude: 39.9, longitude: 116.4, accuracy: 100, timestamp: Date.now() })
const resolve = async (p: ReturnType<typeof position>) => ({ position: p })

test('location validates coordinates, accuracy, future timestamps and stale positions', () => {
  const p = position()
  assert.deepEqual(freshLocation(p), p)
  for (const bad of [
    { ...p, latitude: 91 },
    { ...p, longitude: -181 },
    { ...p, accuracy: -1 },
    { ...p, longitude: NaN },
    { ...p, timestamp: p.timestamp - 121000 },
    { ...p, timestamp: p.timestamp + 11000 },
  ]) {
    assert.throws(() => freshLocation(bad, p.timestamp))
  }
})

test('Windows positioning is preferred, and unavailable native service falls back to browser', async () => {
  let browsers = 0
  const signal = new AbortController().signal
  const providers = {
    windows: async () => position(),
    browser: async () => {
      browsers++
      return { ...position(), accuracy: 2000 }
    },
    resolve,
  }
  const native = await locateCurrentPosition(signal, providers)
  assert.equal(native.source, 'Windows 系统定位')
  assert.equal(native.coordinateSystem, 'WGS84')
  assert.equal(browsers, 0)
  const fallback = await locateCurrentPosition(signal, {
    ...providers,
    windows: async () => {
      throw new LocationError('unavailable', 'offline')
    },
  })
  assert.equal(fallback.source, '浏览器 Geolocation')
  assert.equal(fallback.approximate, true)
  assert.equal(browsers, 1)
})

test('denied or cancelled native positioning never starts a browser fallback', async () => {
  let browsers = 0
  const controller = new AbortController()
  const providers = {
    windows: async () => {
      throw new LocationError('denied', 'denied')
    },
    browser: async () => {
      browsers++
      return position()
    },
    resolve,
  }
  await assert.rejects(
    () => locateCurrentPosition(controller.signal, providers),
    (e: unknown) => e instanceof LocationError && e.code === 'denied',
  )
  await assert.rejects(
    () =>
      locateCurrentPosition(controller.signal, {
        ...providers,
        windows: async () => {
          controller.abort()
          throw new Error('cancel')
        },
      }),
    /abort/i,
  )
  assert.equal(browsers, 0)
})

test('one tool instance queries at most once per turn, including failures', async () => {
  let calls = 0
  const tool = createLocationTool(new AbortController().signal, async () => {
    calls++
    throw new LocationError('denied', 'denied')
  })
  await assert.rejects(() => tool.execute({}), /denied/)
  await assert.rejects(() => tool.execute({}), /denied/)
  assert.equal(calls, 1)
})

test('address resolution uses official WGS84 conversion before reverse geocoding; failures preserve raw coordinates', async () => {
  const paths: string[] = []
  const p = position()
  const result = await resolveLocation(p, async (endpoint, params) => {
    paths.push(endpoint)
    if (paths.length === 1) {
      assert.equal(params.coordsys, 'gps')
      assert.equal(params.locations, '116.400000,39.900000')
      return { locations: '116.406242,39.901404' }
    }
    assert.equal(params.location, '116.406242,39.901404')
    return { regeocode: { formatted_address: '测试地址' } }
  })
  assert.deepEqual(paths, ['v3/assistant/coordinate/convert', 'v3/geocode/regeo'])
  assert.equal(result.address, '测试地址')
  assert.equal(result.mapLocation, '116.406242,39.901404')
  assert.deepEqual(result.position, p)
  const failed = await resolveLocation(p, async () => {
    throw new Error('offline')
  })
  assert.equal(failed.mapLocation, undefined)
  assert.equal(failed.address, undefined)
  assert.ok(failed.warning)
})

test('browser Geolocation retains denial and drops late callbacks after cancellation', async () => {
  const signal = new AbortController().signal
  const denied = {
    getCurrentPosition: (_ok: unknown, fail: PositionErrorCallback) =>
      fail({ code: 1 } as GeolocationPositionError),
  } as unknown as Geolocation
  await assert.rejects(
    () => browserPosition(denied, signal),
    (e: unknown) => e instanceof LocationError && e.code === 'denied',
  )
  let late: PositionCallback | undefined
  const browser = {
    getCurrentPosition: (ok: PositionCallback) => {
      late = ok
    },
  } as unknown as Geolocation
  const controller = new AbortController()
  const pending = browserPosition(browser, controller.signal)
  controller.abort()
  await assert.rejects(() => pending, /abort/i)
  late!({ coords: position(), timestamp: Date.now() } as unknown as GeolocationPosition)
})
