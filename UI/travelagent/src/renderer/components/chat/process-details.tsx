import { ListChecks, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ScrollablePre, Markdown } from '@/components/chat/markdown'
import { ReasoningLine } from '@/components/chat/reasoning-line'
import { toolDisplay } from '@/components/chat/tool-display'
import { Button } from '@/components/ui/button'
import { MessageHeader } from '@/components/ui/message'
import { Spinner } from '@/components/ui/spinner'
import {
  Trace as ActivityTrace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace'
import { processDuration } from '@/lib/process-summary'
import appIcon from '../../../../assets/icon.svg'
import { assistantName } from '../../../app-name'
import { messageProcessSteps } from '../../../process-steps'
import type { Message, Trace } from '../../../shared'

export function ProcessDetails({
  message,
  running,
  awaitingAnswer,
  reopenQuestion,
  previousWorkMs,
}: {
  message: Message
  running: boolean
  awaitingAnswer: boolean
  reopenQuestion?: () => void
  previousWorkMs: number
}) {
  const [now, setNow] = useState(Date.now)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const processSteps = messageProcessSteps(message)
  const questions = [...new Set(message.clarification?.questions.map(({ question }) => question))]
  const hasDetails = processSteps.length > 0 || questions.length > 0
  const keepOpen = running || awaitingAnswer
  const traces = new Map((message.traces || []).map((trace) => [trace.id, trace]))
  const header = (
    <TraceLine className="text-base">
      <img src={appIcon} alt="" width={16} height={16} className="shrink-0" />
      <span className="font-medium">{assistantName}</span>
      {running && (
        <TraceIcon>
          <Spinner />
        </TraceIcon>
      )}
      {(keepOpen || hasDetails || message.completedAt !== undefined) && (
        <TraceTitle className="font-normal tabular-nums">
          {processDuration(message, running, now, previousWorkMs)}
        </TraceTitle>
      )}
    </TraceLine>
  )
  return (
    <TraceCollapsible open={keepOpen || expanded} onOpenChange={setExpanded}>
      <MessageHeader className="px-0">
        {keepOpen || !hasDetails ? (
          header
        ) : (
          <TraceCollapsibleTrigger>{header}</TraceCollapsibleTrigger>
        )}
      </MessageHeader>
      {(keepOpen || hasDetails) && (
        <TraceCollapsibleContent className="mt-2.5" animate={false} rail={false}>
          <ActivityTrace className="gap-2.5">
            {processSteps.map((step, index) =>
              step.type === 'note' ? (
                // oxlint-disable-next-line react/no-array-index-key -- Notes are appended and never reordered.
                <Markdown key={`note-${index}`}>{step.text}</Markdown>
              ) : step.type === 'reasoning' ? (
                <ReasoningLine key={step.id} step={step} now={now} />
              ) : traces.has(step.traceId) ? (
                <ToolTrace key={step.traceId} trace={traces.get(step.traceId)!} />
              ) : null,
            )}
            {awaitingAnswer ? (
              <div className="flex flex-wrap items-center gap-2">
                <TraceLine role="status">
                  <TraceIcon>
                    <ListChecks />
                  </TraceIcon>
                  <TraceTitle>正在等待你的回答</TraceTitle>
                </TraceLine>
                {reopenQuestion && (
                  <Button type="button" variant="outline" size="xs" onClick={reopenQuestion}>
                    重新打开问题
                  </Button>
                )}
              </div>
            ) : questions.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 ps-5 select-text">
                {questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : null}
          </ActivityTrace>
        </TraceCollapsibleContent>
      )}
    </TraceCollapsible>
  )
}
export function ToolTrace({ trace: entry }: { trace: Trace }) {
  const display = Object.hasOwn(toolDisplay, entry.name) ? toolDisplay[entry.name] : undefined
  const Icon = display?.icon ?? Wrench
  const working = entry.state === 'running' || entry.state === 'reviewing'
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={entry.state === 'error' ? 'error' : working ? 'running' : undefined}>
          <TraceIcon>
            <Icon />
          </TraceIcon>
          <TraceTitle>
            {display?.label ?? entry.name}
            {entry.name === 'run_command' && entry.input.explanation
              ? ` · ${entry.input.explanation}`
              : ''}
          </TraceTitle>
          <TraceDescription>
            {entry.state === 'reviewing'
              ? '审查中'
              : entry.state === 'running'
                ? '进行中'
                : entry.state === 'approval'
                  ? '等待确认'
                  : entry.state === 'error'
                    ? '未完成'
                    : '已完成'}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3">
        {entry.input.explanation && <p className="select-text">{entry.input.explanation}</p>}
        <ScrollablePre language="json" title="输入参数">
          {JSON.stringify(entry.input, undefined, 2)}
        </ScrollablePre>
        {entry.explanation && <ScrollablePre title="执行说明">{entry.explanation}</ScrollablePre>}
        {entry.output && (
          <ScrollablePre language="json" title="执行结果">
            {JSON.stringify(entry.output, undefined, 2)}
          </ScrollablePre>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
