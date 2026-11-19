import type { Message } from '../../shared'

export function processDuration(
  message: Message,
  running: boolean,
  now: number,
  previousWorkMs = 0,
) {
  const end = message.completedAt ?? (running ? now : undefined)
  if (message.startedAt === undefined || end === undefined) {
    return '用时未知'
  }
  const seconds = Math.floor((previousWorkMs + Math.max(0, end - message.startedAt)) / 1000)
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`
  return `用时 ${duration}`
}
