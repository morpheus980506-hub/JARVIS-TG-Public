import { Brain } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace'
import type { ReasoningStep } from '../../../shared'

export function ReasoningLine({ step, now }: { step: ReasoningStep; now: number }) {
  const thinking = step.endedAt === undefined
  const seconds = Math.max(0, Math.floor(((step.endedAt ?? now) - step.startedAt) / 1000))
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`

  return (
    <TraceCollapsible defaultOpen={false}>
      <TraceCollapsibleTrigger>
        <TraceLine status={thinking ? 'running' : undefined}>
          <TraceIcon>{thinking ? <Spinner /> : <Brain />}</TraceIcon>
          <TraceTitle>{thinking ? '思考中' : '已思考'}</TraceTitle>
          <TraceDescription>{duration}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">
        {step.text ? (
          <div className="select-text">{step.text}</div>
        ) : thinking ? (
          '正在接收思考内容…'
        ) : (
          '这条记录没有可显示的思考内容。'
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
