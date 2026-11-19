import type { Trip } from './shared'

export interface MapPlace {
  id: string
  number: number
  day: number
  date: string
  time: string
  name: string
  description: string
  coord?: [number, number]
}
export interface MapPlaceGroup {
  coord: [number, number]
  places: MapPlace[]
}

/** Trip map coordinates must be GCJ-02; never reinterpret WGS84 as map coordinates. */
export function mapCoordinate(value?: string, system?: string): [number, number] | undefined {
  if (!value || (system && system !== 'GCJ-02')) return
  if (!/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return
  const [longitude, latitude] = value.split(',').map(Number)
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return
  return [longitude, latitude]
}

export function tripMapPlaces(trip?: Trip): MapPlace[] {
  let number = 0
  return (trip?.days || []).flatMap((day, dayIndex) =>
    day.items.map((item, itemIndex) => ({
      id: `${dayIndex}:${itemIndex}:${item.name}`,
      number: ++number,
      day: dayIndex + 1,
      date: day.date,
      time: item.time,
      name: item.name,
      description: item.description,
      coord: mapCoordinate(item.location, item.coordinateSystem),
    })),
  )
}

export function groupMapPlaces(places: MapPlace[]): MapPlaceGroup[] {
  const groups = new Map<string, MapPlaceGroup>()
  for (const place of places) {
    if (!place.coord) continue
    const key = place.coord.map((value) => value.toFixed(6)).join(',')
    const group = groups.get(key)
    if (group) group.places.push(place)
    else groups.set(key, { coord: place.coord, places: [place] })
  }
  return [...groups.values()]
}
