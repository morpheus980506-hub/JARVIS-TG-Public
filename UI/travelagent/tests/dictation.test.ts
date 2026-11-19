import assert from 'node:assert/strict'
import test from 'node:test'
import { transcribeDictation } from '../src/backend/dictation'
import { DICTATION_MAX_SAMPLES, encodeDictationWav, isDictationWav } from '../src/dictation'

test('dictation encodes signed PCM samples and accepts only bounded canonical WAVs', () => {
  const audio = encodeDictationWav(new Int16Array([-32768, 32767]))
  assert.equal(isDictationWav(audio), true)
  assert.deepEqual(audio.slice(44), Uint8Array.of(0, 128, 255, 127))
  assert.equal(isDictationWav(encodeDictationWav(new Int16Array())), false)
  assert.equal(isDictationWav(encodeDictationWav(new Int16Array(DICTATION_MAX_SAMPLES))), true)
  assert.equal(isDictationWav(encodeDictationWav(new Int16Array(DICTATION_MAX_SAMPLES + 1))), false)
  audio[22] = 2
  assert.equal(isDictationWav(audio), false)
})

test('dictation submits a single multipart request to the official ASR service', async (ctx) => {
  const audio = encodeDictationWav(new Int16Array([0, 1]))
  const fetch = ctx.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/asr')
    assert.equal(options.method, 'POST')
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-key')
    assert.ok(options.body instanceof FormData)
    const file = options.body.get('file')
    assert.ok(file instanceof File)
    assert.equal(file.name, 'dictation.wav')
    assert.equal(file.type, 'audio/wav')
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio)
    return Response.json({ text: ' 去北京旅行。 ' })
  })
  const signal = new AbortController().signal
  await assert.rejects(transcribeDictation(new Uint8Array(), 'test-key', signal), /录音无效/)
  assert.equal(await transcribeDictation(audio, 'test-key', signal), '去北京旅行。')
  assert.equal(fetch.mock.callCount(), 1)
})
