export type Station = { name: string; code: string; pinyin: string; short: string; city: string }
export type StationScope = 'auto' | 'exact' | 'city'
export type Endpoint = { code: string; codes: Set<string>; scope: 'exact' | 'city'; name: string }

export function parseStations(text: string): Station[] {
  const stations = text
    .split('@')
    .slice(1)
    .flatMap((entry) => {
      const fields = entry.split('|')
      if (!/^[A-Z]{3}$/.test(fields[2] || '')) return []
      return [
        {
          name: fields[1].replaceAll(/\s/g, ''),
          code: fields[2],
          pinyin: fields[3],
          short: fields[4],
          city: fields[7] || '',
        },
      ]
    })
  if (!stations.length) throw new Error('12306 车站列表格式异常')
  return stations
}

export function resolveEndpoint(
  stations: Station[],
  input: string,
  scope: StationScope = 'auto',
): Endpoint {
  const original = input.trim()
  const value = original.replace(/站$/, '')
  const station = stations.find((item) => item.code === value.toUpperCase() || item.name === value)
  const city = stations.some((item) => item.city === value) ? value : station?.city
  const isCity = scope === 'city' || (scope === 'auto' && !!city && original === city)
  if (isCity) {
    const members = stations.filter((item) => item.city === city)
    if (!city || !members.length) throw new Error(`未找到城市：${input}`)
    return {
      name: city,
      code: members.find((item) => item.name === city)?.code || members[0].code,
      codes: new Set(members.map((item) => item.code)),
      scope: 'city',
    }
  }
  if (!station) throw new Error(`未找到车站：${input}，请先查询车站名称或电报码`)
  return { name: station.name, code: station.code, codes: new Set([station.code]), scope: 'exact' }
}
