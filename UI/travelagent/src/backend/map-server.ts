import crypto from 'node:crypto'
import http from 'node:http'
import { app } from 'electron'
import mapHTML from '../renderer/map.html?raw'
import { mapFramePolicy, mapProxyRoute } from './map-proxy'
import * as store from './store'

export interface MapServerConfig {
  proxy: string
  frame: string
}
export async function startMapServer(allowedOrigin: string): Promise<MapServerConfig> {
  const token = crypto.randomBytes(32).toString('hex')
  let mapFrame = ''
  const server = http.createServer(async (req, res) => {
    res.setHeader(
      'Access-Control-Allow-Origin',
      req.headers.origin &&
        [allowedOrigin, 'null', new URL(mapFrame).origin].includes(req.headers.origin)
        ? req.headers.origin
        : allowedOrigin,
    )
    res.setHeader('Cache-Control', 'no-store')
    try {
      if (
        req.headers.origin &&
        ![allowedOrigin, 'null', new URL(mapFrame).origin].includes(req.headers.origin)
      ) {
        res.writeHead(403).end()
        return
      }
      const value = new URL(req.url || '/', 'http://localhost')
      let route
      try {
        route = mapProxyRoute(value, token)
      } catch {
        res.writeHead(404).end()
        return
      }
      if (route.document) {
        const origin = new URL(mapFrame).origin
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': mapFramePolicy(origin),
        })
        res.end(mapHTML)
        return
      }
      route.target.searchParams.set('jscode', store.secret('amapSecurity'))
      const response = await fetch(route.target, { signal: AbortSignal.timeout(15000) })
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      })
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(502).end('地图服务不可用')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  const proxy = `${origin}/${token}/_AMapService`
  mapFrame = `${origin}/${token}/map`
  app.on('before-quit', () => server.close())
  return { proxy, frame: mapFrame }
}
