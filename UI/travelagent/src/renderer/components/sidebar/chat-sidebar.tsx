import { Search, SquarePen, Trash2 } from 'lucide-react'
import { SessionTitle } from '@/components/sidebar/session-title'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TravelAppState } from '@/hooks/use-travel-app'
import { api } from '@/lib/api'
import appIcon from '../../../../assets/icon.svg'
import { desktopName } from '../../../app-name'
export function ChatSidebar({
  current,
  setCurrent,
  setRenaming,
  filter,
  setFilter,
  newChat,
  load,
  sessions,
  panelFullView,
}: Pick<
  TravelAppState,
  | 'current'
  | 'setCurrent'
  | 'setRenaming'
  | 'filter'
  | 'setFilter'
  | 'newChat'
  | 'load'
  | 'sessions'
  | 'panelFullView'
>) {
  const visibleSessions = sessions.filter((session) => session.title.includes(filter))
  return (
    <aside
      id="chat-sidebar"
      aria-label="聊天侧栏"
      inert={panelFullView}
      aria-hidden={panelFullView}
      className="bg-sidebar flex size-full min-h-0 shrink-0 flex-col gap-2 px-3 pt-4 pb-2"
    >
      <div className="flex min-w-0 items-center gap-2.5 px-1 pb-3 text-sm font-semibold">
        <img src={appIcon} className="shrink-0" alt="" width={24} height={24} />
        <span className="truncate" title={desktopName}>
          {desktopName}
        </span>
      </div>
      <Button variant="ghost" className="w-full justify-start" onClick={newChat}>
        <SquarePen data-icon="inline-start" /> 新对话
      </Button>
      <InputGroup role="search" aria-label="搜索聊天">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="搜索聊天"
          placeholder="搜索聊天"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </InputGroup>
      <h2 id="chat-list-heading" className="text-muted-foreground mx-2 mt-3 mb-0.5 text-xs">
        历史对话
      </h2>
      <ScrollArea className="min-h-0 flex-1" aria-label="聊天记录列表">
        <ul aria-labelledby="chat-list-heading">
          {visibleSessions.map((session) => (
            <li
              key={session.id}
              className="group/session hover:bg-accent focus-within:bg-accent data-[active=true]:bg-accent relative my-0.5 flex min-w-0 items-center rounded-lg transition-colors"
              data-active={session.id === current}
            >
              <Button
                variant="row-label"
                aria-current={session.id === current ? 'page' : undefined}
                onClick={() => setCurrent(session.id)}
              >
                <SessionTitle title={session.title} />
              </Button>
              <div className="before:to-accent bg-accent pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-lg pr-1 opacity-0 transition-opacity group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-[12px] before:bg-linear-to-r before:from-transparent before:content-[''] motion-reduce:transition-none">
                <Button
                  variant="row-action"
                  title="修改标题"
                  aria-label={`修改对话标题：${session.title}`}
                  onClick={() => {
                    setRenaming(session.id)
                  }}
                >
                  <SquarePen data-icon="inline-start" />
                </Button>
                <Button
                  variant="row-action"
                  title="删除会话"
                  aria-label={`删除对话：${session.title}`}
                  onClick={async () => {
                    await api.deleteSession(session.id)
                    if (current === session.id) {
                      setCurrent(undefined)
                    }
                    void load()
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {!visibleSessions.length && (
          <Empty size="compact" role="status">
            <EmptyHeader>
              <EmptyDescription>{filter ? '未找到相关聊天' : '暂无聊天'}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
    </aside>
  )
}
