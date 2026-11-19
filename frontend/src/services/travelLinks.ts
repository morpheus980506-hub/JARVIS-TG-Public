export type TravelProvider='fliggy'|'meituan'

export function safeTravelLink(value:string|undefined,provider:TravelProvider) {
  try {
    const url=new URL(value || '')
    const hosts=provider==='fliggy' ? ['fliggy.com','feizhu.com','alitrip.com','taobao.com','tb.cn'] : ['meituan.com','dianping.com','dpurl.cn']
    // Meituan currently returns HTTP short links; the official short-link host supports HTTPS.
    if(provider==='meituan' && url.protocol==='http:' && url.hostname==='dpurl.cn' && !url.port)url.protocol='https:'
    return url.protocol==='https:' && !url.username && !url.password && hosts.some(host=>url.hostname===host || url.hostname.endsWith('.'+host)) ? url.href : undefined
  } catch {return undefined}
}
