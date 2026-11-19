import { retryable } from './policy'
import { redact, secret } from './store'
export async function request(url: string, options: RequestInit = {}, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(60_000),
      ]),
    })
    // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
    const data = await response.json().catch(() => ({
      error: {
        message: '服务未返回 JSON',
      },
    }))
    if (response.ok) {
      return data
    }
    if (attempt < 2 && retryable(response.status)) {
      // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000 * 2 ** attempt)
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new Error('已停止'))
          },
          {
            once: true,
          },
        )
      })
      continue
    }
    const labels: Record<number, string> = {
      401: 'API Key 无效',
      402: '账户余额不足',
      403: '服务拒绝访问',
      404: '内容不可获取',
      429: '请求过于频繁',
    }
    throw new Error(
      redact(labels[response.status] || data.error?.message || `请求失败 (${response.status})`),
    )
  }
}
export async function deepseekTool(name: 'search' | 'fetch', body: any, signal: AbortSignal) {
  const key = secret('deepseek')
  if (!key) {
    throw new Error('请先配置 DeepSeek API Key')
  }
  return request(
    `https://api.deepseek.com/v1/tools/${name}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
    signal,
  )
}
export async function amap(endpoint: string, params: Record<string, string>, signal: AbortSignal) {
  const key = secret('amap')
  if (!key) {
    throw new Error('请在设置 → 旅行服务中配置高德 Web 服务 Key')
  }
  const result = await request(
    `https://restapi.amap.com/${endpoint}?${new URLSearchParams({
      ...params,
      key,
    })}`,
    {},
    signal,
  )
  if (endpoint.startsWith('v4/') && result.errcode === 0) {
    return {
      route: result.data,
      source: '高德地图',
      queriedAt: new Date().toISOString(),
    }
  }
  if (result.status !== '1') {
    throw new Error('高德：' + (result.info || '查询失败'))
  }
  return {
    ...result,
    queriedAt: new Date().toISOString(),
    source: '高德地图',
  }
}
