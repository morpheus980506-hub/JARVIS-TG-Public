import { DICTATION_MAX_SAMPLES } from '../../dictation'

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class DictationProcessor extends AudioWorkletProcessor {
  private readonly samples = new Int16Array(DICTATION_MAX_SAMPLES)
  private length = 0
  private finished = false

  constructor() {
    super()
    this.port.addEventListener('message', () => this.finish(), { once: true })
    this.port.start()
  }

  private finish() {
    if (this.finished) return
    this.finished = true
    const samples = this.samples.subarray(0, this.length)
    this.port.postMessage(samples, [samples.buffer])
  }

  process(inputs: Float32Array[][]) {
    if (this.finished) return false
    const channel = inputs[0]?.[0]
    if (!channel) return true
    const count = Math.min(channel.length, this.samples.length - this.length)
    for (let i = 0; i < count; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      this.samples[this.length++] = sample * (sample < 0 ? 32768 : 32767)
    }
    if (this.length === this.samples.length) this.finish()
    return !this.finished
  }
}

registerProcessor('travelagent-dictation', DictationProcessor)
