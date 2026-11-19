import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { DICTATION_SECONDS } from '../dictation'
import { transcribeDictation } from './dictation'
import { redact, secret } from './store'

export function registerDictation(
  win: BrowserWindow,
  handle: (name: string, fn: (...args: any[]) => any) => void,
) {
  let attempt:
    | { id: string; permissionUntil: number; submitUntil: number; request?: AbortController }
    | undefined
  const cancel = () => {
    attempt?.request?.abort()
    attempt = undefined
  }
  handle('dictation:start', (value: unknown) => {
    const id = z.uuid().parse(value)
    if (!secret('deepseek')) throw new Error('请先配置 DeepSeek API Key')
    if (attempt && (attempt.request || Date.now() < attempt.submitUntil)) {
      throw new Error('已有听写正在进行')
    }
    attempt = {
      id,
      permissionUntil: Date.now() + 15_000,
      submitUntil: Date.now() + (DICTATION_SECONDS + 25) * 1000,
    }
  })
  handle('dictation:ready', (id: unknown) => {
    if (attempt && attempt.id === id) attempt.permissionUntil = 0
  })
  handle('dictation:cancel', (id: unknown) => {
    if (attempt?.id === id) cancel()
  })
  handle('dictation:transcribe', async (id: unknown, audio: unknown) => {
    const current = attempt
    if (!current || current.id !== id || current.request || Date.now() >= current.submitUntil) {
      throw new Error('听写已结束，请重新录音')
    }
    current.permissionUntil = 0
    const request = new AbortController()
    current.request = request
    try {
      return redact(await transcribeDictation(audio, secret('deepseek'), request.signal))
    } finally {
      if (attempt === current) attempt = undefined
    }
  })
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) cancel()
  })
  win.webContents.on('render-process-gone', cancel)
  win.on('closed', cancel)
  return () => Boolean(attempt && Date.now() < attempt.permissionUntil)
}
