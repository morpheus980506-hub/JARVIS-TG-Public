import { ArrowUpOutlined, CalendarOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, LeftOutlined, MessageOutlined, PlusOutlined, RightOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Avatar, Button, Card, Drawer, Input, Modal, Popconfirm, Space, Typography } from 'antd'
import { Fragment,useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TravelResultCards } from '../components/TravelResultCards'
import { CandidateSelection,WorkspaceSelections,loadWorkspace } from '../components/TripWorkspace'
import { DidiRideDrawer } from '../components/DidiRideDrawer'
import { QueryProgress } from '../components/QueryProgress'
import { ItineraryText } from '../components/ItineraryText'
import jarvisAvatar from '../assets/jarvis-avatar.png'
import { createConversation, deleteConversation, getConversation, intakeTripStream, listConversations, renameConversation } from '../services/api'
import { createTypewriter } from '../services/typewriter'
import { trackProgress } from '../services/progress'
import { splitWebSources } from '../services/webSources'
import { chatTimeSeparators } from '../services/chatTimes'
import { itineraryNotice } from '../services/itineraryStatus'
import { useTripStore } from '../stores/trip'
import { useSettings, useT } from '../stores/settings'
import type { ChatMessage, ConversationSummary, ItinerarySnapshot, TripRequestPayload,TripPlan,TravelCandidate,TravelResult } from '../types'

const renderMarkdown = (text: string) => <ReactMarkdown remarkPlugins={[[remarkGfm, {singleTilde: false}]]} components={{a: props => <a {...props} target="_blank" rel="noreferrer" />}}>{text}</ReactMarkdown>

function Markdown({text}: {text: string}) {
  const {body, heading, sources} = splitWebSources(text)
  return <>{renderMarkdown(body)}{sources && <footer className="chat-web-sources" aria-label={heading}>
    <span>{heading}</span>{renderMarkdown(sources)}
  </footer>}</>
}

export function PlannerPage({flightRequest,conversationRequest,onSettings,onItinerary}: {flightRequest?:{id:number;text:string};conversationRequest?:{id?:string;ticket:number};onSettings?:()=>void;onItinerary?:(id:string)=>void}) {
  const t = useT()
  const language = useSettings(state => state.language)
  const {message: toast} = App.useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [clockNow,setClockNow]=useState(Date.now)
  useEffect(()=>{const timer=window.setInterval(()=>setClockNow(Date.now()),60000);return ()=>window.clearInterval(timer)},[])
  const timeSeparators=chatTimeSeparators(messages,language,clockNow)
  const [input, setInput] = useState('')
  const [intakeLoading, setIntakeLoading] = useState(false)
  const [replyStatus,setReplyStatus]=useState<string>()
  const [progress, setProgress] = useState('')
  const [streamingReply, setStreamingReply] = useState('')
  const [request, setRequest] = useState<TripRequestPayload>()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [itinerary, setItinerary] = useState<ItinerarySnapshot | null>(null)
  const [itineraryOpen, setItineraryOpen] = useState(false)
  const [itineraryStale, setItineraryStale] = useState(false)
  const [rename, setRename] = useState<{id: string; title: string}>()
  const [renaming, setRenaming] = useState(false)
  const [travelResults,setTravelResults]=useState<TravelResult[]>([])
  const [candidate,setCandidate]=useState<TravelCandidate>()
  const [rideRequest,setRideRequest]=useState<{city:string;origin:string;destination:string}>()
  const [finalizing,setFinalizing]=useState(false)
  const [unsavedPlan,setUnsavedPlan]=useState<{id:string;plan:TripPlan}>()
  const chatRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const switchTicket = useRef(0)
  const writer = useRef<ReturnType<typeof createTypewriter> | undefined>(undefined)
  const intakeController=useRef<AbortController|undefined>(undefined)
  const sending=useRef(false),planningLatch=useRef(false)
  const {loading, error, run, reset,workspace} = useTripStore()
  const hasTrip=Boolean(itinerary || workspace?.selections.length)
  const pending = intakeLoading || loading || historyLoading || finalizing
  const handledFlight = useRef<number | undefined>(undefined)
  const handledConversation=useRef<number | undefined>(undefined)
  useEffect(()=>{
    if(!conversationRequest || pending || handledConversation.current===conversationRequest.ticket)return
    handledConversation.current=conversationRequest.ticket
    if(conversationRequest.id)void openConversation(conversationRequest.id)
    else newConversation()
  },[conversationRequest,pending])
  useEffect(() => {
    if (!flightRequest || pending || handledFlight.current === flightRequest.id) return
    handledFlight.current = flightRequest.id
    void sendMessage(flightRequest.text)
  }, [flightRequest,pending])
  useEffect(() => {
    void refresh()
    const previous=localStorage.getItem('jarvis-active-conversation')
    if(previous)void openConversation(previous)
    return () => { intakeController.current?.abort();writer.current?.stop(); switchTicket.current++ }
  }, [])
  useEffect(() => {
    if (followLatest.current && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, streamingReply, progress])

  async function refresh() {
    try { setConversations(await listConversations()) }
    catch { void toast.error(t('历史对话加载失败','Could not load conversations')) }
  }
  function newConversation() {
    if (pending || sending.current || planningLatch.current) return
    switchTicket.current++
    setActiveId(undefined); setMessages([]); setInput(''); setRequest(undefined)
    setReplyStatus(undefined)
    setItinerary(null); setItineraryOpen(false); setItineraryStale(false); reset()
    setTravelResults([]);setCandidate(undefined);setRideRequest(undefined);localStorage.removeItem('jarvis-active-conversation')
    setUnsavedPlan(undefined)
    followLatest.current = true
  }
  async function openConversation(id: string) {
    if (pending || sending.current || planningLatch.current) return
    const ticket = ++switchTicket.current
    setHistoryLoading(true)
    try {
      const detail = await getConversation(id)
      if (ticket !== switchTicket.current) return
      const restored=await loadWorkspace(id,undefined,false)
      if(ticket!==switchTicket.current)return
      useTripStore.getState().setWorkspace(id,restored)
      setActiveId(id); setMessages(detail.messages); setInput(''); setRequest(detail.ready ? detail.trip_request : undefined)
      setReplyStatus(detail.reply_status)
      setItinerary(detail.itinerary ?? null); setItineraryOpen(false); setItineraryStale(Boolean(detail.itinerary?.pending_revision))
      setTravelResults(detail.travel_results || []);setCandidate(undefined);setRideRequest(undefined)
      setUnsavedPlan(undefined)
      setItinerary(restored.itinerary ?? detail.itinerary ?? null)
      localStorage.setItem('jarvis-active-conversation',id)
      setHistoryOpen(false);followLatest.current = true
    } catch { void toast.error(t('对话加载失败','Could not open conversation')) }
    finally { if (ticket === switchTicket.current) setHistoryLoading(false) }
  }
  async function remove(id: string) {
    try { await deleteConversation(id); if (activeId === id) newConversation(); await refresh() }
    catch { void toast.error(t('删除失败','Delete failed')) }
  }
  async function confirmRename() {
    if (!rename?.title.trim()) return
    setRenaming(true)
    try { await renameConversation(rename.id, rename.title.trim()); setRename(undefined); await refresh() }
    catch { void toast.error(t('重命名失败','Rename failed')) }
    finally { setRenaming(false) }
  }
  function stopReply(){intakeController.current?.abort();writer.current?.stop();setReplyStatus('stopped')}
  async function sendMessage(override?: string,retry=false) {
    const text = (override ?? input).trim()
    if (!text || pending || sending.current || planningLatch.current) return
    if(text.length>4000){void toast.warning(t('单条消息请控制在4000字以内，内容已保留','Please keep a message under 4,000 characters. Your text is kept.'));return}
    if(messages.length>=200){void toast.warning(t('这段对话已达到当前长度上限，请新建对话；历史行程仍会保留','This conversation reached its current length limit. Start a new chat; saved trips are kept.'));return}
    sending.current=true
    const outgoing: ChatMessage = {
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    const next = retry && messages.at(-1)?.role === 'user' ? messages : [...messages, outgoing]
    setReplyStatus(undefined)
    setMessages(next); setInput(''); setIntakeLoading(true); setStreamingReply(''); setProgress('')
    setRequest(undefined); followLatest.current = true
    if (itinerary && /改|换|调整|第.*天|D\d|change|replace|revise|day \d/i.test(text)) setItineraryStale(true)
    writer.current = createTypewriter(setStreamingReply)
    intakeController.current=new AbortController()
    let supplierStarted=false
    const updateProgress = trackProgress(language)
    try {
      let id = activeId
      if (!id) { id = (await createConversation(t('新对话','New chat'),next.length===1 ? next[0] : undefined)).id; setActiveId(id);localStorage.setItem('jarvis-active-conversation',id);await loadWorkspace(id) }
      const response = await intakeTripStream(next, event => {
        if(event.stage?.startsWith('supplier_') && !supplierStarted){supplierStarted=true;setTravelResults([])}
        if(event.travel_result)setTravelResults(previous=>[...previous.filter(result=>result.provider!==event.travel_result!.provider),event.travel_result!])
        if (event.type === 'progress') setProgress(updateProgress(event))
        if (event.type === 'delta' && event.content) writer.current?.append(event.content)
      }, id,intakeController.current.signal)
      await writer.current.finish(response.reply)
      if(intakeController.current.signal.aborted)return
      setMessages(current => [...current, {role:'assistant',content:response.reply,created_at:response.reply_created_at || new Date().toISOString()}])
      setReplyStatus('complete')
      if(response.travel_results)setTravelResults(response.travel_results)
      if(response.ride_request)setRideRequest(response.ride_request)
      if (response.itinerary !== undefined) { setItinerary(response.itinerary ?? null); setItineraryStale(Boolean(response.itinerary?.pending_revision)); if (!response.itinerary) setItineraryOpen(false) }
      setRequest(response.ready ? response.trip_request : undefined)
      try {await loadWorkspace(id)} catch {void toast.warning(t('回复已收到，行程资料暂未同步，可重新打开对话重试','Reply received. Trip details did not sync; reopen the conversation to retry.'))}
      await refresh()
    } catch (reason) {
      if(!intakeController.current?.signal.aborted)setMessages(current => [...current, {role:'assistant',content:reason instanceof Error ? reason.message : t('消息发送失败，请重试。','Message failed. Please retry.'),created_at:new Date().toISOString()}])
    } finally {
      sending.current=false
      writer.current?.stop(); setIntakeLoading(false); setStreamingReply(''); setProgress('')
    }
  }
  async function persistPlan(id:string,plan:TripPlan,ticket:number) {
    setProgress(t('正在保存当前行程…','Saving this itinerary…'))
    try {
      const saved=await loadWorkspace(id,plan.trip_id,false,language)
      if(ticket!==switchTicket.current || useTripStore.getState().conversationId!==id)return
      useTripStore.getState().setWorkspace(id,saved)
      setItinerary(saved.itinerary ?? null);setItineraryStale(false);setRequest(undefined);setUnsavedPlan(undefined)
      if(saved.plan_feedback){
        const text=saved.plan_feedback.text
        setMessages(previous=>previous.some(item=>item.role==='assistant' && item.content===text) ? previous : [...previous,{role:'assistant',content:text,created_at:saved.plan_feedback?.created_at}])
      }
      followLatest.current=true
      void toast.success(t('行程已保存','Itinerary saved'))
      void refresh()
    } catch {
      if(ticket===switchTicket.current)setUnsavedPlan({id,plan})
    }
  }
  async function startPlanning() {
    if (!request || !activeId || pending || planningLatch.current || sending.current) return
    planningLatch.current=true
    const id=activeId,ticket=switchTicket.current
    setFinalizing(true);setProgress(t('正在整理行程需求…','Preparing your trip…'))
    const updateProgress = trackProgress(language)
    try {
      const plan=await run(request,event=>{if(event.type==='progress')setProgress(updateProgress(event))})
      if(!plan || ticket!==switchTicket.current || useTripStore.getState().conversationId!==id)return
      setItinerary({updated_at:new Date().toISOString(),days:plan.itinerary.map(day=>({day:day.day,title:day.title,items:day.activities}))})
      setItineraryStale(false)
      await persistPlan(id,plan,ticket)
    } finally {planningLatch.current=false;setFinalizing(false)}
  }

  async function chooseCandidate(item:TravelCandidate) {
    let id=activeId
    if(!id){id=(await createConversation(t('旅行候选','Travel options'))).id;setActiveId(id);localStorage.setItem('jarvis-active-conversation',id);await loadWorkspace(id);await refresh()}
    setCandidate(item)
  }

  const historyList = <>
    <Input.Search value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder={t('搜索历史对话','Search conversations')} allowClear />
    <div className="conversation-list">
      {!conversations.length && <div className="conversation-empty">{t('对话会自动保存在这里','Your conversations appear here')}</div>}
      {conversations.filter(item => item.title.toLowerCase().includes(historySearch.toLowerCase())).map(item => <div className={`conversation-item ${item.id === activeId ? 'active' : ''}`} key={item.id}>
        <button className="conversation-select" disabled={pending} onClick={() => void openConversation(item.id)}><div className="conversation-item-title">{item.title}</div><div className="conversation-item-meta">{new Date(item.updated_at).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')}</div></button>
        <Button type="text" size="small" icon={<EditOutlined />} title={t('重命名','Rename')} aria-label={t('重命名','Rename')} disabled={pending} onClick={() => setRename({id:item.id,title:item.title})} />
        <Popconfirm title={t('删除这段对话？','Delete this conversation?')} disabled={pending} onConfirm={() => void remove(item.id)}><Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={pending} aria-label={t('删除','Delete')} /></Popconfirm>
      </div>)}
    </div>
  </>
  const suggestions = [t('推荐一个周末目的地','Suggest a weekend destination'),t('帮我安排一次自驾旅行','Help me plan a road trip'),t('推荐合适的住宿区域','Suggest areas to stay')]
  const streaming = intakeLoading && Boolean(streamingReply)

  return <div className="planner-page">
    <div className="planner-heading"><Typography.Title level={2}>{t('今天想去哪里？','Where to next?')}</Typography.Title><Space>
      <Button className="mobile-history-button" icon={<MessageOutlined />} onClick={() => setHistoryOpen(true)}>{t('历史','History')}</Button>
      <Button type="primary" icon={<PlusOutlined />} disabled={pending} onClick={newConversation}>{t('新对话','New chat')}</Button>
    </Space></div>
    <div className={`planner-workspace ${historyCollapsed ? 'history-collapsed' : ''} ${hasTrip ? 'has-itinerary' : ''} ${itineraryOpen ? 'itinerary-expanded' : ''}`}>
      <aside className="history-panel">
        <div className="history-panel-heading"><span className="history-label">{t('历史对话','Conversations')}</span><Button type="text" size="small" icon={historyCollapsed ? <RightOutlined /> : <LeftOutlined />} onClick={() => setHistoryCollapsed(value => !value)} aria-label={t('展开或折叠历史','Toggle history')} /></div>
        <div className="history-panel-content" inert={historyCollapsed}>{historyList}</div>
      </aside>
      <Card className="hero-card chat-card" loading={historyLoading}>
        <div className="chat-history" ref={chatRef} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90 }}>
          {!messages.length && <div className="chat-welcome"><Avatar size={56} src={jarvisAvatar} /></div>}
          {messages.map((item,index) => <Fragment key={index}>
            {timeSeparators[index] && <div className="chat-time-separator">{item.created_at ? <time dateTime={item.created_at}>{timeSeparators[index]}</time> : timeSeparators[index]}</div>}
            <div className={`chat-row ${item.role}`}>
            {item.role === 'assistant' && <Avatar src={jarvisAvatar} className="chat-avatar" />}
            <div className="chat-message-stack"><div className={`chat-bubble ${item.role === 'assistant' ? 'markdown-body' : ''}`}>{item.role === 'assistant' ? <Markdown text={item.content} /> : item.content}
              {item.role==='assistant' && item.content===workspace?.plan_feedback?.text && <Button size="small" icon={<CalendarOutlined />} onClick={()=>{if(onItinerary && activeId)onItinerary(activeId);else setItineraryOpen(true)}}>{t('查看行程','View itinerary')}</Button>}
            </div></div>
            {item.role === 'user' && <Avatar icon={<UserOutlined />} />}
          </div></Fragment>)}
          {travelResults.length>0 && <TravelResultCards results={travelResults} onSelect={item=>void chooseCandidate(item)} />}
          {intakeLoading && !streamingReply && <div className="chat-row assistant thinking-row"><Avatar src={jarvisAvatar} className="chat-avatar" /><QueryProgress message={progress || t('正在处理…','Working…')} onStop={stopReply} /></div>}
          {streamingReply && <div className="chat-row assistant"><Avatar src={jarvisAvatar} /><div className="chat-message-stack"><div className="chat-bubble markdown-body streaming-text"><Markdown text={streamingReply} /></div></div></div>}
          {(loading || finalizing) && <div className="chat-row assistant thinking-row"><Avatar src={jarvisAvatar} className="chat-avatar" /><QueryProgress message={progress || t('正在生成行程…','Building itinerary…')} onStop={loading ? ()=>{useTripStore.getState().cancel();void toast.info(t('已停止生成，原有行程已保留','Generation stopped. Your saved plan is kept.'))} : undefined} /></div>}
          {!pending && ['stopped','generating'].includes(replyStatus || '') && messages.at(-1)?.role==='user' && <Alert type="info" message={t('上一条回复未完成，你发送的问题已保留','The previous reply did not finish. Your question is saved.')} action={<Button onClick={()=>void sendMessage(messages.at(-1)?.content,true)}>{t('继续回复','Continue reply')}</Button>} />}
        </div>
        {request && !pending && <div className="chat-plan-action"><Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void startPlanning()}>{t('生成行程','Build itinerary')}</Button></div>}
        {!messages.length && !pending && <div className="chat-suggestions">{suggestions.map(text => <Button key={text} size="small" type="text" onClick={() => setInput(text)}>{text}</Button>)}</div>}
        <div className="chat-composer">
          <Input.TextArea variant="borderless" value={input} maxLength={4000} showCount={input.length>3500} disabled={loading || historyLoading} autoSize={{minRows:1,maxRows:6}} onChange={e => setInput(e.target.value)} aria-label={t('消息','Message')} placeholder={t('发消息……','Message JARVIS…')} onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault()
            const field = e.currentTarget
            const start = field.selectionStart
            setInput(field.value.slice(0,start) + '\n' + field.value.slice(field.selectionEnd))
            requestAnimationFrame(() => field.setSelectionRange(start + 1,start + 1))
            return
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage() }
          }} />
          {streaming
            ? <Button shape="circle" icon={<StopOutlined />} aria-label={t('停止回复','Stop reply')} title={t('停止回复','Stop reply')} onClick={stopReply} />
            : <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} aria-label={t('发送','Send')} title={t('发送','Send')} disabled={pending || !input.trim()} onClick={() => void sendMessage()} />}
        </div>
      </Card>
      {hasTrip && <aside className={`itinerary-sidebar ${itineraryOpen ? 'open' : ''}`}>
        <Button className="itinerary-toggle" type="text" icon={itineraryOpen ? <RightOutlined /> : <CalendarOutlined />} onClick={() => setItineraryOpen(value => !value)} aria-expanded={itineraryOpen}>{t('行程','Itinerary')}</Button>
        {itineraryOpen && <div className="itinerary-body">
          {itineraryNotice(itinerary,itineraryStale,language) && <Alert type="warning" message={itineraryNotice(itinerary,itineraryStale,language)} />}
          {intakeLoading && <Typography.Paragraph type="secondary">{t('正在核对最新安排…','Checking the latest changes…')}</Typography.Paragraph>}
          {(itinerary?.days || []).map(day => <section key={day.day}><h3>{t('第','Day ')}{day.day}{t('天','')} · <ItineraryText text={day.title} /></h3><ul>{day.items.map((item,index) => <li key={index}><ItineraryText text={item} /></li>)}</ul></section>)}
          <WorkspaceSelections />
        </div>}
      </aside>}
    </div>
    {error && <Alert type="error" message={error} />}
    {unsavedPlan && unsavedPlan.id===activeId && <Alert type="warning" message={t('保存结果尚未确认，可重试保存，无需重新查询','Save confirmation is missing. Retry saving without querying again.')} action={<Button disabled={pending} onClick={async()=>{setFinalizing(true);try{await persistPlan(unsavedPlan.id,unsavedPlan.plan,switchTicket.current)}finally{setFinalizing(false)}}}>{t('重试保存','Retry save')}</Button>} />}
    <Drawer title={t('历史对话','Conversations')} placement="left" open={historyOpen} onClose={() => setHistoryOpen(false)}>{historyList}</Drawer>
    <CandidateSelection candidate={candidate} conversationId={activeId} onClose={()=>setCandidate(undefined)} />
    <DidiRideDrawer open={Boolean(rideRequest)} onClose={()=>setRideRequest(undefined)} origin={rideRequest?.origin || ''} destination={rideRequest?.destination || ''} city={rideRequest?.city || ''} onSettings={()=>{setRideRequest(undefined);onSettings?.()}} />
    <Modal title={t('重命名对话','Rename conversation')} open={Boolean(rename)} onCancel={() => setRename(undefined)} onOk={() => void confirmRename()} confirmLoading={renaming} okButtonProps={{disabled:!rename?.title.trim()}}>
      <Input autoFocus maxLength={160} value={rename?.title ?? ''} onChange={e => setRename(current => current ? {...current,title:e.target.value} : current)} onPressEnter={() => void confirmRename()} />
    </Modal>
  </div>
}
