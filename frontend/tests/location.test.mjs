import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/services/location.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const { locateOnMap } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const position = { coords: { longitude: 116.3, latitude: 39.9, accuracy: 80 }, timestamp: 123456 }

test('GPS coordinates are converted before drawing and preserve accuracy', async () => {
  const amap = { convertFrom(point, type, callback) {
    assert.deepEqual(point, [116.3, 39.9])
    assert.equal(type, 'gps')
    callback('complete', { locations: [{ lng: 116.306, lat: 39.901 }] })
  } }
  const geo = { getCurrentPosition(success, failure, options) {
    assert.equal(options.maximumAge, 0)
    success(position)
  } }
  const result = await locateOnMap(amap, geo, true)
  assert.deepEqual(result.position, { lng: 116.306, lat: 39.901 })
  assert.equal(result.accuracy, 80)
})

test('insecure context and unsupported device do not request location', async () => {
  const geo = { getCurrentPosition() { assert.fail('must not request location') } }
  await assert.rejects(locateOnMap({}, geo, false), /HTTPS/)
  await assert.rejects(locateOnMap({}, undefined, true), /不支持/)
})

test('permission denial, unavailable location and timeout have distinct feedback', async () => {
  for (const [code, expected] of [[1, /权限被拒绝/], [2, /暂时无法/], [3, /超时/]]) {
    await assert.rejects(locateOnMap({}, { getCurrentPosition(success, failure) { failure({ code }) } }, true), expected)
  }
})

test('conversion failure does not fall back to drawing unconverted GPS', async () => {
  const amap = { convertFrom(point, type, callback) { callback('error', {}) } }
  await assert.rejects(locateOnMap(amap, { getCurrentPosition(success) { success(position) } }, true), /坐标转换失败/)
})

test('improving samples replace a coarse first fix and stop watching', async () => {
  let samples
  let stopped
  const geo = {
    getCurrentPosition() { assert.fail('use watch when supported') },
    watchPosition(callback) { samples = callback; return 7 },
    clearWatch(id) { stopped = id },
  }
  const amap = { convertFrom(point, type, callback) { callback('complete', {locations:[point]}) } }
  const pending = locateOnMap(amap, geo, true)
  samples({...position, coords:{...position.coords, accuracy:4000}})
  samples({...position, coords:{...position.coords, longitude:116.31, accuracy:40}})
  const result = await pending
  assert.equal(result.accuracy, 40)
  assert.deepEqual(result.position, [116.31,39.9])
  assert.equal(stopped, 7)
})
