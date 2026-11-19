import { LocateFixed } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MapPlaces } from '@/components/workbench/map-places'
import { useTripMap } from '@/hooks/use-trip-map'
import { groupMapPlaces, tripMapPlaces } from '../../../map-data'
import type { Settings, Trip } from '../../../shared'

/* oxlint-disable react/iframe-missing-sandbox -- SDK internal frames require same-origin on an isolated map origin. */
export function MapView({ trip, settings }: { trip?: Trip; settings?: Settings }) {
  const [day, setDay] = useState('0')
  const [selected, setSelected] = useState<string>()
  const allPlaces = useMemo(() => tripMapPlaces(trip), [trip])
  const visibleDay = day === 'all' || !trip?.days[Number(day)] ? 'all' : day
  const places = useMemo(
    () => allPlaces.filter((place) => visibleDay === 'all' || place.day === Number(visibleDay) + 1),
    [allPlaces, visibleDay],
  )
  const groups = useMemo(() => groupMapPlaces(places), [places])
  const onSelect = useCallback((id: string) => setSelected(id), [])
  const { frame, config, status, preview, loading, initialize, send } = useTripMap(
    settings,
    groups,
    onSelect,
  )
  const active = places.find((place) => place.id === selected)
  useEffect(() => {
    if (active)
      document.getElementById(`map-place-${active.number}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div className="@container flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <Select value={visibleDay} onValueChange={setDay}>
          <SelectTrigger aria-label="选择地图展示的行程日期" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部行程 · {allPlaces.length} 个地点</SelectItem>
              {trip?.days.map((entry, index) => (
                <SelectItem key={`${entry.date}:${entry.title}`} value={String(index)}>
                  第 {index + 1} 天 · {entry.date}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!config || loading || !groups.length}
          onClick={() => send('map:fit')}
        >
          <LocateFixed data-icon="inline-start" />
          查看全部地点
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(180px,1fr)_minmax(100px,28%)] gap-3 @[720px]:grid-cols-[minmax(0,1fr)_280px] @[720px]:grid-rows-[minmax(0,1fr)]">
        <div
          className="bg-muted relative min-h-0 min-w-0 overflow-hidden rounded-xl border"
          aria-busy={loading}
        >
          {config && (
            <iframe
              key={config.id}
              ref={frame}
              src={config.frame}
              sandbox="allow-scripts allow-same-origin"
              title="行程地点交互地图"
              aria-describedby="map-status"
              className="absolute inset-0 block size-full border-0"
              onLoad={initialize}
            />
          )}
          {preview && (
            <img
              src={preview}
              alt="当前行程地点的静态地图预览，地点说明见列表"
              className="absolute inset-0 block size-full object-contain"
            />
          )}
          {preview && (
            <p className="bg-background/90 absolute inset-x-0 bottom-0 p-2 text-xs leading-relaxed">
              {status}
            </p>
          )}
          {!config && !preview && (
            <div className="text-muted-foreground flex size-full items-center justify-center p-6 text-center text-sm">
              {status}
            </div>
          )}
        </div>
        <MapPlaces
          places={places}
          selected={active?.id}
          select={(id) => {
            setSelected(id)
            send('map:select', id)
          }}
        />
      </div>
      <p id="map-status" role="status" className="sr-only">
        {status}
      </p>
    </div>
  )
}
