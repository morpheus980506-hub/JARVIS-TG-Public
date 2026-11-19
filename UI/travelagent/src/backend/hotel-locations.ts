import type { HotelCandidate } from '../shared'

interface Place {
  name?: string
  location?: string
  cityname?: string
  address?: string
}
export type HotelPlaceSearch = (
  keyword: string,
  city: string,
  signal: AbortSignal,
) => Promise<Place[]>

const tidy = (value: string) => value.normalize('NFKC').replace(/[\s()（）·-]/g, '')
const sameCity = (value: string, city: string) => value.includes(city.replace(/[市县]$/, ''))

function coordinates(value?: string) {
  if (!value || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return undefined
  const [lng, lat] = value.split(',').map(Number)
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? ([lng, lat] as const) : undefined
}

function directDistance(a: readonly [number, number], b: readonly [number, number]) {
  const radians = Math.PI / 180
  const dLat = (a[1] - b[1]) * radians
  const dLng = (a[0] - b[0]) * radians
  const arc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLng / 2) ** 2
  return Math.round(12_742_000 * Math.asin(Math.sqrt(Math.min(1, arc))))
}

export function hotelLocationLookup(
  search: HotelPlaceSearch,
  city: string,
  area: string | undefined,
  signal: AbortSignal,
) {
  const lookup = async (keyword: string) => {
    try {
      return await search(keyword, city, AbortSignal.any([signal, AbortSignal.timeout(5000)]))
    } catch {
      return []
    }
  }
  const nearby = area?.replace(/(?:附近|周边)$/, '')
  const anchor = nearby
    ? lookup(nearby).then((items) => {
        const station = nearby.replace(/火车站$/, '站')
        const match = items.find(
          (item) =>
            item.name &&
            sameCity(item.cityname || '', city) &&
            [tidy(nearby), tidy(station)].includes(tidy(item.name)) &&
            coordinates(item.location),
        )
        return coordinates(match?.location)
      })
    : Promise.resolve(undefined)
  return async (items: HotelCandidate[]) => {
    return Promise.all(
      items.map(async (item, index) => {
        if (index >= 3 || signal.aborted) return item
        const [places, near] = await Promise.all([lookup(item.title), anchor])
        const match = places.find(
          (place) =>
            place.name &&
            tidy(place.name) === tidy(item.title) &&
            sameCity(place.cityname || '', city) &&
            coordinates(place.location),
        )
        const point = coordinates(match?.location)
        return match
          ? {
              ...item,
              address:
                typeof match.address === 'string' && match.address ? match.address : undefined,
              ...(point && near ? { distanceMeters: directDistance(point, near) } : {}),
            }
          : item
      }),
    )
  }
}
