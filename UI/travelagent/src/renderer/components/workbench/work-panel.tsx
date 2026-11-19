import {
  CalendarDays,
  Maximize2,
  Minimize2,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MapView } from '@/components/workbench/map-view'
import { api } from '@/lib/api'
import type { HotelBudgetEntry, Settings, Trip } from '../../../shared'

const emptyHotelBudget: HotelBudgetEntry[] = []

export function WorkPanel({
  tab,
  setTab,
  trip,
  hotelBudget = emptyHotelBudget,
  sessionId,
  settings,
  fullView,
  setFullView,
}: {
  tab: string
  setTab: (s: string) => void
  trip?: Trip
  hotelBudget?: HotelBudgetEntry[]
  sessionId?: string
  settings?: Settings
  fullView: boolean
  setFullView: (full: boolean) => void
}) {
  const sum = trip?.budget.reduce((count, right) => count + (right.amount || 0), 0) || 0
  const hotelAmounts = hotelBudget.flatMap((entry) => (entry.amount === null ? [] : [entry.amount]))
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0" asChild>
      <aside
        id="travel-workbench"
        role={fullView ? 'main' : undefined}
        aria-label="旅行工作台"
        className="chat-enter bg-background flex size-full min-h-0 flex-col gap-0"
      >
        <div className="flex h-[60px] shrink-0 items-center justify-between px-5 [&_strong]:text-[13px] [&_strong]:font-medium">
          <strong>旅行工作台</strong>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title={fullView ? '退出完整视图' : '完整视图'}
              aria-label={fullView ? '退出完整视图' : '完整视图'}
              aria-pressed={fullView}
              onClick={() => setFullView(!fullView)}
            >
              {fullView ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="关闭面板"
              aria-label="关闭面板"
              onClick={() => {
                setFullView(false)
                setTab('')
              }}
            >
              <X />
            </Button>
          </div>
        </div>
        <TabsList variant="line" className="mx-4 shrink-0" aria-label="旅行工作台分类">
          {['地图', '行程', '预算'].map((entry) => (
            <TabsTrigger value={entry} key={entry}>
              {entry}
            </TabsTrigger>
          ))}
        </TabsList>
        {tab === '地图' ? (
          <TabsContent value="地图" className="m-0 flex min-h-0 flex-1 flex-col p-4">
            <MapView key={trip?.title || 'empty'} trip={trip} settings={settings} />
          </TabsContent>
        ) : (
          <ScrollArea
            className="min-h-0 flex-1 [&_h2]:text-xl [&_h2]:font-[550]"
            contentClassName="p-[22px]"
            key={tab}
            aria-label={`${tab}内容`}
          >
            <TabsContent value={tab} className="m-0">
              {tab === '行程' ? (
                trip ? (
                  <>
                    <h2 className="select-text">{trip.title}</h2>
                    {trip.days.map((day, index) => (
                      <section
                        className="[&>small]:text-muted-foreground mt-7 [&_h3]:my-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&>small]:text-[10px]"
                        key={`${day.date}:${day.title}`}
                      >
                        <Separator className="mb-[22px]" />
                        <span className="text-muted-foreground mb-2 block text-[10px] tracking-[3px]">
                          DAY {index + 1}
                        </span>
                        <h3 className="select-text">{day.title}</h3>
                        <small className="select-text">{day.date}</small>
                        {day.items.map((item) => (
                          <div
                            className="[&_time]:text-muted-foreground [&_p]:text-muted-foreground my-6 grid grid-cols-[46px_1fr] gap-[9px] [&_p]:mt-[7px] [&_p]:text-xs [&_p]:leading-[1.9] [&_strong]:text-xs [&_strong]:font-semibold [&_time]:text-[11px]"
                            key={`${item.time}:${item.name}`}
                          >
                            <time className="select-text">{item.time}</time>
                            <div className="select-text">
                              <strong>{item.name}</strong>
                              <p>{item.description}</p>
                            </div>
                          </div>
                        ))}
                      </section>
                    ))}
                  </>
                ) : (
                  <PanelEmpty
                    icon={CalendarDays}
                    title="行程还在酝酿中"
                    text="和 Agent 聊聊目的地与日期，生成的行程会出现在这里。"
                  />
                )
              ) : trip || hotelBudget.length ? (
                <>
                  {trip && (
                    <Card className="mb-6">
                      <CardHeader>
                        <CardDescription>已计入费用</CardDescription>
                        <CardTitle className="text-budget-price text-base font-medium tabular-nums select-text">
                          ¥{sum.toLocaleString('zh-CN')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p>含估算 · 未知费用未计入</p>
                      </CardContent>
                    </Card>
                  )}
                  <ul className="grid gap-2.5">
                    {trip?.budget.map((right) => (
                      <li key={`${right.label}:${right.source || ''}`}>
                        <Card className="py-3">
                          <CardContent className="flex items-center justify-between gap-3 px-3">
                            <div>
                              <strong className="text-xs font-medium wrap-anywhere select-text">
                                {right.label}
                              </strong>
                              <small className="text-muted-foreground mt-1.5 block text-[10px] leading-relaxed wrap-anywhere">
                                <Badge variant={right.kind === 'unknown' ? 'outline' : 'secondary'}>
                                  {right.kind === 'quote'
                                    ? '查询报价'
                                    : right.kind === 'estimate'
                                      ? '预算估算'
                                      : '待查询'}
                                </Badge>
                                {right.source && (
                                  <span className="select-text"> · {right.source}</span>
                                )}
                              </small>
                              {right.queriedAt && (
                                <small className="text-muted-foreground mt-1.5 block text-[10px] select-text">
                                  {new Date(right.queriedAt).toLocaleString()}
                                </small>
                              )}
                            </div>
                            <span className="shrink-0 text-right whitespace-nowrap">
                              {right.amount === null || right.amount === undefined ? (
                                <span className="text-muted-foreground text-xs">待确认</span>
                              ) : (
                                <span className="text-budget-price text-base font-medium tabular-nums select-text">
                                  ¥{right.amount.toLocaleString('zh-CN')}
                                </span>
                              )}
                            </span>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                  {!!hotelBudget.length && (
                    <section className="mt-4 grid gap-2" aria-label="已选酒店预算">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold">已选酒店</h3>
                        <span className="text-budget-price tabular-nums">
                          {hotelAmounts.length
                            ? `¥${hotelAmounts.reduce((total, amount) => total + amount, 0).toLocaleString('zh-CN')}`
                            : '金额待定'}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        住宿估算单独列出，避免与行程内原有住宿预算重复计算。
                      </p>
                      <ul className="grid gap-2">
                        {hotelBudget.map((entry) => (
                          <li key={entry.id}>
                            <Card className="py-2.5">
                              <CardContent className="flex items-center gap-2 px-3">
                                <div className="min-w-0 flex-1">
                                  <strong className="text-xs break-words select-text">
                                    {entry.title}
                                  </strong>
                                  <p className="text-muted-foreground mt-1 text-xs">
                                    {entry.provider === 'fliggy' ? '飞猪' : '美团'} ·{' '}
                                    {entry.checkIn
                                      ? `${entry.checkIn} 至 ${entry.checkOut}`
                                      : '日期待定'}
                                  </p>
                                </div>
                                <span className="shrink-0 text-xs tabular-nums">
                                  {entry.amount === null
                                    ? '金额待定'
                                    : `¥${entry.amount.toLocaleString('zh-CN')}`}
                                </span>
                                {sessionId && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`移除酒店预算：${entry.title}`}
                                    onClick={() =>
                                      void api
                                        .removeHotelBudget(sessionId, entry.id)
                                        .catch(() => toast.error('未能移除此项预算'))
                                    }
                                  >
                                    <Trash2 aria-hidden="true" />
                                  </Button>
                                )}
                              </CardContent>
                            </Card>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              ) : (
                <PanelEmpty
                  icon={Wallet}
                  title="让预算更清楚"
                  text="Agent 会分别展示查询报价、估算及待确认费用。"
                />
              )}
            </TabsContent>
          </ScrollArea>
        )}
      </aside>
    </Tabs>
  )
}
export function PanelEmpty({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon
  title: string
  text: string
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
