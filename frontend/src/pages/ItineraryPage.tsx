import { Alert, Button, Card, Collapse, Empty, Input, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, RightOutlined } from '@ant-design/icons'
import { useEffect,useRef,useState } from 'react'
import { createTripStore } from '../stores/trip'
import { TripScope,useScopedTripStore } from '../stores/tripScope'
import { useSettings,useT } from '../stores/settings'
import { itineraryNotice,itineraryBadge } from '../services/itineraryStatus'
import { WorkspaceSelections,loadWorkspace } from '../components/TripWorkspace'
import { ItineraryText } from '../components/ItineraryText'
import { listItineraries } from '../services/api'
import type { SavedItinerary } from '../services/api'
import type { TripPlan } from '../types'
import { TransportPage } from './TransportPage'
import { HotelPage } from './HotelPage'
import { BudgetPage } from './BudgetPage'
import { hasTripStays, itineraryRoute } from '../services/tripPlaces'

export function ItineraryPage({onPlan,onSettings,initialConversationId}:{onPlan?:(id?:string)=>void;onSettings?:()=>void;initialConversationId?:string}) {
  const t=useT()
  const language=useSettings(state=>state.language)
  const [entries,setEntries]=useState<SavedItinerary[]>([]),[query,setQuery]=useState('')
  const [loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0)
  const [selected,setSelected]=useState(initialConversationId),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(false)
  const [detailStore]=useState(createTripStore)
  const ticket=useRef(0)
  useEffect(()=>{
    let active=true;setLoading(true);setError(false)
    listItineraries().then(items=>{if(active)setEntries(items)}).catch(()=>{if(active)setError(true)}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[retry])
  useEffect(()=>{
    const current=++ticket.current
    if(!selected){detailStore.getState().reset();setDetailLoading(false);return}
    setDetailLoading(true);setDetailError(false)
    loadWorkspace(selected,undefined,false).then(data=>{if(ticket.current===current)detailStore.getState().setWorkspace(selected,data)})
      .catch(()=>{if(ticket.current===current)setDetailError(true)})
      .finally(()=>{if(ticket.current===current)setDetailLoading(false)})
    return ()=>{ticket.current++}
  },[selected,retry,detailStore])
  if(selected)return <div className="trip-page">
    <Button className="trip-back" type="text" icon={<ArrowLeftOutlined />} onClick={()=>setSelected(undefined)}>{t('全部行程','All itineraries')}</Button>
    {detailLoading ? <div className="trip-loading"><Spin /></div> : detailError ? <Alert type="error" message={t('行程加载失败，可能已被删除','Could not load this itinerary; it may have been deleted')} action={<Button onClick={()=>setRetry(value=>value+1)}>{t('重试','Retry')}</Button>} /> :
      <TripScope.Provider value={detailStore}><ItineraryDetail onPlan={()=>onPlan?.(selected)} onSettings={onSettings} /></TripScope.Provider>}
  </div>
  const visible=entries.filter(item=>[item.title,item.origin,item.destination,...item.preview].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="trip-page">
    <header className="trip-page-heading"><Typography.Title level={2}>{t('我的行程','My itineraries')}</Typography.Title><Button type="primary" onClick={()=>onPlan?.()}>{t('规划新旅程','Plan a new trip')}</Button></header>
    <Input.Search className="trip-search" value={query} onChange={event=>setQuery(event.target.value)} allowClear placeholder={t('搜索目的地或行程','Search destinations or itineraries')} />
    {error && <Alert type="error" message={t('行程列表加载失败','Could not load saved itineraries')} action={<Button onClick={()=>setRetry(value=>value+1)}>{t('重试','Retry')}</Button>} />}
    {loading ? <div className="trip-loading"><Spin /></div> : !error && !visible.length ? <Empty description={query ? t('没有匹配的行程','No matching itineraries') : t('还没有保存的行程','No saved itineraries yet')} /> :
      <div className="trip-catalog">{visible.map(item=><button className="trip-catalog-item" key={item.conversation_id} onClick={()=>setSelected(item.conversation_id)}>
        <span className="trip-catalog-icon"><CalendarOutlined /></span>
        <span className="trip-catalog-main"><strong>{itineraryRoute(item.origin, item.destination) || item.title}</strong>
          <span>{[item.start_date,`${item.days}${t('天',' days')}`,item.travelers ? `${item.travelers}${t('人',' traveler(s)')}` : null].filter(Boolean).join(' · ')}</span>
          <span className="trip-catalog-preview"><ItineraryText text={item.preview.join(' / ')} links={false} /></span>
          <span className="trip-catalog-source">{item.title}</span>
        </span><span className="trip-catalog-end">{itineraryBadge(item,language) && <Tag>{itineraryBadge(item,language)}</Tag>}<RightOutlined /></span>
      </button>)}</div>}
  </div>
}

function ItineraryDetail({ onPlan,onSettings }: { onPlan?: () => void;onSettings?:()=>void }) {
  const useTripStore=useScopedTripStore()
  const t = useT()
  const language=useSettings(state=>state.language)
  const plan = useTripStore(state => state.plan)
  const invalidItinerary = useTripStore(state => state.workspace?.invalid_itinerary)
  const snapshot=useTripStore(state=>state.workspace?.itinerary)
  const days:TripPlan['itinerary']=plan?.itinerary || snapshot?.days.map(day=>({...day,activities:day.items,date:'',notes:[]})) || []
  const notes=[...new Set(days.flatMap(day=>day.notes))]
  const draft=Boolean(plan && !days.some(day=>day.stops?.length))
  const issues=plan?.verification.issues.filter(issue=>issue.status!=='PASS') || []
  const route = itineraryRoute(plan?.requirement.origin, plan?.requirement.destination)
  if (invalidItinerary) return <section className="trip-recovery">
    <Typography.Title level={2}>{t('我的行程','My itinerary')}</Typography.Title>
    <Alert type="warning" showIcon message={t('这份草案的路线有误','This draft has an invalid route')}
      description={t('请回到对话确认出发地和目的地，再重新生成行程。','Confirm the starting point and destination in chat, then regenerate the itinerary.')} />
    {onPlan && <Button onClick={onPlan}>{t('回到对话修改','Edit in chat')}</Button>}
  </section>
  return <div className="trip-page">
    <header className="trip-page-heading"><div><Typography.Title level={2}>{t('我的行程','My itinerary')}</Typography.Title>
      {plan && <Typography.Text type="secondary">{route || t('路线待确认','Route needs confirmation')} · {days.length}{t('天',' days')} · {plan.requirement.travelers}{t('人',' traveler(s)')}</Typography.Text>}
    </div><Space>{draft && <Tag>{t('草案','Draft')}</Tag>}{days.length>0 && onPlan && <Button onClick={onPlan}>{t('回到对话修改','Edit in chat')}</Button>}</Space></header>
    {itineraryNotice(snapshot,false,language) && <Alert type="warning" message={itineraryNotice(snapshot,false,language)} />}
    {!days.length ? <Card><Empty description={t('还没有行程安排','No itinerary yet')} >{onPlan && <Button type="primary" onClick={onPlan}>{t('去规划旅程','Plan a trip')}</Button>}</Empty></Card> :
      <Tabs defaultActiveKey="schedule" items={[
        {key:'schedule',label:t('每日安排','Daily schedule'),children:<>
          {issues.length>0 && <Collapse className="trip-draft-notice" items={[{key:'verification',label:t(`${issues.length}项安排仍需核对`,`${issues.length} itinerary checks need review`),children:<ul>{issues.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}]} />}
          {draft && <Alert className="trip-draft-notice" type="info" message={t('具体游玩地点仍待补充，可回到对话继续细化。','Specific places still need to be added. Continue refining this trip in chat.')} />}
          <div className="trip-days">{days.map(day=><section className="trip-day" key={day.day}>
            <div className="trip-day-date"><strong>D{day.day}</strong><span>{day.date}</span></div>
            <div className="trip-day-content"><h3><ItineraryText text={day.title} /></h3><ul>{day.activities.map((activity,index)=><li key={index}><ItineraryText text={activity} /></li>)}</ul>
              {Boolean(day.stops?.length) && <ul>{day.stops?.map((stop,index)=><li key={index}>
                <a href={stop.source_url} target="_blank" rel="noreferrer">{stop.name} ↗</a>
                {stop.address && <> · {stop.address}</>}
              </li>)}</ul>}
            </div>
          </section>)}</div>
          <WorkspaceSelections />
          {notes.length>0 && <Collapse ghost size="small" items={[{key:'notes',label:t('安排说明与待核对事项','Notes & details to check'),children:<ul>{notes.map(note=><li key={note}><ItineraryText text={note} /></li>)}</ul>}]} />}
        </>},
        ...(plan ? [
          {key:'transport',label:t('交通','Transport'),children:<TransportPage />},
          ...(hasTripStays(plan.requirement) ? [{key:'hotels',label:t('住宿','Stays'),children:<HotelPage onSettings={onSettings} />}] : []),
          {key:'budget',label:t('费用','Costs'),children:<BudgetPage />},
        ] : []),
      ]} />}
    {!days.length && <WorkspaceSelections />}
  </div>
}

