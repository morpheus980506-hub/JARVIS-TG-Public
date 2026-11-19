import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Clarification } from '../../../shared'

export function ClarificationPanel({
  clarification,
  hidden,
  onAnswer,
  onClose,
}: {
  clarification: Clarification
  hidden: boolean
  onAnswer: (answer: string) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<(string | null)[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const titleId = useId()
  const focusTitle = useCallback(
    (title: HTMLHeadingElement | null) => {
      if (!hidden) title?.focus({ preventScroll: true })
    },
    [hidden],
  )
  const { questions } = clarification
  const current = questions[index]
  const draft = drafts[index] ?? ''
  const options = [
    ...new Map(
      (current.options ?? []).map((option) => {
        const value = typeof option === 'string' ? { label: option } : option
        return [value.label, value] as const
      }),
    ).values(),
  ]
  const highlighted = Math.max(
    0,
    options.findIndex(
      (option) => option.label === answers[index] || (!answers[index] && option.recommended),
    ),
  )

  function advance(answer: string | null) {
    const next = [...answers]
    next[index] = answer
    setAnswers(next)
    if (answer !== draft.trim()) setDrafts({ ...drafts, [index]: '' })
    if (index < questions.length - 1) {
      setIndex(index + 1)
      return
    }
    onAnswer(
      questions
        .map(({ question }, step) => {
          const response = next[step] ?? drafts[step]?.trim()
          return `${question}\n${response || '（跳过此问题）'}`
        })
        .join('\n\n'),
    )
  }

  return (
    <div hidden={hidden} className="chat-column shrink-0 pb-4">
      <form
        aria-labelledby={titleId}
        className="bg-card text-card-foreground flex max-h-[55dvh] flex-col gap-2 overflow-y-auto rounded-2xl border p-2.5 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim()) advance(draft.trim())
        }}
      >
        <div className="flex items-center justify-between gap-3 ps-2">
          <h2
            id={titleId}
            key={index}
            ref={focusTitle}
            tabIndex={-1}
            className="min-w-0 py-1.5 text-base font-semibold wrap-anywhere select-text focus:outline-none"
          >
            {current.question}
          </h2>
          <div className="text-muted-foreground flex shrink-0 items-center gap-0.5">
            {questions.length > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="上一题"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span
                  className="px-1 text-xs tabular-nums"
                  aria-label={`第 ${index + 1} 题，共 ${questions.length} 题`}
                >
                  {index + 1} / {questions.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="下一题"
                  disabled={index === questions.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="关闭提问面板"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
        {options.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="可选答案">
            {options.map(({ label, description, recommended }, position) => (
              <li key={label}>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    'group h-auto min-h-10 w-full justify-start gap-2.5 rounded-xl px-2 py-1.5 text-start whitespace-normal has-[>svg]:px-2',
                    position === highlighted && 'bg-accent text-accent-foreground',
                  )}
                  onClick={() => advance(label)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-muted text-muted-foreground grid size-6 shrink-0 place-items-center self-start rounded-md border text-xs tabular-nums',
                      position === highlighted && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {position + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 wrap-anywhere">
                    <span className="flex flex-wrap items-center gap-2">
                      {label}
                      {recommended && <Badge variant="secondary">推荐</Badge>}
                    </span>
                    {description && (
                      <span className="text-muted-foreground text-xs font-normal">
                        {description}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className={cn(
                      'text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                      position === highlighted && 'opacity-100',
                    )}
                  />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 items-center gap-2.5 px-2">
          <span className="text-muted-foreground grid size-6 shrink-0 place-items-center">
            <Pencil aria-hidden="true" className="size-4" />
          </span>
          <Input
            variant="bare"
            className="flex-1"
            aria-label="自定义回答"
            placeholder={options.length ? '填写其他答案' : '填写你的答案'}
            maxLength={500}
            value={draft}
            onChange={(event) => {
              setDrafts({ ...drafts, [index]: event.target.value })
              if (answers[index] != null) {
                const next = [...answers]
                next[index] = null
                setAnswers(next)
              }
            }}
          />
          {draft.trim() ? (
            <Button type="submit" size="icon-sm" className="shrink-0" aria-label="提交自定义回答">
              <ArrowUp aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => advance(null)}
            >
              跳过
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
