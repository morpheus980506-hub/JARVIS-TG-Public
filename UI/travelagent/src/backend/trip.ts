import type { Session, Trip } from '../shared'
const railwayFareTools = [
  'mcp_builtin-12306_get-tickets',
  'mcp_builtin-12306_get-interline-tickets',
]
/** Query timestamps are application observations, never model-supplied values. */
export function observedTrip(trip: Trip, messages: Session['messages']): Trip {
  const times = messages
    .flatMap((message) => message.traces || [])
    .filter(
      (entry) =>
        entry.state === 'done' &&
        ['web_search', 'web_fetch', 'get_routes', ...railwayFareTools].includes(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      time: entry.output?.queriedAt || entry.output?.fetchedAt,
    }))
    .filter((entry) => typeof entry.time === 'string' && Number.isFinite(Date.parse(entry.time)))
  return {
    ...trip,
    budget: trip.budget.map((item) => {
      const right = {
        ...item,
      }
      if (right.kind === 'unknown' || right.amount === null) {
        right.kind = 'unknown'
        right.amount = null
        delete right.queriedAt
        return right
      }
      if (right.kind === 'estimate' || /滴滴|\bDiDi\b/i.test(right.source || '')) {
        right.kind = 'estimate'
        delete right.queriedAt
        return right
      }
      const candidates = times.filter((entry) =>
        /高德/.test(right.source || '')
          ? entry.name === 'get_routes'
          : /12306/.test(right.source || '')
            ? railwayFareTools.includes(entry.name)
            : ['web_search', 'web_fetch'].includes(entry.name),
      )
      const time = candidates.at(-1)?.time
      if (time) {
        right.queriedAt = time
      } else {
        right.kind = 'estimate'
        delete right.queriedAt
      }
      return right
    }),
  }
}
