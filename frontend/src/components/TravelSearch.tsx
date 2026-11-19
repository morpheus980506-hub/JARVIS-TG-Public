import { Alert, Button, Card, Checkbox, Empty, Input, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useT } from '../stores/settings'
import { safeTravelLink as safeLink } from '../services/travelLinks'
import type { TravelCandidate } from '../types'
import { isTripPlace } from '../services/tripPlaces'

type Provider='fliggy'|'meituan'
interface Service {id:Provider;configured:boolean;client_installed:boolean}
interface SearchResult {provider:Provider;text:string;notice:string;items:TravelCandidate[];queried_at:string}
interface ResultState {loading:boolean;result?:SearchResult;error?:string}
const names:Record<Provider,[string,string]>={fliggy:['飞猪','Fliggy'],meituan:['美团旅行','Meituan']}

export function TravelSearch({destination='',onSettings,onSelect}:{destination?:string;onSettings?:()=>void;onSelect?:(candidate:TravelCandidate)=>void}) {
  const t=useT()
  const [services,setServices]=useState<Service[]>([]),[selected,setSelected]=useState<Provider[]>([])
  const [city,setCity]=useState(isTripPlace(destination) ? destination : ''),[query,setQuery]=useState('')
  const [states,setStates]=useState<Partial<Record<Provider,ResultState>>>({})
  const [statusError,setStatusError]=useState(false),[loading,setLoading]=useState(true)
  const ticket=useRef(0),controllers=useRef<AbortController[]>([])
  useEffect(()=>{
    const controller=new AbortController()
    void fetch('/api/v1/travel/services',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error()
      const entries:Service[]=await response.json()
      setServices(entries);setSelected(entries.filter(s=>s.configured && s.client_installed).map(s=>s.id))
    }).catch(()=>{if(!controller.signal.aborted)setStatusError(true)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>{controller.abort();ticket.current++;controllers.current.forEach(c=>c.abort())}
  },[])
  const busy=Object.values(states).some(s=>s.loading)
  function errorText(code:string) {
    switch(code) {
      case 'invalid_city':return t('请输入城市或区县名称','Enter a city or district name')
      case 'not_configured':return t('请先在设置中配置接口','Configure this service in Settings first')
      case 'client_missing':return t('本机查询组件未就绪','The local search client is not ready')
      case 'auth':return t('授权未通过，请检查密钥和接口权限','Authorization failed. Check your key and access.')
      case 'timeout':return t('查询超时，可单独重试这家平台','Timed out. Retry this provider separately.')
      default:return t('暂未取得可用结果，请稍后重试','No usable response. Please retry later.')
    }
  }
  async function search(providers:Provider[],newSearch=true) {
    if (!isTripPlace(city) || query.trim().length < 2 || !providers.length || busy) return
    if(newSearch){controllers.current.forEach(c=>c.abort());controllers.current=[];ticket.current++}
    const current=ticket.current,searchCity=city.trim(),searchQuery=query.trim()
    setStates(previous=>({...(!newSearch ? previous : {}),...Object.fromEntries(providers.map(id=>[id,{loading:true}]))}))
    await Promise.allSettled(providers.map(async provider=>{
      const controller=new AbortController();controllers.current.push(controller)
      const timer=setTimeout(()=>controller.abort(),175000)
      try {
        const response=await fetch(`/api/v1/travel/search/${provider}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:searchCity,query:searchQuery}),signal:controller.signal})
        const data=await response.json()
        if(!response.ok)throw Error(data.detail?.code || 'upstream')
        if(ticket.current===current)setStates(previous=>({...previous,[provider]:{loading:false,result:data}}))
      } catch(error) {
        if(ticket.current===current)setStates(previous=>({...previous,[provider]:{loading:false,error:errorText(controller.signal.aborted ? 'timeout' : error instanceof Error ? error.message : 'upstream')}}))
      } finally {clearTimeout(timer)}
    }))
  }
  return <div className="travel-search">
    {loading && <Spin />}
    {statusError && <Alert type="error" showIcon message={t('查询服务加载失败，请重新打开','Could not load services. Reopen to retry.')} />}
    <form onSubmit={e=>{e.preventDefault();void search(selected)}} className="travel-search-form">
      <label>{t('城市','City')}<Input value={city} maxLength={80} disabled={busy} placeholder={t('例如：兰州','e.g. Lanzhou')} onChange={e=>{setCity(e.target.value);setStates({})}} /></label>
      <label>{t('想查什么？','What are you looking for?')}<Input.TextArea value={query} disabled={busy} maxLength={2000} autoSize={{minRows:3,maxRows:6}} placeholder={t('例如：11月20日至22日，杭州西湖附近双床房，每晚500元以内','e.g. Twin rooms near West Lake, Hangzhou, Nov 20–22, under ¥500 per night')} onChange={e=>{setQuery(e.target.value);setStates({})}} /></label>
      <Space wrap>{services.map(service=><Checkbox key={service.id} disabled={busy || !service.configured || !service.client_installed} checked={selected.includes(service.id)} onChange={e=>setSelected(previous=>e.target.checked ? [...previous,service.id] : previous.filter(id=>id!==service.id))}>{t(...names[service.id])}{!service.configured ? <Tag>{t('待配置','Not configured')}</Tag> : !service.client_installed ? <Tag>{t('组件未就绪','Client missing')}</Tag> : null}</Checkbox>)}</Space>
      {services.some(s=>!s.configured) && <div className="travel-search-setup"><Typography.Text type="secondary">{t('先在设置 → API 接口填写平台密钥。','Add platform keys in Settings → API connections.')}</Typography.Text>{onSettings && <Button type="link" size="small" onClick={onSettings}>{t('前往配置','Open settings')}</Button>}</div>}
      {city.trim() && !isTripPlace(city) && <Typography.Text type="danger">{t('请输入城市或区县名称','Enter a city or district name')}</Typography.Text>}
      <Button type="primary" htmlType="submit" disabled={!isTripPlace(city) || query.trim().length<2 || !selected.length || busy} loading={busy}>{t('查询','Search')}</Button>
    </form>
    {Object.entries(states).map(([key,state])=>{
      const provider=key as Provider,result=state.result
      return <Card size="small" key={provider} title={t(...names[provider])} extra={result && <Typography.Text type="secondary">{new Date(result.queried_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Typography.Text>}>
        {state.loading && <Space><Spin size="small" /><Typography.Text type="secondary">{provider==='meituan' ? t('正在查询，可能需要1–2分钟…','Searching; this may take 1–2 minutes…') : t('正在查询…','Searching…')}</Typography.Text></Space>}
        {state.error && <Alert type="warning" message={state.error} action={<Button disabled={busy} onClick={()=>void search([provider],false)}>{t('重试','Retry')}</Button>} />}
        {result && <>
          {result.items.map((item,index)=><article className="travel-search-item" key={index}><Typography.Text strong>{item.title}</Typography.Text>{item.price_text && <Typography.Text>{item.price_text}</Typography.Text>}<div>{item.tags.map((tag,i)=><Tag key={i}>{tag}</Tag>)}</div>{safeLink(item.url || undefined,provider) && <Typography.Link href={safeLink(item.url || undefined,provider)} target="_blank" rel="noreferrer">{t('查看详情 ↗','View details ↗')}</Typography.Link>}{onSelect && <Button size="small" onClick={()=>onSelect({...item,provider})}>{t('加入行程','Add to trip')}</Button>}</article>)}
          {result.text && <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:()=>null,a:({href,children})=>{const url=safeLink(href,provider);return url ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>}}}>{result.text}</ReactMarkdown></div>}
          {!result.text && !result.items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('平台没有返回匹配结果','No matching results returned')} />}
          {result.notice && <Typography.Paragraph type="secondary">{result.notice}</Typography.Paragraph>}
        </>}
      </Card>
    })}
    {Object.values(states).some(s=>s.result) && <Typography.Paragraph type="secondary">{t('价格、房态和退改规则以平台详情页为准，预订在平台内确认。','Confirm prices, availability and cancellation terms on the provider’s page. Complete bookings there.')}</Typography.Paragraph>}
  </div>
}
