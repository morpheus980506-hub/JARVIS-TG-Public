import { ArrowUpRight, CalendarDays, SquarePen } from 'lucide-react'
import { HotelResults } from '@/components/chat/hotel-results'
import { ScrollablePre, Markdown } from '@/components/chat/markdown'
import { MessageCopy } from '@/components/chat/message-copy'
import { ProcessDetails } from '@/components/chat/process-details'
import { AttachmentList } from '@/components/composer/attachment-list'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Message as ChatMessage, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { ScrollTextarea } from '@/components/ui/scroll-area'
import type { TravelAppState } from '@/hooks/use-travel-app'
import { api } from '@/lib/api'
import { chatDisplay } from '@/lib/chat-display'
import { assistantName } from '../../../app-name'

const completionTime = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Shanghai',
})

export function ChatConversation({
  current,
  editing,
  setEditing,
  running,
  panel,
  setPanel,
  approvals,
  setApprovals,
  selected,
  send,
  pendingClarification,
  clarificationHidden,
  reopenClarification,
}: Pick<
  TravelAppState,
  | 'current'
  | 'editing'
  | 'setEditing'
  | 'running'
  | 'panel'
  | 'setPanel'
  | 'approvals'
  | 'setApprovals'
  | 'selected'
  | 'send'
  | 'pendingClarification'
  | 'clarificationHidden'
  | 'reopenClarification'
> & { selected: NonNullable<TravelAppState['selected']> }) {
  const liveReplyId = running === current ? selected.messages.at(-1)?.id : undefined
  return (
    <MessageScrollerProvider key={current} autoScroll defaultScrollPosition="end">
      <MessageScroller className="conversation h-auto min-h-0 flex-1">
        <MessageScrollerViewport
          role="region"
          aria-label="聊天内容"
          aria-busy={running === current}
        >
          <MessageScrollerContent className="chat-column pt-6 pb-7">
            {chatDisplay(selected.messages).map(({ message, latestId, previousWorkMs }) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                live={latestId === liveReplyId}
                scrollAnchor={message.role === 'user'}
              >
                <ChatMessage
                  role="article"
                  aria-label={message.role === 'user' ? '用户消息' : `${assistantName} 回复`}
                  align={message.role === 'user' ? 'end' : 'start'}
                >
                  <MessageContent>
                    {message.attachments?.length ? (
                      <AttachmentList items={message.attachments} align="end" />
                    ) : null}
                    {editing &&
                    editing.sessionId === current &&
                    editing.messageId === message.id ? (
                      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles from the editor; the form itself adds no keyboard stop.
                      <form
                        aria-label="修改消息"
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditing(undefined)
                        }}
                        onSubmit={(event) => {
                          event.preventDefault()
                          void send(editing.text, message.id)
                        }}
                      >
                        <InputGroup variant="editor">
                          <ScrollTextarea
                            group
                            id="edit-message"
                            aria-label="修改消息"
                            autoFocus
                            rows={2}
                            maxLength={50000}
                            value={editing.text}
                            disabled={Boolean(running)}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                text: event.target.value,
                              })
                            }
                          />
                          <InputGroupAddon align="block-end" className="justify-end">
                            <InputGroupButton
                              type="button"
                              variant="outline"
                              onClick={() => setEditing(undefined)}
                            >
                              取消
                            </InputGroupButton>
                            <InputGroupButton
                              type="submit"
                              variant="default"
                              disabled={
                                Boolean(running) ||
                                (!editing.text.trim() && !message.attachments?.length)
                              }
                            >
                              发送
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </form>
                    ) : message.role === 'user' ? (
                      <Bubble variant="chat" align="end">
                        <BubbleContent className="whitespace-pre-wrap select-text">
                          {message.content}
                        </BubbleContent>
                      </Bubble>
                    ) : (
                      <>
                        <ProcessDetails
                          key={latestId}
                          message={message}
                          running={latestId === liveReplyId}
                          previousWorkMs={previousWorkMs}
                          awaitingAnswer={pendingClarification?.id === latestId}
                          reopenQuestion={
                            clarificationHidden && pendingClarification?.id === latestId
                              ? reopenClarification
                              : undefined
                          }
                        />
                        {message.hotelLookups?.map((lookup) => (
                          <HotelResults
                            key={lookup.id}
                            lookup={lookup}
                            sessionId={selected.id}
                            budget={selected.hotelBudget ?? []}
                            showBudget={() => setPanel('预算')}
                            active={latestId === liveReplyId}
                          />
                        ))}
                        {message.content && (
                          <Markdown
                            className={
                              message.manuallyStopped ? 'text-muted-foreground' : undefined
                            }
                          >
                            {message.content}
                          </Markdown>
                        )}
                      </>
                    )}
                    {!(
                      editing &&
                      editing.sessionId === current &&
                      editing.messageId === message.id
                    ) && (
                      <MessageFooter className="gap-1 px-0">
                        {latestId !== liveReplyId && <MessageCopy content={message.content} />}
                        {message.role === 'assistant' &&
                          latestId !== liveReplyId &&
                          message.completedAt !== undefined && (
                            <time
                              className="ml-1 tabular-nums"
                              dateTime={new Date(message.completedAt).toISOString()}
                            >
                              <span className="sr-only">结束时间 </span>
                              {completionTime.format(message.completedAt)}
                            </time>
                          )}
                        {message.role === 'user' && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="修改消息"
                            aria-label="修改消息"
                            disabled={Boolean(running)}
                            onClick={() =>
                              setEditing({
                                sessionId: current!,
                                messageId: message.id,
                                text: message.content,
                              })
                            }
                          >
                            <SquarePen />
                          </Button>
                        )}
                      </MessageFooter>
                    )}
                  </MessageContent>
                </ChatMessage>
              </MessageScrollerItem>
            ))}
            {Object.values(approvals)
              .filter((left) => (left as any).sessionId === current)
              .map((left) => (
                <MessageScrollerItem key={left.id} messageId={left.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>这条命令需要你确认</CardTitle>
                      <CardDescription>{left.explanation}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollablePre>{left.command}</ScrollablePre>
                      <small>{left.cwd}</small>
                      <p className="text-muted-foreground text-xs leading-[1.8]">{left.reason}</p>
                    </CardContent>
                    <CardFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await api.approve(left.id, false)
                          setApprovals((old) => {
                            const count = {
                              ...old,
                            }
                            delete count[left.id]
                            return count
                          })
                        }}
                      >
                        拒绝
                      </Button>
                      <Button
                        onClick={async () => {
                          await api.approve(left.id, true)
                          setApprovals((old) => {
                            const count = {
                              ...old,
                            }
                            delete count[left.id]
                            return count
                          })
                        }}
                      >
                        允许这次执行
                      </Button>
                    </CardFooter>
                  </Card>
                </MessageScrollerItem>
              ))}
            {selected.trip && (
              <MessageScrollerItem messageId="published-trip">
                <Button
                  variant="ghost"
                  size="content-row"
                  aria-expanded={panel === '行程'}
                  aria-controls={panel ? 'travel-workbench' : undefined}
                  onClick={() => setPanel('行程')}
                >
                  <CalendarDays data-icon="inline-start" />
                  <span className="flex-1 text-left">
                    {selected.trip.title}
                    <small className="text-muted-foreground mt-1 block text-[11px]">
                      查看完整行程与预算
                    </small>
                  </span>
                  <ArrowUpRight data-icon="inline-start" />
                </Button>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="滚动到最新消息" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
