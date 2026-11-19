import { z } from 'zod'

export const browserLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  timestamp: z.number().finite().positive(),
})
export type BrowserLocation = z.infer<typeof browserLocationSchema>
export type LocationRequest = { id: string; type: 'request' | 'cancel' }
export const locationResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), position: browserLocationSchema }),
  z.object({ ok: z.literal(false), code: z.enum(['denied', 'unavailable', 'timeout']) }),
])
export type LocationResponse = z.infer<typeof locationResponseSchema>
export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout'
export class LocationError extends Error {
  constructor(
    public readonly code: LocationErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function freshLocation(value: unknown, now = Date.now()): BrowserLocation {
  const position = browserLocationSchema.parse(value)
  if (position.timestamp > now + 10_000 || now - position.timestamp > 120_000) {
    throw new Error('定位结果已过期，请重新获取当前位置')
  }
  return position
}
