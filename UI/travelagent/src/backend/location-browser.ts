import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  freshLocation,
  LocationError,
  locationResponseSchema,
  type BrowserLocation,
} from '../location'
import { setBrowserLocationProvider } from './location'

export function registerLocationBridge(
  win: BrowserWindow,
  handle: (name: string, fn: (...args: any[]) => any) => void,
  microphoneRequested: () => boolean = () => false,
) {
  let pending:
    | { id: string; finish: (error?: unknown, position?: BrowserLocation) => void }
    | undefined
  const trusted = (contents: Electron.WebContents | null, isMainFrame: boolean, url?: string) =>
    contents === win.webContents && isMainFrame && !!url && url === win.webContents.getURL()
  win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission === 'geolocation' || permission === 'geolocation-approximate') {
      return !!pending && trusted(contents, details.isMainFrame, details.requestingUrl)
    }
    if (permission === 'media') {
      return (
        details.mediaType === 'audio' &&
        microphoneRequested() &&
        trusted(contents, details.isMainFrame, details.requestingUrl)
      )
    }
    return permission === 'clipboard-sanitized-write' && contents === win.webContents
  })
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? details.mediaTypes : undefined
      callback(
        types?.length === 1 &&
          types[0] === 'audio' &&
          microphoneRequested() &&
          trusted(contents, details.isMainFrame, details.requestingUrl),
      )
      return
    }
    callback(
      permission === 'geolocation' || permission === 'geolocation-approximate'
        ? !!pending && trusted(contents, details.isMainFrame, details.requestingUrl)
        : permission === 'clipboard-sanitized-write' && contents === win.webContents,
    )
  })
  handle('location:response', (id: unknown, payload: unknown) => {
    if (!pending || id !== pending.id) return
    const result = locationResponseSchema.safeParse(payload)
    if (!result.success) {
      pending.finish(new LocationError('unavailable', '浏览器定位结果无效'))
      return
    }
    if (!result.data.ok) {
      pending.finish(
        new LocationError(
          result.data.code,
          result.data.code === 'denied'
            ? '浏览器定位权限已拒绝，请手动提供出发地'
            : '浏览器定位不可用，请手动提供出发地',
        ),
      )
      return
    }
    try {
      pending.finish(undefined, freshLocation(result.data.position))
    } catch {
      pending?.finish(new LocationError('unavailable', '浏览器定位结果已过期或无效'))
    }
  })
  const cancel = () => pending?.finish(new LocationError('unavailable', '定位页面已关闭或重新加载'))
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) cancel()
  })
  win.webContents.on('render-process-gone', cancel)
  win.on('closed', () => {
    cancel()
    setBrowserLocationProvider(undefined)
  })
  setBrowserLocationProvider(
    (signal) =>
      new Promise((resolve, reject) => {
        signal.throwIfAborted()
        if (pending || win.isDestroyed()) {
          reject(new LocationError('unavailable', '浏览器定位当前不可用'))
          return
        }
        const id = randomUUID()
        const abort = () => pending?.finish(signal.reason)
        const timer = setTimeout(
          () => pending?.finish(new LocationError('timeout', '浏览器定位超时')),
          20_000,
        )
        pending = {
          id,
          finish: (error, position) => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            pending = undefined
            if (!win.isDestroyed()) win.webContents.send('location:request', { id, type: 'cancel' })
            if (error) reject(error)
            else resolve(position!)
          },
        }
        signal.addEventListener('abort', abort, { once: true })
        win.webContents.send('location:request', { id, type: 'request' })
      }),
  )
}
