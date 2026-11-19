import { App as AntApp, ConfigProvider, Layout, Menu, Tabs, Typography, theme } from 'antd'
import { CalendarOutlined, CompassOutlined, EnvironmentOutlined, ToolOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useEffect } from 'react'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { useSettings, useT } from './stores/settings'
import { AppearanceSettings } from './pages/AppearanceSettings'
import { ServiceSettings } from './pages/ServiceSettings'
import { PaymentSettings } from './pages/PaymentSettings'
import jarvisAvatar from './assets/jarvis-avatar.png'
import { AgentConsole } from './pages/AgentConsole'
import { ApprovalPage } from './pages/ApprovalPage'
import { ItineraryPage } from './pages/ItineraryPage'
import { MapPage } from './pages/MapPage'
import { PlannerPage } from './pages/PlannerPage'

const { Sider, Content } = Layout


export default function App() {
  const t = useT()
  const {appearance,language} = useSettings()
  const [systemDark,setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = appearance === 'system' ? systemDark : appearance === 'dark'
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const changed = () => setSystemDark(media.matches)
    media.addEventListener('change',changed)
    return () => media.removeEventListener('change',changed)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN' }, [dark,language])
  const items = [
    {key:'request',icon:<CompassOutlined />,label:t('问旅行 · 做计划','Travel assistant')},
    {key:'itinerary',icon:<CalendarOutlined />,label:t('我的行程','My itinerary')},
    {key:'map',icon:<EnvironmentOutlined />,label:t('地图与路线','Map & routes')},
  ]
  const [page, setPage] = useState('request')
  const settingsItem = {key:'settings', icon:<ToolOutlined />, label:t('设置与服务','Settings')}
  const selectPage = (key: string) => {
    if (key === 'itinerary') setItineraryId(undefined)
    setPage(key)
  }
  const [settingsTab,setSettingsTab]=useState('appearance')
  const openServiceSettings=()=>{setSettingsTab('services');setPage('settings')}
  const [flightRequest,setFlightRequest] = useState<{id:number;text:string}>()
  const [conversationRequest,setConversationRequest]=useState<{id?:string;ticket:number}>()
  const [itineraryId,setItineraryId]=useState<string>()
  const chatting = page === 'request'
  const workspace = chatting || page === 'map'
  const goPlan = (id?:string) => {setConversationRequest({id,ticket:Date.now()});setPage('request')}
  const content: Record<string, React.ReactNode> = {
    itinerary: <ItineraryPage key={itineraryId || 'catalog'} initialConversationId={itineraryId} onPlan={goPlan} onSettings={openServiceSettings} />,
    map: <MapPage onFlight={text => {setFlightRequest({id:Date.now(),text});setPage('request')}} onSettings={openServiceSettings} />,
    settings: <><Typography.Title level={2}>{t('设置与服务','Settings')}</Typography.Title><Tabs activeKey={settingsTab} onChange={setSettingsTab} items={[
      { key: 'appearance', label: t('界面偏好','Appearance'), children: <AppearanceSettings /> },
      { key: 'services', label: t('API 接口','API connections'), children: <ServiceSettings /> },
      { key: 'payments', label: t('支付方式','Payment methods'), children: <PaymentSettings /> },
      { key: 'approvals', label: t('操作确认','Action approvals'), children: <ApprovalPage /> },
      { key: 'status', label: t('运行记录','Activity log'), children: <AgentConsole /> },
    ]} /></>,
  }
  return <ConfigProvider locale={language === 'en' ? enUS : zhCN} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: dark ? '#34d6c9' : '#087f83', borderRadius: 12, colorBgBase: dark ? '#07101f' : '#ffffff', fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' } }}><AntApp><div className="app-shell">
    <Sider width={208} trigger={null} className="sider"><div className="brand"><div className="brand-mark"><img src={jarvisAvatar} alt="JARVIS" /></div><div><Typography.Text strong>JARVIS</Typography.Text><small>TRAVEL GUIDER</small></div></div><div className="nav-caption">{t('开始你的旅程','Your next journey')}</div><Menu mode="inline" selectedKeys={[page]} items={items} onClick={({ key }) => selectPage(key)} /><div className="sidebar-bottom"><Menu mode="inline" selectedKeys={[page]} items={[settingsItem]} onClick={({key})=>selectPage(key)} /><div className="sidebar-version">V0.8.0</div></div></Sider>
    <nav className="compact-nav" aria-label={t('主导航','Main navigation')}>
      {[...items, settingsItem].map(item => <button key={item.key} type="button"
        aria-label={item.label} aria-current={page === item.key ? 'page' : undefined} onClick={() => selectPage(item.key)}>
        {item.icon}<span className="compact-nav-label">{item.label}</span>
      </button>)}
    </nav>
    <Layout className={workspace ? 'app-main planner-layout' : 'app-main'}><Content className={`content ${workspace ? 'planner-content' : ''} ${page === 'map' ? 'map-content' : ''}`}><div style={{display:chatting?'block':'none',height:'100%'}}><PlannerPage flightRequest={flightRequest} conversationRequest={conversationRequest} onSettings={openServiceSettings} onItinerary={id=>{setItineraryId(id);setPage('itinerary')}} /></div>{!chatting && content[page]}</Content></Layout>
  </div></AntApp></ConfigProvider>
}

