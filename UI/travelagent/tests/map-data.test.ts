import assert from 'node:assert/strict'
import test from 'node:test'
import { groupMapPlaces, mapCoordinate, tripMapPlaces } from '../src/map-data'
import type { Trip } from '../src/shared'

test('map coordinates reject empty, malformed, out-of-range and unconverted GPS values', () => {
  assert.deepEqual(mapCoordinate('116.4,39.9', 'GCJ-02'), [116.4, 39.9])
  assert.deepEqual(mapCoordinate(' 116.4, 39.9 '), [116.4, 39.9])
  for (const invalid of ['', ',', '116,', '116,NaN', '181,39', '116,91', '116,39,1'])
    assert.equal(mapCoordinate(invalid), undefined)
  assert.equal(mapCoordinate('116.4,39.9', 'WGS84'), undefined)
})

test('map data preserves day, time, descriptions and stable numbers when filtering or merging repeated coordinates', () => {
  const trip: Trip = {
    title: 'two days',
    budget: [],
    days: [
      {
        date: '2026-11-10',
        title: 'first',
        items: [
          {
            time: '09:00',
            name: '<script>place</script>',
            description: 'first visit',
            location: '116.4,39.9',
          },
          { time: '10:00', name: 'unknown', description: 'no location' },
        ],
      },
      {
        date: '2026-11-11',
        title: 'second',
        items: [
          {
            time: '11:00',
            name: 'return',
            description: 'another visit',
            location: '116.400000,39.900000',
          },
          {
            time: '12:00',
            name: 'GPS',
            description: 'needs conversion',
            location: '116,39',
            coordinateSystem: 'WGS84',
          },
        ],
      },
    ],
  }
  const places = tripMapPlaces(trip)
  assert.equal(places.length, 4)
  const groups = groupMapPlaces(places)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].places.length, 2)
  assert.deepEqual(
    groups[0].places.map((p) => [p.number, p.day, p.time, p.description]),
    [
      [1, 1, '09:00', 'first visit'],
      [3, 2, '11:00', 'another visit'],
    ],
  )
  const secondDay = places.filter((p) => p.day === 2)
  assert.equal(groupMapPlaces(secondDay)[0].places[0].number, 3)
  assert.equal(secondDay[1].coord, undefined)
  assert.equal(places[0].name, '<script>place</script>')
  assert.deepEqual(tripMapPlaces(undefined), [])
})
