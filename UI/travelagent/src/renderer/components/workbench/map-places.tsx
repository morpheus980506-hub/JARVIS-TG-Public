import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { MapPlace } from '../../../map-data'

export function MapPlaces({
  places,
  selected,
  select,
}: {
  places: MapPlace[]
  selected?: string
  select: (id: string) => void
}) {
  return (
    <section
      className="bg-card flex min-h-0 flex-col overflow-hidden rounded-xl border"
      aria-label="地图地点列表"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <span>行程地点</span>
        <Badge variant="secondary">{places.length} 项</Badge>
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        aria-label="地点时间与说明"
        contentClassName="flex flex-col gap-1 p-2"
      >
        {!places.length && (
          <p className="text-muted-foreground p-3 text-sm">
            暂无行程地点，生成行程后可在地图查看。
          </p>
        )}
        {places.map((place) => (
          <Button
            key={place.id}
            id={`map-place-${place.number}`}
            variant={selected === place.id ? 'secondary' : 'ghost'}
            className="h-auto w-full items-start justify-start gap-3 px-2 py-3 text-left whitespace-normal"
            disabled={!place.coord}
            aria-pressed={selected === place.id}
            aria-label={`${place.number} ${place.name}，第${place.day}天 ${place.time}${place.coord ? '' : '，暂无有效地图坐标'}`}
            onClick={() => select(place.id)}
          >
            <Badge variant="outline">{place.number}</Badge>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="break-words">{place.name}</span>
              <span className="text-muted-foreground text-xs">
                第 {place.day} 天 · {place.date} · {place.time}
              </span>
              <span className="text-muted-foreground text-xs leading-relaxed break-words">
                {place.description || '暂无额外说明'}
              </span>
              {!place.coord && (
                <span className="text-muted-foreground text-xs">
                  坐标缺失或需转换，未标在地图上
                </span>
              )}
            </span>
          </Button>
        ))}
      </ScrollArea>
    </section>
  )
}
