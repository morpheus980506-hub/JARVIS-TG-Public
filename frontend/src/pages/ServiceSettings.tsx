import { Alert, App, Button, Form, Input, Modal, Skeleton, Switch, Tag, Tooltip, Typography } from 'antd'
import { CarOutlined, CloudOutlined, EnvironmentOutlined, GlobalOutlined, HomeOutlined, RobotOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { getServiceSettings, updateServiceSettings } from '../services/api'
import { useSettings, useT } from '../stores/settings'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { ServiceGuide } from '../components/ServiceGuide'

export interface ServiceField {key:string;label:string;label_en:string;kind:'text'|'url'|'secret'|'boolean';configured:boolean;value?:string|boolean}
export interface ServiceConfig {id:string;name:string;configured:boolean;fields:ServiceField[]}

const serviceInfo:Record<string,{name:[string,string];purpose:[string,string];icon:typeof RobotOutlined}>={
  deepseek:{name:['DeepSeek','DeepSeek'],purpose:['对话与行程规划','Chat & trip planning'],icon:RobotOutlined},
  tavily:{name:['Tavily','Tavily'],purpose:['联网搜索','Web search'],icon:SearchOutlined},
  brave_search:{name:['Brave Search','Brave Search'],purpose:['备用网页搜索','Backup web search'],icon:SearchOutlined},
  exa:{name:['Exa','Exa'],purpose:['备用网页搜索','Backup web search'],icon:SearchOutlined},
  amap:{name:['高德地图','AMap'],purpose:['地图与路线','Maps & directions'],icon:EnvironmentOutlined},
  variflight:{name:['飞常准','VariFlight'],purpose:['航班查询','Flight search'],icon:GlobalOutlined},
  didi:{name:['滴滴出行','DiDi'],purpose:['打车与预估费用','Rides & fare estimates'],icon:CarOutlined},
  fliggy:{name:['飞猪','Fliggy'],purpose:['酒店、机票与门票搜索','Hotels, flights & tickets'],icon:HomeOutlined},
  meituan:{name:['美团旅行','Meituan'],purpose:['酒店、交通与景点搜索','Hotels, transport & attractions'],icon:HomeOutlined},
  qweather:{name:['和风天气','QWeather'],purpose:['城市天气','City weather'],icon:CloudOutlined},
  open_meteo:{name:['Open-Meteo','Open-Meteo'],purpose:['地图天气预报','Map forecasts'],icon:ThunderboltOutlined},
}
const groups=[
  {id:'intelligence',title:['对话与搜索','Chat & search'],ids:['deepseek','tavily','brave_search','exa']},
  {id:'travel',title:['地图与出行','Maps & travel'],ids:['amap','variflight','didi']},
  {id:'booking',title:['酒店与预订','Hotels & booking'],ids:['fliggy','meituan']},
  {id:'weather',title:['天气','Weather'],ids:['qweather','open_meteo']},
]

export function ServiceSettings() {
  const t=useT(),language=useSettings(state=>state.language)
  const {message}=App.useApp()
  const [services,setServices]=useState<ServiceConfig[]>([])
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
  const [error,setError]=useState(false),[editing,setEditing]=useState<ServiceConfig>()
  const [form]=Form.useForm()
  const [guide,setGuide]=useState<string>()
  async function refresh() {
    setLoading(true);setError(false)
    try {setServices(await getServiceSettings())} catch {setError(true)} finally {setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  useEffect(()=>{if(editing){form.resetFields();form.setFieldsValue(Object.fromEntries(editing.fields.map(field=>[field.key,field.kind==='secret' ? '' : field.value])))}},[editing,form])
  async function save(values:Record<string,string|boolean>) {
    if(!editing) return
    setSaving(true)
    try {
      await updateServiceSettings(editing.id,values)
      setEditing(undefined);form.resetFields();await refresh()
      void message.success(editing.id==='amap' ? t('配置已保存。地图 Key 变更后请刷新页面生效','Saved. Reload the page after changing map keys.') : t('配置已保存，后续请求使用新配置','Saved. New requests use this configuration.'))
    } catch {void message.error(t('保存失败，请检查服务地址和本机安全存储权限','Could not save. Check the URL and local secure storage.'))}
    finally {setSaving(false)}
  }
  function serviceRow(service:ServiceConfig) {
    const info=serviceInfo[service.id],Icon=info?.icon || GlobalOutlined
    const enabled=service.fields.find(field=>field.kind==='boolean')
    const status=enabled ? (enabled.value ? t('已启用','Enabled') : t('已停用','Disabled')) : service.configured ? t('已配置','Configured') : t('待配置','Not configured')
    return <div className="service-connection-row" key={service.id}>
      <span className="service-connection-icon" aria-hidden="true"><Icon /></span>
      <div className="service-connection-name"><Typography.Text strong>{info ? t(...info.name) : service.name}</Typography.Text>{info && <Typography.Text type="secondary">{t(...info.purpose)}</Typography.Text>}</div>
      <Tooltip title={t('配置状态，不代表连接或权限已验证','Configuration status; connectivity and access have not been verified')}><Tag bordered={false} color={(enabled ? enabled.value : service.configured) ? 'cyan' : 'default'}>{status}</Tag></Tooltip>
      <Button onClick={()=>setEditing(service)} aria-label={`${t('配置','Configure')} ${info ? t(...info.name) : service.name}`}>{t('配置','Configure')}</Button>
    </div>
  }
  const other=services.filter(service=>!groups.some(group=>group.ids.includes(service.id)))
  return <div className="service-connections">
    <div className="service-guide-entry"><Button type="text" icon={<QuestionCircleOutlined />} onClick={()=>setGuide('deepseek')}>{t('接入教程','Setup guide')}</Button></div>
    {error && <Alert type="error" showIcon message={t('接口配置加载失败','Could not load service settings')} action={<Button onClick={()=>void refresh()}>{t('重试','Retry')}</Button>} style={{marginBottom:16}} />}
    {loading && services.length===0 && <Skeleton active />}
    {groups.map(group=>{
      const entries=group.ids.flatMap(id=>services.filter(service=>service.id===id))
      return entries.length>0 && <section className="service-connection-group" key={group.id} aria-labelledby={`service-group-${group.id}`}>
        <Typography.Title level={5} id={`service-group-${group.id}`}>{t(group.title[0],group.title[1])}</Typography.Title>
        <div className="service-connection-list">{entries.map(serviceRow)}</div>
      </section>
    })}
    {other.length>0 && <section className="service-connection-group"><Typography.Title level={5}>{t('其他服务','Other services')}</Typography.Title><div className="service-connection-list">{other.map(serviceRow)}</div></section>}
    <Modal title={editing?.name} open={Boolean(editing)} onCancel={()=>{if(!saving){setEditing(undefined);form.resetFields()}}} onOk={()=>form.submit()} confirmLoading={saving} okText={t('保存配置','Save configuration')} destroyOnHidden>
      <Button type="link" icon={<QuestionCircleOutlined />} onClick={()=>setGuide(editing?.id)}>{t('不知道怎么填写？查看教程','Need help? View setup guide')}</Button>
      {editing && ['didi','fliggy','meituan'].includes(editing.id) && <Typography.Paragraph><Typography.Link href={{didi:'https://mcp.didichuxing.com/',fliggy:'https://flyai.open.fliggy.com/console',meituan:'https://developer.meituan.com/zh/v2/dev/token'}[editing.id]} target="_blank" rel="noreferrer">{t('前往官方平台获取密钥 ↗','Get a key from the official platform ↗')}</Typography.Link></Typography.Paragraph>}
      <Typography.Paragraph type="secondary">{t('密钥仅发送到本机后端，并由当前 Windows 用户的安全存储保护；不会在这里回显。','Keys are sent only to the local backend and protected for the current Windows user. Stored keys are not returned.')}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={values=>void save(values)}>
        {editing?.fields.map(field=><Form.Item key={field.key} name={field.key} label={language==='en' ? field.label_en : field.label} valuePropName={field.kind==='boolean' ? 'checked' : 'value'} rules={field.kind==='url' ? [{required:true,type:'url',message:t('请输入完整服务地址','Enter a complete service URL')}] : []}>
          {field.kind==='boolean' ? <Switch /> : field.kind==='secret' ? <Input.Password autoComplete="new-password" placeholder={field.configured ? t('已设置，留空保持不变','Already set. Leave blank to keep.') : t('输入密钥','Enter key')} /> : <Input autoComplete="off" />}
        </Form.Item>)}
      </Form>
    </Modal>
    <ServiceGuide service={guide} onChange={setGuide} onClose={()=>setGuide(undefined)} onConfigure={id=>{const service=services.find(item=>item.id===id);if(service){setGuide(undefined);setEditing(service)}}} />
  </div>
}
