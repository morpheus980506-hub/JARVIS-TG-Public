import { recordReasoningStep } from '../../process-steps'
import type { AgentEvent, Session } from '../../shared'

// Apply streamed events without mutating the persisted snapshot or unrelated chats.
export function applyAgentEvent(sessions: Session[], event: AgentEvent): Session[] {
  return sessions.map((session) => {
    if (session.id !== event.sessionId) {
      return session
    }
    if (event.type === 'hotel-budget') return { ...session, hotelBudget: event.hotelBudget }
    if (event.type === 'hotels' && event.hotelLookup) {
      const lookup = event.hotelLookup
      return {
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== event.messageId) return message
          const lookups = message.hotelLookups ?? []
          return {
            ...message,
            hotelLookups: lookups.some((entry) => entry.id === lookup.id)
              ? lookups.map((entry) => (entry.id === lookup.id ? lookup : entry))
              : [...lookups, lookup],
          }
        }),
      }
    }
    if (event.type === 'start' && event.startedMessages) {
      const { userId, assistantId, startedAt } = event.startedMessages
      const user = session.messages.at(-2)
      const assistant = session.messages.at(-1)
      if (user?.role !== 'user' || assistant?.role !== 'assistant') return session
      return {
        ...session,
        messages: [
          ...session.messages.slice(0, -2),
          { ...user, id: userId },
          { ...assistant, id: assistantId, startedAt },
        ],
      }
    }
    const copy = {
      ...session,
      messages: session.messages.map((message) => ({
        ...message,
        traces: [...(message.traces || [])],
        processSteps: [...(message.processSteps || [])],
      })),
    }
    if (event.type === 'trip') {
      copy.trip = event.trip
    }
    let message = copy.messages.at(-1)
    if (!message || message.role !== 'assistant') {
      message = {
        content: '',
        id: crypto.randomUUID(),
        role: 'assistant',
        traces: [],
        processNotes: [],
        processSteps: [],
      }
      copy.messages.push(message)
    }
    if (event.type === 'progress') {
      const text = event.text || ''
      message.processNotes = [...(message.processNotes || []), text]
      message.processSteps = [...(message.processSteps || []), { type: 'note', text }]
      message.content = ''
    }
    if (event.type === 'delta') {
      message.content += event.text || ''
    }
    if (event.reasoning) {
      message.processSteps = recordReasoningStep(message.processSteps ?? [], event.reasoning)
    }
    if (event.contextUsage) message.contextUsage = event.contextUsage
    if (event.type === 'error') {
      message.content += '\n\n' + event.text
    }
    if (event.trace) {
      const index = message.traces!.findIndex((entry) => entry.id === event.trace!.id)
      if (index === -1) {
        message.traces!.push(event.trace)
        message.processSteps = [
          ...(message.processSteps || []),
          { type: 'trace', traceId: event.trace.id },
        ]
      } else {
        message.traces![index] = event.trace
      }
    }
    return copy
  })
}
