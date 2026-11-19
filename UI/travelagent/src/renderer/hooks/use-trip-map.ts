import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { isolatedMapURL } from '../../map-config'
import type { MapPlaceGroup } from '../../map-data'
import type { Settings } from '../../shared'

export function useTripMap(
  settings: Settings | undefined,
  groups: MapPlaceGroup[],
  select: (id: string) => void,
) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [config, setConfig] = useState<
    (Awaited<ReturnType<typeof api.mapConfig>> & { id: string }) | null
  >(null)
  const [status, setStatus] = useState('正在准备地图…')
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!settings) return
    const id = crypto.randomUUID()
    const resource: {
      disposed: boolean
      failed: boolean
      origin?: string
      timer?: ReturnType<typeof setTimeout>
    } = { disposed: false, failed: false }
    async function fallback(reason: string) {
      if (resource.disposed || resource.failed) return
      resource.failed = true
      setConfig(null)
      clearTimeout(resource.timer)
      setStatus(reason)
      try {
        const image = await api.staticMap(groups.slice(0, 30).map((group) => group.coord.join(',')))
        if (!resource.disposed) {
          setPreview(image)
          setStatus(
            `${reason}，当前为静态预览${groups.length > 30 ? '（仅显示前30个坐标）' : ''}；地点说明见列表。`,
          )
        }
      } catch {
        if (!resource.disposed) setStatus(`${reason}，请检查地图配置或网络；地点说明仍可查看。`)
      } finally {
        if (!resource.disposed) setLoading(false)
      }
    }
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== resource.origin ||
        event.data?.source !== 'travel-map' ||
        event.data?.id !== id ||
        resource.disposed
      )
        return
      if (event.data.type === 'complete') {
        clearTimeout(resource.timer)
        if (!resource.failed) {
          setLoading(false)
          setStatus('编号对应地点列表；点击标记查看时间与说明。仅展示地点，不绘制未经核实的路线。')
        }
      }
      if (
        event.data.type === 'select' &&
        typeof event.data.placeId === 'string' &&
        groups.some((group) => group.places.some((place) => place.id === event.data.placeId))
      )
        select(event.data.placeId)
      if (event.data.type === 'error') void fallback('交互地图加载失败')
    }
    window.addEventListener('message', listener)
    async function init() {
      const value = await api.mapConfig()
      if (resource.disposed) return
      setLoading(true)
      setPreview('')
      if (!value.key) {
        await fallback('未配置高德 JS Key')
        return
      }
      const url = isolatedMapURL(value.frame, location.origin)
      resource.origin = new URL(url).origin
      resource.timer = setTimeout(() => void fallback('交互地图加载超时'), 20_000)
      setStatus('正在加载地图…')
      setConfig({ ...value, frame: url, id })
    }
    void init().catch(() => void fallback('地图配置读取失败'))
    return () => {
      resource.disposed = true
      clearTimeout(resource.timer)
      window.removeEventListener('message', listener)
    }
  }, [groups, select, settings])
  function send(type: 'map:select' | 'map:fit', placeId?: string) {
    if (config)
      frame.current?.contentWindow?.postMessage(
        { type, id: config.id, placeId },
        new URL(config.frame).origin,
      )
  }
  function initialize() {
    if (config)
      frame.current?.contentWindow?.postMessage(
        { type: 'map:init', ...config, groups },
        new URL(config.frame).origin,
      )
  }
  return { frame, config, status, preview, loading, initialize, send }
}
