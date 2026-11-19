import AMapLoader from '@amap/amap-jsapi-loader'
import { Alert, Button, Card, Input, Popover, Segmented, Select, Space, Spin, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { getMapConfig } from '../services/api'
import { locateOnMap, type MapLocation } from '../services/location'
import { useTripStore } from '../stores/trip'
import locationPin from '../assets/location-pin.svg'
import { useT, useSettings } from '../stores/settings'
import { MapLayers } from '../components/MapLayers'
import { createRouteService } from '../services/mapRoutes'
import { DidiRideDrawer } from '../components/DidiRideDrawer'

export function MapPage({onFlight,onSettings}: {onFlight?: (text:string) => void;onSettings?:()=>void}) {
  const t = useT()
  const language = useSettings(state => state.language)
  const plan = useTripStore(state => state.plan)
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const sdk = useRef<any>(null)
  const map = useRef<any>(null)
  const service = useRef<any>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const locationGeneration = useRef(0)
  const locationMarker = useRef<any>(null)
  const locationCircle = useRef<any>(null)
  const [locating, setLocating] = useState(false)
  const [myLocation, setMyLocation] = useState<MapLocation>()
  const [locationError, setLocationError] = useState('')
  const [pickingLocation, setPickingLocation] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hasResults, setHasResults] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('搜索地点或查询路线，无需先生成行程。')
  const [place, setPlace] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [category,setCategory] = useState('driving')
  const [rideMode,setRideMode] = useState('riding')
  const [railMode,setRailMode] = useState('subway')
  const [flightDate,setFlightDate] = useState('')
  const mode = category === 'ride' ? rideMode : category === 'rail' ? railMode : category
  const [tool, setTool] = useState('place')
  const [didiOpen,setDidiOpen]=useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReady(false)
    setError('')
    const deadline = setTimeout(() => {
      if (!cancelled) { setLoading(false); setError('地图加载较慢，请检查网络后重试。') }
    }, 20000)
    async function load() {
      try {
        const config = await getMapConfig()
        if (cancelled) return
        if (!config.enabled) throw new Error('地图服务尚未配置完成，请检查设置与服务。')
        ;(window as any)._AMapSecurityConfig = { serviceHost: `${window.location.origin}${config.service_host}` }
        const AMap = await AMapLoader.load({ key: config.key, version: config.version,
          plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.PlaceSearch', 'AMap.Driving', 'AMap.Walking', 'AMap.Riding', 'AMap.Transfer', 'AMap.Geocoder'] })
        if (cancelled || !container.current) return
        sdk.current = AMap
        map.current = new AMap.Map(container.current, { center: [104.2, 35.8], zoom: 4, viewMode: '2D', resizeEnable: true, lang: language === 'en' ? 'en' : 'zh_cn' })
        map.current.addControl(new AMap.Scale())
        map.current.addControl(new AMap.ToolBar())
        setReady(true)
        setError('')
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '地图加载失败，请重试。')
      } finally {
        clearTimeout(deadline)
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      locationGeneration.current++
      generation.current++
      clearTimeout(deadline)
      clearTimeout(timer.current)
      service.current?.clear()
      map.current?.destroy()
      map.current = null
      sdk.current = null
    }
  }, [attempt])

  function showLocation(located: MapLocation) {
    if (!map.current || !sdk.current) return
    setMyLocation(located)
    setPickingLocation(false)
    setLocationError('')
    const AMap = sdk.current
    locationMarker.current?.setMap(null)
    locationCircle.current?.setMap(null)
    const marker = new AMap.Marker({ map: map.current, position: located.position, draggable: true,
      icon: new AMap.Icon({ image: locationPin, size: new AMap.Size(32, 40), imageSize: new AMap.Size(32, 40) }),
      anchor: 'bottom-center', offset: new AMap.Pixel(0, 3),
      title: t('位置标记（可拖动调整）','Location (drag to adjust)') })
    locationMarker.current = marker
    marker.on('dragend', (event: any) => {
      if (locationMarker.current !== marker) return
      locationCircle.current?.setMap(null)
      setMyLocation({position:event.lnglat,accuracy:0,timestamp:Date.now(),source:'manual'})
      marker.setTitle('已选位置（可拖动调整）')
    })
    if (located.accuracy > 0) locationCircle.current = new AMap.Circle({ map: map.current, center: located.position, radius: located.accuracy,
      fillColor: '#1677ff', fillOpacity: .12, strokeColor: '#1677ff', strokeOpacity: .4 })
    const zoom = located.source === 'manual' ? Math.max(map.current.getZoom(), 15) : located.accuracy > 5000 ? 10 : located.accuracy > 1000 ? 12 : 15
    map.current.setZoomAndCenter(zoom, located.position)
  }

  useEffect(() => {
    if (!ready || !pickingLocation || busy || !map.current) return
    const currentMap = map.current
    const pick = (event: any) => showLocation({position:event.lnglat,accuracy:0,timestamp:Date.now(),source:'manual'})
    currentMap.setDefaultCursor(`url("${locationPin}") 16 37, pointer`)
    currentMap.on('click', pick)
    return () => { if (map.current === currentMap) { currentMap.off('click', pick); currentMap.setDefaultCursor('auto') } }
  }, [ready, pickingLocation, busy])

  useEffect(() => { locationMarker.current?.setDraggable(!busy) }, [busy])

  useEffect(() => {
    if (!ready || !container.current || !map.current) return
    const currentMap = map.current
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (map.current === currentMap) {
          if (typeof currentMap.resize === 'function') currentMap.resize()
          else window.dispatchEvent(new Event('resize'))
        }
      })
    })
    observer.observe(container.current)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [ready])

  async function locateMe() {
    if (!ready || busy || locating) return
    const current = ++locationGeneration.current
    setPickingLocation(false)
    setLocating(true)
    setLocationError('')
    try {
      const located = await locateOnMap(sdk.current, navigator.geolocation, window.isSecureContext)
      if (current !== locationGeneration.current || !map.current) return
      showLocation(located)
    } catch (reason) {
      if (current === locationGeneration.current) setLocationError(reason instanceof Error ? reason.message : '定位失败，请重试。')
    } finally {
      if (current === locationGeneration.current) setLocating(false)
    }
  }

  useEffect(() => {
    if (!ready || !hasResults) return
    const frame = requestAnimationFrame(() => map.current?.setFitView())
    return () => cancelAnimationFrame(frame)
  }, [ready, hasResults])

  function clearResult() {
    generation.current++
    clearTimeout(timer.current)
    service.current?.clear()
    service.current = null
    if (panel.current) panel.current.replaceChildren()
    setError('')
    setHasResults(false)
    setSummary('搜索地点或查询路线，无需先生成行程。')
  }

  function query(kind: 'place' | 'route') {
    if (kind === 'route' && mode === 'train') return
    if (kind === 'route' && mode === 'flight') {
      if (origin.trim() && destination.trim()) onFlight?.(language === 'en' ? `Find flights from ${origin} to ${destination}${flightDate ? ' on '+flightDate : ''}` : `帮我查从${origin}到${destination}的航班${flightDate ? '，'+flightDate : ''}`)
      return
    }
    if (!ready || busy || locating || (kind === 'place' ? !place.trim() : (!origin.trim() || !destination.trim()))) return
    if (kind === 'route' && (origin.trim() === '我的位置' || destination.trim() === '我的位置') && !myLocation) {
      setLocationError('请先使用“自动定位”或“手动定位”，也可以直接填写出发地址。')
      return
    }
    clearResult()
    setBusy(true)
    const current = generation.current
    const finish = (status: string, result: any) => {
      if (current !== generation.current) return
      clearTimeout(timer.current)
      setBusy(false)
      if (status !== 'complete') {
        setError(result?.message || (status === 'no_data' ? '没有匹配结果，请补充城市、机场或详细地址。' : '地图查询失败，请检查地点名称或稍后重试。'))
        setSummary('本次查询没有可展示的结果。')
        return
      }
      setHasResults(true)
      if (kind === 'place') setSummary(`“${place.trim()}”的搜索结果，可点击地图标记查看。`)
      else {
        const route = result.routes?.[0] ?? result.plans?.[0]
        const duration = route?.time ? ` · 约 ${Math.round(route.time / 60)} 分钟` : ''
        const distance = route?.distance ? ` · ${(route.distance / 1000).toFixed(1)} 公里` : ''
        setSummary(`${origin.trim()} → ${destination.trim()}${distance}${duration}（路线估算）`)
      }
    }
    timer.current = setTimeout(() => {
      if (current !== generation.current) return
      generation.current++
      service.current?.clear()
      setBusy(false)
      setError('本次查询超时，请稍后重试。')
    }, 20000)
    try {
      const AMap = sdk.current
      if (kind === 'place') {
        service.current = new AMap.PlaceSearch({ map: map.current, panel: panel.current, pageSize: 5, autoFitView: true })
        service.current.search(place.trim(), finish)
      } else {
        service.current = createRouteService(AMap,mode,{ map: map.current, panel: panel.current, autoFitView: true })
        if (mode === 'transit' || mode === 'subway') {
          const geocoder = new AMap.Geocoder()
          const locate = (name: string): Promise<any> => new Promise((resolve,reject) => {
            const complete = (status: string,data: any) => {
              const address = name === '我的位置' ? data.regeocode?.addressComponent : data.geocodes?.[0]
              const city = (Array.isArray(address?.city) ? address.city[0] : address?.city) || address?.province
              const position = name === '我的位置' ? myLocation!.position : address?.location
              if (status === 'complete' && city && position) resolve({city,position})
              else reject(new Error('City unavailable'))
            }
            if (name === '我的位置') geocoder.getAddress(myLocation!.position,complete)
            else geocoder.getLocation(name,complete)
          })
          void Promise.all([locate(origin.trim()),locate(destination.trim())]).then(([start,end]) => {
            if (current !== generation.current) return
            service.current.setCity(start.city); service.current.setCityd(end.city)
            service.current.search(start.position,end.position,finish)
          }).catch(() => finish('no_data',null))
          return
        }
        if (mode === 'electric' || mode === 'motorcycle' || origin.trim() === '我的位置' || destination.trim() === '我的位置') {
          const geocoder = new AMap.Geocoder()
          const coordinate = (name: string): Promise<any> => name === '我的位置' ? Promise.resolve(myLocation!.position)
            : new Promise((resolve, reject) => geocoder.getLocation(name, (status: string, data: any) => {
              if (status === 'complete' && data.geocodes?.[0]) resolve(data.geocodes[0].location)
              else reject(new Error('地址无法定位'))
            }))
          void Promise.all([coordinate(origin.trim()), coordinate(destination.trim())]).then(([start, end]) => {
            if (current === generation.current) service.current.search(start, end, finish)
          }).catch(() => finish('no_data', null))
        } else service.current.search([{ keyword: origin.trim() }, { keyword: destination.trim() }], finish)
      }
    } catch {
      finish('error', null)
    }
  }

  return <div className="map-page">
    <div><Typography.Title level={2}>{t('地图与路线','Map & routes')}</Typography.Title></div>
    <Card className="map-controls">
      <Segmented className="map-task-switch" aria-label="Map tools" value={tool} onChange={setTool} disabled={busy} options={[{value:'place',label:t('地点搜索','Places')},{value:'route',label:t('路线规划','Directions')}]} />
      <form hidden={tool !== 'place'} className="map-place-form" onSubmit={event => { event.preventDefault(); query('place') }}>
        <Input aria-label="Place" placeholder={t('搜索地点，例如：上海虹桥机场 / 玉环大鹿岛','Search a city, airport, or place')} value={place} onChange={e => setPlace(e.target.value)} disabled={busy} />
        <Button htmlType="submit" disabled={!ready || busy || !place.trim()}>{t('搜索地点','Search')}</Button>
      </form>
      <form hidden={tool !== 'route'} className="map-route-form" onSubmit={event => { event.preventDefault(); query('route') }}>
        <Input aria-label="From" placeholder={t('从哪里出发','From')} value={origin === '我的位置' ? t('我的位置','My location') : origin} onChange={e => setOrigin(e.target.value)} disabled={busy} />
        <Button disabled={busy} aria-label="交换起终点" onClick={() => { setOrigin(destination); setDestination(origin) }}>⇄</Button>
        <Input aria-label="To" placeholder={t('到哪里去','To')} value={destination === '我的位置' ? t('我的位置','My location') : destination} onChange={e => setDestination(e.target.value)} disabled={busy} />
        <div className="map-travel-mode"><Select aria-label={t('出行方式','Travel mode')} value={category} onChange={value => {clearResult();setCategory(value)}} disabled={busy} options={[{value:'ride',label:t('骑行','Ride')},{value:'driving',label:t('自驾','Drive')},{value:'taxi',label:t('出租车','Taxi')},{value:'rail',label:t('铁路','Rail')},{value:'flight',label:t('飞机','Flight')}]} />
          {category === 'ride' && <Select aria-label={t('骑行类型','Ride type')} value={rideMode} onChange={value=>{clearResult();setRideMode(value)}} disabled={busy} options={[{value:'motorcycle',label:t('摩托车','Motorcycle')},{value:'electric',label:t('电动自行车','E-bike')},{value:'riding',label:t('自行车','Bicycle')}]} />}
          {category === 'rail' && <Select aria-label={t('铁路类型','Rail type')} value={railMode} onChange={value=>{clearResult();setRailMode(value)}} disabled={busy} options={[{value:'subway',label:t('地铁','Metro')},{value:'train',label:t('铁路 / 火车','Train')}]} />}
          {category === 'flight' && <Input type="date" aria-label={t('出发日期','Departure date')} value={flightDate} onChange={e=>setFlightDate(e.target.value)} />}
        </div>
        {mode === 'train' ? <Button type="primary" href="https://kyfw.12306.cn/otn/leftTicket/init" target="_blank" rel="noreferrer">{t('12306查车次','Search 12306')}</Button> : <Button htmlType="submit" type="primary" disabled={(mode !== 'flight' && !ready) || busy || !origin.trim() || !destination.trim()} loading={busy}>{mode === 'flight' ? t('查航班','Find flights') : t('查路线','Directions')}</Button>}
        {mode === 'taxi' && <Button className="map-didi-button" htmlType="button" disabled={busy} onClick={()=>setDidiOpen(true)}>{t('滴滴查价','DiDi fares')}</Button>}
      </form>
      <Space wrap>
        <Button disabled={!ready || busy} loading={locating} onClick={() => void locateMe()}>{t('自动定位','Locate me')}</Button>
        <Button type={pickingLocation ? 'primary' : 'default'} aria-pressed={pickingLocation} disabled={!ready || busy || locating} onClick={() => setPickingLocation(value => !value)}>{t('手动定位','Choose location')}</Button>
        {myLocation && <Button disabled={busy || locating} onClick={() => { setOrigin('我的位置'); setTool('route') }}>{t('从这里出发','Start here')}</Button>}
        {myLocation && <Typography.Text type="secondary">{myLocation.source === 'manual' ? t('位置已调整','Location adjusted') : t('定位已完成','Location found')} · {new Date(myLocation.timestamp).toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', {hour:'2-digit',minute:'2-digit'})}{locating ? t('，正在更新',', updating') : ''}</Typography.Text>}
        {plan && <Button type="link" disabled={busy} onClick={() => { setOrigin(plan.requirement.origin); setDestination(plan.requirement.destination); setTool('route') }}>{t('填入当前行程','Use trip route')}</Button>}
        {hasResults && <Button type="text" disabled={!ready || busy} onClick={clearResult}>{t('清除结果','Clear')}</Button>}
        {!ready && !loading && <Button onClick={() => setAttempt(value => value + 1)}>{t('重新加载地图','Reload map')}</Button>}
        <Popover trigger="click" placement="bottom" title={t('定位帮助','Location help')} content={<div className="map-help-content" role="note">{language === 'en' ? 'Use Locate me for a device estimate, or Choose location to select a point. Check the marker and drag it if needed, then select Start here.' : !myLocation
        ? '自动定位获取设备位置；手动定位可在地图上选点，再次点击按钮可取消。'
        : myLocation.source === 'manual'
          ? '位置已调整。可继续拖动标记，或点击“从这里出发”设置路线起点。'
          : (myLocation.accuracy > 200 || !myLocation.accuracy)
            ? '本次定位可能不够准确，请核对标记；可使用“手动定位”或拖动标记调整。'
            : '请核对地图标记，如有偏差，可使用“手动定位”或拖动标记。'}</div>}><Button type="text" icon={<QuestionCircleOutlined />} aria-label={t('定位帮助','Location help')} /></Popover>
      </Space>
    </Card>
    {(hasResults || busy) && <div className="map-status" role="status">{language === 'en' ? (busy ? 'Searching…' : `${origin || place}${destination ? ' → ' + destination : ''}`) : summary}</div>}
    <div className={`map-workspace ${hasResults ? 'has-results' : ''}`}>
      <div className="map-surface">
        <div ref={container} className="map-canvas" />
        {loading && <div className="map-loading" role="status"><Spin size="large" /><span>{t('正在加载地图','Loading map')}</span></div>}
        {ready && <MapLayers map={map.current} sdk={sdk.current} />}
        <div className="map-notices">
          {locationError && <Alert type="warning" showIcon closable onClose={() => setLocationError('')} message={language === 'en' ? 'Location unavailable. Check browser permissions or choose a point manually.' : locationError} />}
          {pickingLocation && <Alert type="info" showIcon message={t('点击地图选择位置，也可拖动标记调整。','Click to choose your location, or drag the marker.')} />}
          {error && <Alert type="error" showIcon closable onClose={() => setError('')} message={language === 'en' ? 'Map request failed. Check the location names or retry.' : error} />}
        </div>
      </div>
      <aside className="map-results" hidden={!hasResults}><Typography.Text strong>{t('查询结果','Results')}</Typography.Text><div ref={panel} className="map-route-panel" /></aside>
    </div>
    <DidiRideDrawer open={didiOpen} onClose={()=>setDidiOpen(false)} origin={origin} destination={destination} onSettings={onSettings} />
  </div>
}
