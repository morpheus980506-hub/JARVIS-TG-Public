import { ExternalLink, Hotel, MapPin } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { findHotelBudget } from '../../../hotel-budget'
import type {
  HotelBudgetEntry,
  HotelCandidate,
  HotelLookup,
  HotelProvider,
  HotelSource,
} from '../../../shared'

const providerName = { fliggy: '飞猪', meituan: '美团' }
const statusText: Record<HotelSource['status'], string> = {
  running: '正在查询',
  stopped: '已停止',
  ok: '已返回',
  no_usable_results: '未返回可用候选',
  not_configured: '未配置接口',
  client_missing: '平台客户端不可用',
  auth: '鉴权失败',
  timeout: '查询超时',
  upstream_error: '平台请求失败',
  invalid_response: '平台返回格式异常',
  local_service_unavailable: '本机查询服务不可用',
}
const timestamp = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Shanghai',
})

export function HotelResults({
  lookup,
  sessionId,
  budget,
  showBudget,
  active,
}: {
  lookup: HotelLookup
  sessionId: string
  budget: HotelBudgetEntry[]
  showBudget: () => void
  active: boolean
}) {
  const [selected, setSelected] = useState<{ provider: HotelProvider; candidate: HotelCandidate }>()
  const [amount, setAmount] = useState('')
  const amountId = useId()
  const [saving, setSaving] = useState(false)
  const value = amount.trim()
  const valid = !value || (/^\d{1,8}(?:\.\d{1,2})?$/.test(value) && Number(value) <= 10_000_000)
  const dates =
    lookup.checkIn && lookup.checkOut ? `${lookup.checkIn} 至 ${lookup.checkOut}` : '入住日期待定'
  return (
    <section className="my-2 w-full min-w-0 select-none" aria-label={`${lookup.city}酒店查询`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Hotel className="size-4" />
          {lookup.city}酒店
        </h3>
        <span className="text-muted-foreground text-xs">
          {lookup.area ? `查询范围：${lookup.area} · ` : ''}
          {dates}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] items-start gap-2.5">
        {lookup.sources.map((source) => (
          <Card key={source.provider} className="gap-2 py-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1 px-3 text-xs">
              <strong>{providerName[source.provider]}</strong>
              <span role="status" className="text-muted-foreground flex items-center gap-1">
                {active && source.status === 'running' && (
                  <Spinner aria-hidden="true" className="size-3" />
                )}
                {!active && source.status === 'running' ? '查询中断' : statusText[source.status]}
                {source.items.length ? ` · ${source.items.length} 家` : ''}
              </span>
            </div>
            {!!source.items.length && (
              <ul className="divide-border divide-y border-t">
                {source.items.map((candidate) => {
                  const entry = findHotelBudget(budget, lookup, source.provider, candidate)
                  return (
                    <li key={candidate.id} className="grid gap-1.5 px-3 py-2.5">
                      <strong className="text-sm leading-snug wrap-anywhere select-text">
                        {candidate.title}
                      </strong>
                      <p className="text-muted-foreground flex items-start gap-1 text-xs leading-relaxed select-text">
                        <MapPin className="mt-0.5 size-3 shrink-0" />
                        {candidate.address || '门店地址待核对'}
                      </p>
                      {lookup.area && (
                        <p className="text-muted-foreground text-xs">
                          {candidate.distanceMeters === undefined
                            ? '到指定地点的距离待核对'
                            : `高德直线距离约 ${candidate.distanceMeters < 1000 ? `${candidate.distanceMeters} 米` : `${(candidate.distanceMeters / 1000).toFixed(1)} 公里`}`}
                        </p>
                      )}
                      {lookup.checkIn && (
                        <p className="text-xs">
                          {candidate.quotedPrice
                            ? `平台报价：${candidate.quotedPrice}`
                            : '价格见平台'}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 px-2"
                          onClick={() => void api.openExternal(candidate.url)}
                        >
                          详情
                          <ExternalLink aria-hidden="true" className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          onClick={() => {
                            setAmount(entry?.amount == null ? '' : String(entry.amount))
                            setSelected({ provider: source.provider, candidate })
                          }}
                        >
                          {entry ? '编辑预算' : '加入预算'}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {source.queriedAt && Number.isFinite(Date.parse(source.queriedAt)) && (
              <time dateTime={source.queriedAt} className="text-muted-foreground px-3 text-xs">
                查询于 {timestamp.format(new Date(source.queriedAt))}
              </time>
            )}
          </Card>
        ))}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !saving) setSelected(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加入行程预算</DialogTitle>
            <DialogDescription>
              {selected?.candidate.title} · {selected && providerName[selected.provider]}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!selected || !valid || saving) return
              setSaving(true)
              try {
                await api.saveHotelBudget(
                  sessionId,
                  lookup.id,
                  selected.candidate.id,
                  value ? Number(value) : null,
                )
                setSelected(undefined)
                showBudget()
                toast.success('已保存酒店预算')
              } catch (error) {
                toast.error('预算未保存', {
                  description: error instanceof Error ? error.message : undefined,
                })
              } finally {
                setSaving(false)
              }
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={amountId}>住宿总额（元）</Label>
              <Input
                id={amountId}
                inputMode="decimal"
                placeholder="留空标为待定"
                value={amount}
                maxLength={12}
                aria-invalid={!valid}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              按整段入住估算。平台给出的每晚价或起价不会自动计入。
            </p>
            <DialogFooter>
              <Button type="submit" disabled={saving || !valid}>
                保存预算
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
