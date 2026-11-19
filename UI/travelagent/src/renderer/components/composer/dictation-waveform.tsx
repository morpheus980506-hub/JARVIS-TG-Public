import { useEffect, useState, type RefObject } from 'react'

const peaks = [0.16, 0.22, 0.34, 0.53, 0.74, 0.87, 1, 0.87, 0.74, 0.53, 0.34, 0.22, 0.16]
const restingBars = peaks.map((peak) => peak * 0.35)

export function DictationWaveform({ analyser }: { analyser: RefObject<AnalyserNode | null> }) {
  const [bars, setBars] = useState(restingBars)

  useEffect(() => {
    const meter = analyser.current
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    if (!meter) return
    const samples = new Float32Array(meter.fftSize)
    const stride = Math.floor(samples.length / peaks.length)
    const timer = window.setInterval(() => {
      if (motion.matches) {
        setBars(restingBars)
        return
      }
      meter.getFloatTimeDomainData(samples)
      setBars(
        peaks.map((peak, index) => {
          const offset = index * stride
          let energy = 0
          for (let i = offset; i < offset + stride; i++) {
            energy += samples[i] * samples[i]
          }
          const level = Math.min(1, Math.sqrt(energy / stride) * 7)
          return peak * (0.35 + level * 0.65)
        }),
      )
    }, 50)
    return () => window.clearInterval(timer)
  }, [analyser])

  return (
    <div
      aria-hidden="true"
      className="text-foreground flex h-full items-center justify-center gap-2"
    >
      {bars.map((height, index) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- Waveform slots have a fixed count and order.
          key={index}
          className="h-full w-1.5 rounded-full bg-current motion-safe:transition-transform motion-safe:duration-75"
          style={{ transform: `scaleY(${height})` }}
        />
      ))}
    </div>
  )
}
