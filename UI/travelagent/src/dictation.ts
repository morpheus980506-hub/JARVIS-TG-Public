export const DICTATION_SAMPLE_RATE = 16_000
export const DICTATION_SECONDS = 120
export const DICTATION_MAX_SAMPLES = DICTATION_SAMPLE_RATE * DICTATION_SECONDS
const HEADER_BYTES = 44

export function encodeDictationWav(samples: Int16Array) {
  const bytes = new Uint8Array(HEADER_BYTES + samples.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x52494646) // RIFF
  view.setUint32(4, bytes.length - 8, true)
  view.setUint32(8, 0x57415645) // WAVE
  view.setUint32(12, 0x666d7420) // fmt
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, DICTATION_SAMPLE_RATE, true)
  view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461) // data
  view.setUint32(40, samples.byteLength, true)
  for (const [index, sample] of samples.entries()) {
    view.setInt16(HEADER_BYTES + index * 2, sample, true)
  }
  return bytes
}

export function isDictationWav(value: unknown): value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer)) return false
  const dataBytes = value.byteLength - HEADER_BYTES
  if (dataBytes <= 0 || dataBytes > DICTATION_MAX_SAMPLES * 2 || dataBytes % 2 !== 0) return false
  const header = encodeDictationWav(new Int16Array())
  const view = new DataView(header.buffer)
  view.setUint32(4, value.byteLength - 8, true)
  view.setUint32(40, dataBytes, true)
  return header.every((byte, index) => value[index] === byte)
}
