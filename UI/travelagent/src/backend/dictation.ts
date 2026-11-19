import { isDictationWav } from '../dictation'

export async function transcribeDictation(audio: unknown, key: string, signal: AbortSignal) {
  if (!key) throw new Error('请先配置 DeepSeek API Key')
  if (!isDictationWav(audio)) throw new Error('听写录音无效或超过 120 秒')
  const body = new FormData()
  body.set('file', new Blob([audio], { type: 'audio/wav' }), 'dictation.wav')
  const response = await fetch('https://api.deepseek.com/v1/tools/asr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('语音识别超时，请重试', { cause: error })
    }
    throw new Error('无法连接 DeepSeek 语音识别服务', { cause: error })
  })
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'DeepSeek API Key 无效',
      402: 'DeepSeek 账户余额不足',
      429: '语音识别请求过于频繁，请稍后再试',
      503: '语音识别服务繁忙，请稍后再试',
      504: '语音识别超时，请重试',
    }
    throw new Error(messages[response.status] ?? `语音识别失败（HTTP ${response.status}）`)
  }
  const result: unknown = await response.json().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('语音识别超时，请重试', { cause: error })
    }
    throw new Error('语音识别服务返回的结果无效', { cause: error })
  })
  if (
    !result ||
    typeof result !== 'object' ||
    !('text' in result) ||
    typeof result.text !== 'string'
  ) {
    throw new Error('语音识别服务返回的结果无效')
  }
  const text = result.text.trim()
  if (!text) throw new Error('没有识别到语音，请重试')
  return text
}
