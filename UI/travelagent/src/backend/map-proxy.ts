/** The unpredictable per-process path is a capability for the isolated map frame. */
export function mapProxyRoute(url: URL, token: string) {
  if (url.pathname === `/${token}/map`) return { document: true as const }
  const prefix = `/${token}/_AMapService/`
  if (!url.pathname.startsWith(prefix)) throw new Error('地图请求不存在')
  const rest = url.pathname.slice(prefix.length)
  if (!/^v[345]\/[a-zA-Z0-9/_-]+$/.test(rest)) throw new Error('无效地图请求')
  const origin = rest === 'v4/map/styles' ? 'https://webapi.amap.com/' : 'https://restapi.amap.com/'
  return { document: false as const, target: new URL(origin + rest + url.search) }
}

export function mapFramePolicy(origin: string) {
  return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://*.amap.com https://*.autonavi.com ${origin}; style-src 'unsafe-inline' https://*.amap.com; img-src data: blob: https://*.amap.com https://*.autonavi.com; connect-src https://*.amap.com https://*.autonavi.com ${origin}; worker-src blob:; frame-src 'self' about:; base-uri 'none'; form-action 'none'`
}
