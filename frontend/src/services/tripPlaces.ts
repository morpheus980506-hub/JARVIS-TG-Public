export function isTripPlace(value?: string | null): value is string {
  const name = value?.trim()
  return Boolean(name && !/^我(?:现在|目前)?(?:在|住在?)/.test(name) &&
    !/^(?:骑(?:行|车|自行车|电动(?:自行)?车|摩托车?)|自驾(?:游)?|开车|驾车|步行|走路|坐(?:飞机|火车|高铁|地铁)|打车|自行车|电动自行车|cycling|bicycling|walking|driving)$/i.test(name))
}

export function itineraryRoute(origin?: string | null, destination?: string | null) {
  return isTripPlace(origin) && isTripPlace(destination) ? `${origin} → ${destination}` : null
}

export function hasTripStays(requirement: { days: number; destination: string }) {
  return requirement.days > 1 && isTripPlace(requirement.destination)
}
