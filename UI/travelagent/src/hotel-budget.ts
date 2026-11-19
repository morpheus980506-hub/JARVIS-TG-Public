import type {
  HotelBudgetEntry,
  HotelCandidate,
  HotelLookup,
  HotelProvider,
  Session,
} from './shared'

export function findHotelBudget(
  entries: HotelBudgetEntry[],
  lookup: HotelLookup,
  provider: HotelProvider,
  candidate: HotelCandidate,
) {
  return entries.find(
    (entry) =>
      entry.provider === provider &&
      entry.city === lookup.city &&
      entry.checkIn === lookup.checkIn &&
      entry.checkOut === lookup.checkOut &&
      (entry.url === candidate.url || entry.title === candidate.title),
  )
}

export function saveHotelBudgetEntry(
  session: Session,
  lookupId: string,
  candidateId: string,
  amount: number | null,
) {
  const lookup = session.messages
    .flatMap((message) => message.hotelLookups ?? [])
    .find((entry) => entry.id === lookupId)
  const source = lookup?.sources.find((entry) =>
    entry.items.some((item) => item.id === candidateId),
  )
  const candidate = source?.items.find((item) => item.id === candidateId)
  if (!lookup || !source || !candidate) throw new Error('找不到这条酒店候选，请重新查询。')
  const entries = session.hotelBudget ?? []
  const existing = findHotelBudget(entries, lookup, source.provider, candidate)
  const entry: HotelBudgetEntry = {
    id: existing?.id ?? candidate.id,
    title: candidate.title,
    provider: source.provider,
    url: candidate.url,
    city: lookup.city,
    checkIn: lookup.checkIn,
    checkOut: lookup.checkOut,
    amount,
  }
  return existing
    ? entries.map((item) => (item.id === existing.id ? entry : item))
    : [...entries, entry]
}
