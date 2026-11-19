import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import type { ContextUsage } from '../../../shared'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat('zh-CN')
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 })

function tokenCount(value = 0) {
  return `${compact.format(value)} tok`
}

export function TokenUsageIndicator({ usage }: { usage?: ContextUsage }) {
  const total = usage && usage.inputTokens + usage.outputTokens
  const cached = usage?.cachedInputTokens
  const uncached = usage && cached !== undefined ? usage.inputTokens - cached : undefined
  const hitRate =
    usage?.inputTokens && cached !== undefined ? cached / usage.inputTokens : undefined
  const rows = [
    { label: '缓存命中率', value: percent.format(hitRate ?? 0) },
    { label: '未缓存输入', count: uncached },
    { label: '缓存输入', count: cached },
    { label: '输出', count: usage?.outputTokens },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="data-[state=open]:bg-secondary data-[state=open]:text-secondary-foreground"
          aria-label={`Token 用量，${exact.format(total ?? 0)} tok`}
        >
          <Database aria-hidden="true" data-icon="inline-start" className="text-muted-foreground" />
          <span className="tabular-nums">{tokenCount(total)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        aria-label="Token 用量详情"
        className="flex w-[200px] flex-col gap-2.5 rounded-xl border-0 p-3 shadow-lg motion-reduce:animate-none"
      >
        <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span>Token 用量</span>
          <span className="shrink-0 tabular-nums">{tokenCount(total)}</span>
        </div>
        <Separator />
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map(({ label, value, count }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value ?? tokenCount(count)}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  )
}
