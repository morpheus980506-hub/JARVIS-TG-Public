import { Button, Popover, Segmented, Spin, Switch, Tooltip } from 'antd'
import { AppstoreOutlined, ExclamationOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { useT, useSettings } from '../stores/settings'
import { compositeWeatherSampler, createWindSampler, drawWeather, drawWindArrows, weatherCanvasSize, weatherScales, type WeatherGrid, type WeatherField } from '../services/mapWeather'
import { weatherGridCache } from '../services/weatherCache'

function detach(map: any, layers: any) {
  // Parent map teardown may run before this child's passive cleanup.
  try { map.remove(layers) } catch { /* Already destroyed. */ }
}

export function MapLayers({map, sdk}: {map: any; sdk: any}) {
  const t = useT()
  const language = useSettings(state => state.language)
  const [satellite,setSatellite] = useState(false)
  const [traffic,setTraffic] = useState(false)
  const [field,setField] = useState<WeatherField | null>(null)
  const [hour,setHour] = useState(0)
  const [grid,setGrid] = useState<WeatherGrid>()
  const [grids,setGrids] = useState<WeatherGrid[]>([])
  const [view,setView] = useState<WeatherGrid['bounds']>()
  const [busy,setBusy] = useState(false)
  const [failed,setFailed] = useState(false)
  const [retryAttempt,setRetryAttempt] = useState(0)
  const [probe,setProbe] = useState<number | null>()
  const windCanvas=useRef<HTMLCanvasElement>(null)
  const enabled = field !== null
  const scale = field ? weatherScales[field] : undefined
  const fieldTitle = field === 'rain' ? t('降水','Precipitation') : field === 'wind' ? t('风速','Wind speed') : t('云量','Cloud cover')

  useEffect(() => {
    if (!satellite) return
    const image = new sdk.TileLayer.Satellite({zIndex:4})
    const roads = new sdk.TileLayer.RoadNet({zIndex:5})
    map.add([image,roads])
    return () => detach(map,[image,roads])
  }, [map,sdk,satellite])
  useEffect(() => {
    if (!traffic) return
    const layer = new sdk.TileLayer.Traffic({zIndex:12,autoRefresh:true,interval:180})
    map.add(layer)
    return () => detach(map,layer)
  }, [map,sdk,traffic])
  useEffect(() => {
    if (!enabled) { setGrid(undefined); setGrids([]); setBusy(false); setFailed(false); return }
    let disposed = false
    let ticket = 0
    let timer: ReturnType<typeof setTimeout>
    let retryTimer: ReturnType<typeof setTimeout>
    let retriedView=''
    async function refresh() {
      if (disposed) return
      clearTimeout(retryTimer)
      const current = ++ticket
      const bounds = map.getBounds(), sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
      const west = Math.max(-180,sw.getLng()), east = Math.min(180,ne.getLng())
      const south = Math.max(-85,sw.getLat()), north = Math.min(85,ne.getLat())
      if (east <= west || north <= south) { setGrid(undefined); setFailed(true); setBusy(false); return }
      const view = {west,east,south,north}
      setView(view)
      const available = weatherGridCache.visible(view,true)
      setGrids(available)
      const cached = weatherGridCache.peek(view)
      if (cached) { setGrid(cached); setBusy(false); setFailed(false); return }
      const stale = weatherGridCache.peek(view,true)
      if (stale) setGrid(stale)
      else if (available.length) setGrid(available[0])
      setBusy(true); setFailed(false)
      const started=performance.now()
      try {
        const data = await weatherGridCache.request(view)
        if (!disposed && current === ticket) {setGrid(data); setGrids(weatherGridCache.visible(view))}
      } catch {
        if (!disposed && current === ticket) {
          setFailed(true); setGrids(weatherGridCache.visible(view,true))
          const key=JSON.stringify(view)
          if(retriedView !== key && performance.now()-started<6000) {
            retriedView=key
            retryTimer=setTimeout(()=>void refresh(),1500)
          }
        }
      } finally { if (!disposed && current === ticket) setBusy(false) }
    }
    const moved = () => { clearTimeout(timer); clearTimeout(retryTimer); ticket++; timer = setTimeout(() => void refresh(),180) }
    map.on('moveend',moved); map.on('zoomend',moved); map.on('resize',moved)
    void refresh()
    const expiry = setInterval(() => void refresh(),60000)
    return () => {
      disposed=true; clearTimeout(timer); clearTimeout(retryTimer); clearInterval(expiry)
      try { map.off('moveend',moved); map.off('zoomend',moved); map.off('resize',moved) } catch { /* Already destroyed. */ }
    }
  }, [map,enabled,retryAttempt])
  useEffect(() => {
    if (!grid || !field || !view) return
    const canvas = document.createElement('canvas')
    const size = weatherCanvasSize(view)
    canvas.width = size.width; canvas.height = size.height
    drawWeather(canvas,grid,field,hour,grids.length ? grids : [grid],view)
    const b = view
    const layer = new sdk.CanvasLayer({canvas,bounds:new sdk.Bounds([b.west,b.south],[b.east,b.north]),zIndex:40,zooms:[2,20]})
    map.add(layer)
    return () => detach(map,layer)
  }, [map,sdk,grid,grids,view,field,hour])
  useEffect(()=>{
    const canvas=windCanvas.current
    if(field !== 'wind' || !grid || !canvas) return
    const sample=createWindSampler(grids.length ? grids : [grid],grid.hours[hour])
    let frame=0
    const render=()=>{
      frame=0
      const size=map.getSize()
      drawWindArrows(canvas,grids.length ? grids : [grid],grid.hours[hour],{
        width:size.width,height:size.height,ratio:Math.min(2,window.devicePixelRatio || 1),
        unproject:(x,y)=>{const p=map.containerToLngLat(new sdk.Pixel(x,y));return {lng:p.getLng(),lat:p.getLat()}},
        angle:(lng,lat,vector)=>{
          const norm=Math.hypot(vector.x,vector.y)
          const start=map.lngLatToContainer(new sdk.LngLat(lng,lat))
          const end=map.lngLatToContainer(new sdk.LngLat(lng+vector.x/norm*.001/Math.cos(lat*Math.PI/180),lat-vector.y/norm*.001))
          return Math.atan2(end.y-start.y,end.x-start.x)
        },
      },sample)
    }
    const schedule=()=>{if(!frame) frame=requestAnimationFrame(render)}
    const events=['mapmove','zoomchange','zoomend','rotatechange','resize']
    for(const event of events) map.on(event,schedule)
    schedule()
    return ()=>{
      cancelAnimationFrame(frame)
      canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height)
      try {for(const event of events) map.off(event,schedule)} catch { /* Map already destroyed. */ }
    }
  },[map,sdk,grid,grids,field,hour])
  useEffect(() => {
    setProbe(undefined)
    if (!grid || !field) return
    const sample = compositeWeatherSampler(grids.length ? grids : [grid],field,grid.hours[hour])
    let last = 0
    const moved = (event: any) => {
      if (Date.now()-last < 100) return
      last = Date.now()
      setProbe(sample(event.lnglat.getLng(),event.lnglat.getLat()))
    }
    map.on('mousemove',moved)
    return () => { try { map.off('mousemove',moved) } catch { /* Already destroyed. */ } }
  }, [map,grid,grids,field,hour])

  const controls = <div className="map-layer-options">
    <Segmented block value={satellite ? 'satellite' : 'standard'} onChange={value => setSatellite(value === 'satellite')} options={[{value:'standard',label:t('标准地图','Map')},{value:'satellite',label:t('卫星图','Satellite')}]} />
    <label><span>{t('实时路况','Traffic')}</span><Switch checked={traffic} onChange={setTraffic} /></label>
    <Tooltip title={t('尚未接入人流数据源','No crowd data source connected')}><label><span>{t('人流热力','Crowd heatmap')}<small>{t('未接入','Unavailable')}</small></span><Switch disabled checked={false} /></label></Tooltip>
    <div className="map-layer-divider map-weather-heading"><span>{t('天气预报','Weather forecast')}<Tooltip title={t('测试功能，无法保证精确度','Experimental feature; accuracy is not guaranteed')} trigger={['hover','focus','click']}><button type="button" className="weather-experimental" aria-label={t('测试功能，无法保证精确度','Experimental feature; accuracy is not guaranteed')}><ExclamationOutlined /></button></Tooltip></span><Switch aria-label={t('天气预报','Weather forecast')} checked={enabled} onChange={checked => setField(checked ? 'rain' : null)} /></div>
    {enabled && <Segmented block value={field!} onChange={setField} options={[{value:'rain',label:t('降水','Rain')},{value:'wind',label:t('风速','Wind')},{value:'clouds',label:t('云量','Clouds')}]} />}
    {enabled && <Segmented block size="small" value={hour} onChange={setHour} options={[0,3,6,12,24].map(value => ({value,label:value === 0 ? t('当前','Now') : `+${value}h`}))} />}
    {traffic && <small>{t('路况来源：高德','Traffic: AMap')}</small>}
  </div>
  return <>
    <Popover placement="bottomRight" trigger="click" content={controls} title={t('图层','Layers')}><Button className="map-layer-button" icon={<AppstoreOutlined />}>{t('图层','Layers')}</Button></Popover>
    {field === 'wind' && <canvas ref={windCanvas} className="map-wind-overlay" aria-hidden="true" />}
    {enabled && scale && <div className="map-weather-legend" role="group" aria-label={t('天气图例','Weather legend')}>
      <div className="weather-legend-heading"><strong>{fieldTitle} · {scale.unit}</strong>{busy && <span><Spin size="small" /> {t('更新中','Updating')}</span>}{probe !== undefined && <b>{probe == null ? t('此处暂无数据','No data here') : `${probe.toFixed(1)} ${scale.unit}`}</b>}</div>
      <div className="weather-color-scale" aria-label={`${fieldTitle} ${scale.unit}`}>{scale.stops.map((stop,index) => <div key={stop.min} title={`${stop.min}${index < scale.stops.length-1 ? '–'+scale.stops[index+1].min : '+'} ${scale.unit}`}><i style={{background:`linear-gradient(to right,${stop.color},${scale.stops[Math.min(index+1,scale.stops.length-1)].color})`}} /><span>{stop.min}{index === scale.stops.length-1 ? '+' : ''}</span></div>)}</div>
      <div className="weather-legend-meta"><span className="weather-no-data"><i /> {t('无数据','No data')}</span>{grid && <strong>{new Date(grid.hours[hour]).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</strong>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></div>
      {failed && <div className="weather-update-warning">{grid ? t('更新失败，仍显示上次预报','Update failed; showing previous forecast') : t('天气暂不可用，请稍后重试','Weather unavailable. Please retry later.')}<Button type="link" size="small" onClick={()=>setRetryAttempt(value=>value+1)}>{t('重试','Retry')}</Button></div>}
      <small>{t('空间插值预报，非雷达实况','Interpolated forecast, not live radar')}</small>
    </div>}
  </>
}
