import { Alert, Button, Divider, Drawer, Input, QRCode, Radio, Space, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../stores/settings'

interface Place {id:string;name:string;address:string;city:string}
interface Quote {id:string;origin:Place;destination:Place;items:Array<{product_category:string;name:string;price:string}>}

async function request<T>(path:string,payload?:unknown):Promise<T> {
  const response=await fetch('/api/v1/didi/'+path,payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {})
  const data=await response.json()
  if(!response.ok) throw Error(typeof data.detail==='string' ? data.detail : 'DiDi request failed')
  return data
}

export function DidiRideDrawer({open,onClose,origin,destination,city='',onSettings}:{open:boolean;onClose:()=>void;origin:string;destination:string;city?:string;onSettings?:()=>void}) {
  const t=useT()
  const [configured,setConfigured]=useState<boolean>()
  const [form,setForm]=useState({city:'',destinationCity:'',origin:'',destination:''})
  const [starts,setStarts]=useState<Place[]>([]),[ends,setEnds]=useState<Place[]>([])
  const [start,setStart]=useState(''),[end,setEnd]=useState('')
  const [quote,setQuote]=useState<Quote>(),[category,setCategory]=useState(''),[link,setLink]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0)
  useEffect(()=>{
    if(!open) return
    const ticket=++generation.current
    setConfigured(undefined);setBusy(false);setError('')
    setForm({city,destinationCity:'',origin:origin==='我的位置' ? '' : origin,destination:destination==='我的位置' ? '' : destination})
    setStarts([]);setEnds([]);setStart('');setEnd('');setQuote(undefined);setCategory('');setLink('')
    void request<{configured:boolean}>('status').then(data=>{if(ticket===generation.current)setConfigured(data.configured)}).catch(()=>{if(ticket===generation.current)setError(t('滴滴状态加载失败，请关闭后重试','Could not load DiDi settings. Close and retry.'))})
    return ()=>{generation.current++}
  },[open])
  function edit(key:keyof typeof form,value:string) {
    setForm(current=>({...current,[key]:value}));setStarts([]);setEnds([]);setStart('');setEnd('');setQuote(undefined);setLink('');setCategory('')
  }
  async function run(action:(current:()=>boolean)=>Promise<void>) {
    const ticket=++generation.current
    setBusy(true);setError('')
    try {await action(()=>ticket===generation.current)}
    catch(error) {if(ticket===generation.current)setError(error instanceof Error ? error.message : t('滴滴查询失败','DiDi request failed'))}
    finally {if(ticket===generation.current)setBusy(false)}
  }
  const valid=form.city.trim() && form.origin.trim() && form.destination.trim()
  return <Drawer title={t('滴滴打车','DiDi rides')} open={open} onClose={onClose} width={520} destroyOnHidden>
    {configured===undefined && !error && <Spin />}
    {configured===false && <Alert type="info" showIcon message={t('先配置滴滴个人 MCP Key','Configure your personal DiDi MCP key')} description={t('在“设置 → API 接口”中填写后，可查询车型、预估价格并跳转滴滴确认叫车。','Add the key in Settings → API connections to get fare estimates and continue in DiDi.')} action={onSettings && <Button onClick={onSettings}>{t('前往配置','Open settings')}</Button>} />}
    {error && <Alert type="error" showIcon message={error} style={{marginBottom:16}} />}
    {configured && <Space orientation="vertical" size={14} style={{width:'100%'}}>
      <Typography.Text type="secondary">{t('确认上下车点和车型后，在滴滴 App 内完成叫车。','Confirm your stops and car type, then finish booking in the DiDi app.')}</Typography.Text>
      <label>{t('出发城市','Departure city')}<Input disabled={busy} value={form.city} placeholder={t('例如：兰州市','e.g. Lanzhou city')} onChange={e=>edit('city',e.target.value)} /></label>
      <label>{t('上车点','Pickup')}<Input disabled={busy} value={form.origin} placeholder={t('填写具体上车地点','Enter a specific pickup location')} onChange={e=>edit('origin',e.target.value)} /></label>
      <label>{t('目的城市','Destination city')}<Input disabled={busy} value={form.destinationCity} placeholder={t('留空表示与出发城市相同','Leave blank for the same city')} onChange={e=>edit('destinationCity',e.target.value)} /></label>
      <label>{t('下车点','Drop-off')}<Input disabled={busy} value={form.destination} onChange={e=>edit('destination',e.target.value)} /></label>
      <Button disabled={!valid || busy} loading={busy} onClick={()=>void run(async current=>{
        const [from,to]=await Promise.all([request<Place[]>('places',{city:form.city,keywords:form.origin}),request<Place[]>('places',{city:form.destinationCity || form.city,keywords:form.destination})])
        if(current()){setStarts(from);setEnds(to);setStart('');setEnd('');setQuote(undefined);setCategory('');setLink('')}
      })}>{t('查找上下车点','Find pickup & drop-off')}</Button>
      {starts.length>0 && <><Divider>{t('确认地点','Confirm places')}</Divider>
        <Typography.Text strong>{t('上车点','Pickup')}</Typography.Text>
        <Radio.Group disabled={busy} value={start} onChange={e=>{setStart(e.target.value);setQuote(undefined);setLink('');setCategory('')}}><Space orientation="vertical">{starts.map(place=><Radio value={place.id} key={place.id}><strong>{place.name}</strong><div>{place.city} · {place.address}</div></Radio>)}</Space></Radio.Group>
        <Typography.Text strong>{t('下车点','Drop-off')}</Typography.Text>
        <Radio.Group disabled={busy} value={end} onChange={e=>{setEnd(e.target.value);setQuote(undefined);setLink('');setCategory('')}}><Space orientation="vertical">{ends.map(place=><Radio value={place.id} key={place.id}><strong>{place.name}</strong><div>{place.city} · {place.address}</div></Radio>)}</Space></Radio.Group>
        <Button type="primary" disabled={!start || !end || busy} loading={busy} onClick={()=>void run(async current=>{
          const data=await request<Quote>('estimate',{origin_id:start,destination_id:end})
          if(current()){setQuote(data);setCategory('');setLink('')}
        })}>{t('查询车型与预估价','Get car types & estimates')}</Button>
      </>}
      {quote && <><Divider>{t('车型与预估费用','Car types & estimated fares')}</Divider>
        <Typography.Text>{quote.origin.name} → {quote.destination.name}</Typography.Text>
        <Radio.Group disabled={busy} value={category} onChange={e=>{setCategory(e.target.value);setLink('')}}><Space orientation="vertical">{quote.items.map((item,index)=><Radio value={item.product_category} key={`${item.product_category}-${index}`}>{item.name} · {/^\d+(\.\d+)?$/.test(item.price) ? `¥${item.price}` : item.price}</Radio>)}</Space></Radio.Group>
        <Typography.Text type="secondary">{t('预估价格仅供参考，最终费用以滴滴显示为准。','Estimates are indicative. Confirm the final fare in DiDi.')}</Typography.Text>
        {!link && <Button type="primary" disabled={!category || busy} loading={busy} onClick={()=>void run(async current=>{
          const data=await request<{url:string}>('app-link',{quote_id:quote.id,product_category:category})
          if(current())setLink(data.url)
        })}>{t('生成滴滴跳转链接','Get DiDi app link')}</Button>}
      </>}
      {link && <><Button type="primary" href={link}>{t('去滴滴 App 确认叫车','Continue in DiDi')}</Button><QRCode value={link} size={160} /><Typography.Text type="secondary">{t('需安装滴滴出行 App；也可用手机扫码打开。','Requires the DiDi app. You can also scan with your phone.')}</Typography.Text></>}
    </Space>}
  </Drawer>
}
