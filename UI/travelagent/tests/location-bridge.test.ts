import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import { requestBrowserPosition, setBrowserLocationProvider } from '../src/backend/location'
import { registerLocationBridge } from '../src/backend/location-browser'

test('browser bridge limits location to a pending main-frame request and discards wrong or late responses', async () => {
  let check: any
  let permission: any
  let microphoneRequested = false
  const events: Record<string, (...args: any[]) => void> = {}
  const messages: any[] = []
  const handlers: Record<string, (...args: any[]) => void> = {}
  const contents = {
    getURL: () => 'http://localhost:5173/',
    session: {
      setPermissionCheckHandler: (fn: any) => {
        check = fn
      },
      setPermissionRequestHandler: (fn: any) => {
        permission = fn
      },
    },
    on: (name: string, fn: any) => {
      events[name] = fn
    },
    send: (_name: string, payload: any) => {
      messages.push(payload)
    },
  }
  const win = {
    webContents: contents,
    on: () => {},
    isDestroyed: () => false,
  } as unknown as BrowserWindow
  registerLocationBridge(
    win,
    (name, fn) => {
      handlers[name] = fn
    },
    () => microphoneRequested,
  )
  try {
    const main = { isMainFrame: true, requestingUrl: contents.getURL() }
    const audio = { ...main, mediaType: 'audio' }
    assert.equal(check(contents, 'media', '', audio), false)
    microphoneRequested = true
    assert.equal(check(contents, 'media', '', audio), true)
    assert.equal(check(contents, 'media', '', { ...audio, isMainFrame: false }), false)
    assert.equal(check(contents, 'media', '', { ...audio, mediaType: 'video' }), false)
    permission(contents, 'media', (allowed: boolean) => assert.equal(allowed, true), {
      ...main,
      mediaTypes: ['audio'],
    })
    permission(contents, 'media', (allowed: boolean) => assert.equal(allowed, false), {
      ...main,
      mediaTypes: ['audio', 'video'],
    })
    microphoneRequested = false
    assert.equal(check(contents, 'media', '', audio), false)
    assert.equal(check(contents, 'geolocation', '', main), false)
    const controller = new AbortController()
    const result = requestBrowserPosition(controller.signal)
    const id = messages[0].id
    assert.equal(check(contents, 'geolocation', '', main), true)
    assert.equal(check(contents, 'geolocation', '', { ...main, isMainFrame: false }), false)
    assert.equal(check({}, 'geolocation', '', main), false)
    assert.equal(
      check(contents, 'geolocation', '', { ...main, requestingUrl: 'http://evil.example/' }),
      false,
    )
    permission(contents, 'geolocation', (allowed: boolean) => assert.equal(allowed, false), {
      ...main,
      isMainFrame: false,
    })
    const position = { latitude: 30, longitude: 120, accuracy: 100, timestamp: Date.now() }
    handlers['location:response']('wrong-id', { ok: true, position })
    assert.equal(check(contents, 'geolocation', '', main), true)
    handlers['location:response'](id, { ok: true, position })
    assert.deepEqual(await result, position)
    assert.equal(check(contents, 'geolocation', '', main), false)
    const next = requestBrowserPosition(controller.signal)
    controller.abort()
    await assert.rejects(() => next, /abort/i)
    handlers['location:response'](messages[2].id, { ok: true, position })
    assert.equal(check(contents, 'geolocation', '', main), false)
    const reload = requestBrowserPosition(new AbortController().signal)
    events['did-start-navigation']({}, 'http://localhost:5173/', false, true)
    await assert.rejects(() => reload, /重新加载/)
  } finally {
    setBrowserLocationProvider(undefined)
  }
})
