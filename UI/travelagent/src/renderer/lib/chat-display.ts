import { messageProcessSteps } from '../../process-steps'
import type { Message } from '../../shared'

function displaySegment(message: Message) {
  return {
    ...message,
    traces: message.traces?.map((trace) =>
      Object.assign({}, trace, { id: `${message.id}:${trace.id}` }),
    ),
    processSteps: messageProcessSteps(message).map((step) =>
      step.type === 'trace'
        ? Object.assign({}, step, { traceId: `${message.id}:${step.traceId}` })
        : step,
    ),
  }
}

/** Keep provider turns intact and present linked questionnaire replies as one assistant response. */
export function chatDisplay(messages: Message[]) {
  const rows: { message: Message; latestId: string; previousWorkMs: number }[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user' && message.clarificationReplyTo) continue
    const previous = rows.at(-1)
    const answer = messages[index - 1]
    const replyTo = answer?.role === 'user' ? answer.clarificationReplyTo : undefined
    if (
      message.role === 'assistant' &&
      previous?.message.role === 'assistant' &&
      replyTo === previous.latestId
    ) {
      const earlier = previous.message
      const current = displaySegment(message)
      if (earlier.startedAt !== undefined && earlier.completedAt !== undefined) {
        previous.previousWorkMs += Math.max(0, earlier.completedAt - earlier.startedAt)
      }
      previous.message = {
        ...current,
        id: earlier.id,
        traces: [...(earlier.traces ?? []), ...(current.traces ?? [])],
        hotelLookups: [...(earlier.hotelLookups ?? []), ...(current.hotelLookups ?? [])],
        processSteps: [
          ...messageProcessSteps(earlier),
          ...(earlier.content.trim() ? [{ type: 'note' as const, text: earlier.content }] : []),
          ...messageProcessSteps(current),
        ],
      }
      previous.latestId = message.id
    } else {
      rows.push({
        message: message.role === 'assistant' ? displaySegment(message) : message,
        latestId: message.id,
        previousWorkMs: 0,
      })
    }
  }
  return rows
}
