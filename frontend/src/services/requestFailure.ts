export function requestFailure(body: unknown, status: number, language: 'zh' | 'en', kind: 'chat' | 'plan' = 'chat'): string {
  const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined
  if (typeof detail === 'string' && detail.trim()) return detail
  if (status === 422) {
    if (Array.isArray(detail)) {
      const first = detail.find(item => item && typeof item === 'object' && typeof item.msg === 'string')
      if (first) {
        const message = first.msg.replace(/^Value error,\s*/, '')
        if (language === 'en' || /[\u4e00-\u9fff]/.test(message)) return message
      }
    }
    return language === 'en' ? 'Check the input and try again. Your message is kept.' : '输入内容有误，请检查后重试，消息已保留。'
  }
  return language === 'en'
    ? `${kind === 'plan' ? 'Planning' : 'Chat'} request failed (${status}). Please try again.`
    : `${kind === 'plan' ? '行程规划' : '对话'}请求未完成（${status}），请稍后重试。`
}
