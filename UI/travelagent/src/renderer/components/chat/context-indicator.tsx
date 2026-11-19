import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { ContextUsage } from '../../../shared'

const number = new Intl.NumberFormat('zh-CN')
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const percentage = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 1,
})
const sections = [
  { key: 'systemPrompt', label: '系统提示词', color: 'bg-context-system' },
  { key: 'toolDefinitions', label: '工具定义', color: 'bg-context-tools' },
  { key: 'messages', label: '对话消息', color: 'bg-context-messages' },
] as const

export function ContextIndicator({ usage, limit }: { usage?: ContextUsage; limit?: number }) {
  const descriptionId = useId()
  const used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  const ratio = limit ? used / limit : 0
  const percent = percentage.format(ratio)
  const filled = Math.min(100, (ratio ?? 0) * 100)
  const totals = `${number.format(used)} / ${limit ? number.format(limit) : '未知'}`
  const label = usage
    ? `上下文占用 ${percent}，${totals} tokens，输入 ${number.format(usage.inputTokens)}，输出 ${number.format(usage.outputTokens)}`
    : '上下文占用，等待模型返回用量'
  const breakdown = usage?.estimatedBreakdown
  const description = breakdown
    ? '最近一次模型请求的用量。分项按请求内容大小占比分摊估算，包含本次输出，并非供应商精确计数。'
    : usage
      ? '最近一次模型请求的分项数据尚未记录；分项按零显示，完成新的模型请求后显示估算。'
      : '尚无最近一次模型请求的用量，当前数值显示为零。'
  const segments =
    breakdown && limit && used !== undefined
      ? sections.map((section) => ({
          value: (breakdown[section.key] / Math.max(limit, used)) * 100,
          className: section.color,
        }))
      : undefined

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="data-[state=open]:bg-secondary data-[state=open]:text-secondary-foreground"
          aria-label={label}
        >
          <span
            aria-hidden="true"
            data-icon="inline-start"
            className="text-muted-foreground size-4 shrink-0 rounded-full [mask-image:radial-gradient(circle_closest-side,transparent_calc(100%-2.5px),#000_calc(100%-2px))]"
            style={{
              backgroundImage: `conic-gradient(currentColor ${filled}%, color-mix(in srgb, currentColor 35%, transparent) 0)`,
            }}
          />
          <span className="tabular-nums">{percent}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        aria-label="上下文占用详情"
        aria-describedby={descriptionId}
        className="flex w-[200px] flex-col gap-2.5 rounded-xl border-0 p-3 shadow-lg motion-reduce:animate-none"
      >
        <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span>上下文已用</span>
          <span className="shrink-0 tabular-nums">
            {compact.format(used)} / {limit ? compact.format(limit) : '未知'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Progress
            value={filled}
            segments={segments}
            aria-label="上下文窗口占用"
            aria-valuetext={`${percent}，${totals} tokens`}
            className="bg-primary/15 h-1.5 flex-1 [&>[data-slot=progress-indicator]]:transition-none"
          />
          <span aria-hidden="true" className="shrink-0 text-sm font-semibold tabular-nums">
            {percent}
          </span>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          {sections.map((section) => (
            <div key={section.key} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('size-2.5 shrink-0 rounded-xs', section.color)}
                />
                {section.label}
              </dt>
              <dd className="font-medium tabular-nums">
                {compact.format(breakdown?.[section.key] ?? 0)}
              </dd>
            </div>
          ))}
        </dl>
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      </PopoverContent>
    </Popover>
  )
}
