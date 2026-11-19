import type { Session } from './shared'

/** Keep the complete model turns before the edited user message, including tool results. */
export function beforeEditedMessage(session: Session, messageId: string): Session {
  const index = session.messages.findIndex(
    (message) =>
      message.id === messageId && message.role === 'user' && !message.clarificationReplyTo,
  )
  if (index < 0) throw new Error('该消息不存在或不可编辑')
  const turn = session.messages.slice(0, index).filter((message) => message.role === 'user').length
  let seen = 0
  const historyIndex = session.history.findIndex(
    (message) => message.role === 'user' && seen++ === turn,
  )
  return {
    ...session,
    messages: session.messages.slice(0, index),
    history: session.history.slice(0, historyIndex < 0 ? session.history.length : historyIndex),
    trip: undefined,
  }
}
