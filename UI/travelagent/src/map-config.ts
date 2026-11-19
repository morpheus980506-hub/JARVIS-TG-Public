/** Keeping the SDK on a separate origin prevents it from accessing the app bridge. */
export function isolatedMapURL(value: string, appOrigin: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin === appOrigin) {
    throw new Error('地图页面必须使用独立的本机来源')
  }
  return url.href
}
