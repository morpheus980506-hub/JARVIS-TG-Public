import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { mapFramePolicy, mapProxyRoute } from '../src/backend/map-proxy'
import { isolatedMapURL } from '../src/map-config'

test('map proxy requires the process capability and only forwards fixed AMap hosts', () => {
  assert.throws(() =>
    mapProxyRoute(new URL('http://localhost/wrong/_AMapService/v3/log/init'), 'token'),
  )
  assert.throws(() =>
    mapProxyRoute(new URL('http://localhost/token/_AMapService/https://evil.test'), 'token'),
  )
  assert.equal(mapProxyRoute(new URL('http://localhost/token/map'), 'token').document, true)
  const route = mapProxyRoute(
    new URL('http://localhost/token/_AMapService/v4/map/styles?key=test'),
    'token',
  )
  assert.equal(route.document, false)
  if (!route.document) assert.equal(route.target.origin, 'https://webapi.amap.com')
  const normal = mapProxyRoute(new URL('http://localhost/token/_AMapService/v3/log/init'), 'token')
  if (!normal.document) assert.equal(normal.target.origin, 'https://restapi.amap.com')
})

test('only the isolated map document permits the SDK dynamic code', () => {
  const main = fs.readFileSync('index.html', 'utf8')
  assert.ok(!main.includes('unsafe-eval'))
  assert.ok(
    mapFramePolicy('http://127.0.0.1:1234').includes("script-src 'unsafe-inline' 'unsafe-eval'"),
  )
  assert.ok(mapFramePolicy('http://127.0.0.1:1234').includes('http://127.0.0.1:1234'))
})

test('SDK frames cannot share the app origin or load a remote page', () => {
  assert.throws(() => isolatedMapURL('http://127.0.0.1:1234/map', 'http://127.0.0.1:1234'))
  assert.throws(() => isolatedMapURL('https://example.test/map', 'null'))
  assert.equal(
    isolatedMapURL('http://127.0.0.1:1234/map', 'http://localhost:5173'),
    'http://127.0.0.1:1234/map',
  )
})
