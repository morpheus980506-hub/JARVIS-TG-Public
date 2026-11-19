import type { Message, ProcessStep, ReasoningStep } from './shared'

export function messageProcessSteps(message: Message): ProcessStep[] {
  // Historical conversations can still contain calls to the removed control tool.
  const internalTraceIds = new Set(
    message.traces?.filter((trace) => trace.name === 'finish_process').map(({ id }) => id),
  )
  const steps = message.processSteps?.length
    ? message.processSteps
    : [
        ...(message.processNotes ?? []).map((text) => ({ type: 'note' as const, text })),
        ...(message.traces ?? []).map(({ id }) => ({ type: 'trace' as const, traceId: id })),
      ]
  return steps.filter((step) => step.type !== 'trace' || !internalTraceIds.has(step.traceId))
}

export function recordReasoningStep(steps: ProcessStep[], reasoning: ReasoningStep): ProcessStep[] {
  const index = steps.findIndex((step) => step.type === 'reasoning' && step.id === reasoning.id)
  return index < 0 ? [...steps, reasoning] : steps.with(index, reasoning)
}
