import { z } from 'zod'
import { hotelProviders, type HotelLookup, type HotelProvider, type HotelSource } from '../shared'
import { hotelLocationLookup, type HotelPlaceSearch } from './hotel-locations'

const localSearch = 'http://127.0.0.1:8000/api/v1/travel/search/'

export const jarvisHotelSchema = z
  .object({
    city: z.string().trim().min(2).max(80),
    area: z.string().trim().max(100).optional(),
    preference: z.string().trim().max(300).optional(),
    checkIn: z.iso.date().optional(),
    checkOut: z.iso.date().optional(),
    travelers: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    ({ checkIn, checkOut }) =>
      (!checkIn && !checkOut) || Boolean(checkIn && checkOut && checkIn < checkOut),
    '实时房价需要有效的入住和退房日期；只想看酒店时可同时省略两项。',
  )

const supplierResponse = z.object({
  queried_at: z.string(),
  items: z.array(
    z.object({
      title: z.string().min(1),
      url: z.string().nullable().optional(),
      price_text: z.string().optional(),
    }),
  ),
})

function supplierLink(value: string, provider: HotelProvider) {
  try {
    const url = new URL(value)
    const domains =
      provider === 'fliggy'
        ? ['fliggy.com', 'feizhu.com', 'alitrip.com', 'taobao.com', 'tb.cn']
        : ['meituan.com', 'dianping.com', 'dpurl.cn']
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))
    )
  } catch {
    return false
  }
}

export async function searchJarvisHotels(
  input: z.infer<typeof jarvisHotelSchema>,
  signal: AbortSignal,
  onUpdate?: (lookup: HotelLookup) => void,
  placeSearch?: HotelPlaceSearch,
) {
  const fields = jarvisHotelSchema.parse(input)
  const { city, area, preference, checkIn, checkOut, travelers } = fields
  const query = [
    `查询${city}的具体酒店和详情链接。只查询，不下单、不付款、不取消。`,
    area && `优先搜索${area}附近的住宿。`,
    preference && `住宿偏好：${preference}。`,
    checkIn
      ? `入住：${checkIn}；退房：${checkOut}。区分报价和房态。`
      : '日期未定，只查具体酒店名单。不要默认日期，不要提供房价或房态。',
    travelers && `${travelers}人。`,
  ]
    .filter(Boolean)
    .join(' ')
  const lookup: HotelLookup = {
    id: crypto.randomUUID(),
    city,
    area,
    checkIn,
    checkOut,
    sources: hotelProviders.map((provider) => ({ provider, status: 'running', items: [] })),
  }
  onUpdate?.({ ...lookup })
  const enrich = placeSearch && hotelLocationLookup(placeSearch, city, area, signal)
  function update(source: HotelSource) {
    lookup.sources = lookup.sources.map((item) =>
      item.provider === source.provider ? source : item,
    )
    onUpdate?.({ ...lookup })
  }
  async function search(provider: HotelProvider): Promise<HotelSource> {
    try {
      const response = await fetch(localSearch + provider, {
        body: JSON.stringify({ city, query }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(175_000)]),
      })
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          detail?: { code?: string }
        } | null
        const code = error?.detail?.code
        const status =
          code === 'not_configured' || code === 'client_missing' || code === 'auth'
            ? code
            : code === 'timeout'
              ? 'timeout'
              : 'upstream_error'
        return { provider, status, items: [] }
      }
      const data = supplierResponse.safeParse(await response.json().catch(() => null))
      if (!data.success) return { provider, status: 'invalid_response', items: [] }
      const items = data.data.items
        .flatMap(({ title, url, price_text }) =>
          url && supplierLink(url, provider)
            ? [
                {
                  id: crypto.randomUUID(),
                  title,
                  url,
                  ...(checkIn && price_text ? { quotedPrice: price_text } : {}),
                },
              ]
            : [],
        )
        .slice(0, 5)
      return {
        provider,
        status: items.length ? 'ok' : 'no_usable_results',
        queriedAt: data.data.queried_at,
        items,
      }
    } catch (error) {
      signal.throwIfAborted()
      return {
        provider,
        status:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'timeout'
            : 'local_service_unavailable',
        items: [],
      }
    }
  }
  await Promise.all(
    hotelProviders.map(async (provider) => {
      let result: HotelSource
      try {
        result = await search(provider)
        signal.throwIfAborted()
        update(result)
      } catch (error) {
        if (!signal.aborted) throw error
        update({ provider, status: 'stopped', items: [] })
        return
      }
      if (enrich && result.items.length && !signal.aborted) {
        const items = await enrich(result.items)
        if (!signal.aborted) update({ ...result, items })
      }
    }),
  )
  signal.throwIfAborted()
  return lookup
}
