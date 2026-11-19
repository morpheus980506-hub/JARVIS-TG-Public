import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DICTATION_SAMPLE_RATE, DICTATION_SECONDS, encodeDictationWav } from '../../dictation'
import { api } from '../lib/api'
import workletURL from '../lib/dictation-worklet?worker&url'

type Attempt = {
  id: string
  stream?: MediaStream
  context?: AudioContext
  recorder?: AudioWorkletNode
  timer?: ReturnType<typeof setTimeout>
}

function releaseAudio(attempt: Attempt) {
  clearTimeout(attempt.timer)
  if (attempt.recorder) attempt.recorder.port.close()
  attempt.stream?.getTracks().forEach((track) => track.stop())
  if (attempt.context && attempt.context.state !== 'closed') {
    void attempt.context.close().catch(() => {})
  }
}

function discard(attempt: Attempt) {
  releaseAudio(attempt)
  void api.cancelDictation(attempt.id).catch(() => {})
}

function dictationError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '无法访问麦克风，请检查系统麦克风权限'
    if (error.name === 'NotFoundError') return '未找到麦克风'
    if (error.name === 'NotReadableError') return '无法读取麦克风，请检查设备是否被占用'
    return '无法启动麦克风录音，请重试'
  }
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : '听写失败，请重试'
}

export function useDictation(onTranscript: (text: string) => void) {
  const current = useRef<Attempt>(undefined)
  const analyser = useRef<AnalyserNode>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  useEffect(() => {
    return () => {
      const attempt = current.current
      current.current = undefined
      if (attempt) discard(attempt)
    }
  }, [])

  function cancel() {
    const attempt = current.current
    if (!attempt) return
    current.current = undefined
    analyser.current = null
    discard(attempt)
    setState('idle')
  }

  function fail(attempt: Attempt, error: unknown) {
    if (current.current !== attempt) return
    cancel()
    toast.error(dictationError(error))
  }

  function finish(attempt: Attempt) {
    if (current.current !== attempt || !attempt.recorder) return
    clearTimeout(attempt.timer)
    setState('transcribing')
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- MessagePort is paired directly with its audio worklet.
    attempt.recorder.port.postMessage('stop')
    attempt.timer = setTimeout(() => fail(attempt, new Error('无法结束录音，请重试')), 3000)
  }

  async function start() {
    if (current.current) return
    const attempt: Attempt = { id: crypto.randomUUID() }
    current.current = attempt
    setState('starting')
    attempt.timer = setTimeout(() => fail(attempt, new Error('打开麦克风超时，请重试')), 15_000)
    try {
      await api.startDictation(attempt.id)
      if (current.current !== attempt) return
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      })
      attempt.stream = stream
      if (current.current !== attempt) {
        releaseAudio(attempt)
        return
      }
      await api.dictationReady(attempt.id)
      if (current.current !== attempt) return
      const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE })
      attempt.context = context
      await context.audioWorklet.addModule(workletURL)
      if (current.current !== attempt) return
      const recorder = new AudioWorkletNode(context, 'travelagent-dictation', {
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      attempt.recorder = recorder
      recorder.addEventListener('processorerror', () =>
        fail(attempt, new Error('录音中断，请重试')),
      )
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        fail(attempt, new Error('麦克风已断开'))
      })
      recorder.port.addEventListener(
        'message',
        async ({ data }: MessageEvent<Int16Array>) => {
          if (current.current !== attempt) return
          analyser.current = null
          releaseAudio(attempt)
          setState('transcribing')
          try {
            if (!data.length) throw new Error('录音太短，请重试')
            const text = await api.transcribeDictation(attempt.id, encodeDictationWav(data))
            if (current.current !== attempt) return
            current.current = undefined
            setState('idle')
            onTranscript(text)
          } catch (error) {
            fail(attempt, error)
          }
        },
        { once: true },
      )
      recorder.port.start()
      const source = context.createMediaStreamSource(stream)
      const meter = context.createAnalyser()
      meter.fftSize = 1024
      source.connect(meter)
      meter.connect(recorder).connect(context.destination)
      await context.resume()
      if (current.current !== attempt) return
      analyser.current = meter
      clearTimeout(attempt.timer)
      attempt.timer = setTimeout(() => finish(attempt), DICTATION_SECONDS * 1000)
      setState('recording')
    } catch (error) {
      fail(attempt, error)
    }
  }

  return {
    state,
    analyser,
    start,
    finish: () => {
      if (current.current) finish(current.current)
    },
    cancel,
  }
}
