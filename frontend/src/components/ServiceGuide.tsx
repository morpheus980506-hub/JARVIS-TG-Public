import { Alert, Button, Drawer, Select, Space, Typography } from 'antd'
import { serviceGuides } from '../services/serviceGuides'
import { useT } from '../stores/settings'

export function ServiceGuide({service,onChange,onClose,onConfigure}:{service?:string;onChange:(id:string)=>void;onClose:()=>void;onConfigure:(id:string)=>void}) {
  const t=useT(),guide=service ? serviceGuides[service] : undefined
  return <Drawer title={t('API / MCP 接入教程','API / MCP setup guide')} width={520} open={Boolean(guide)} onClose={onClose} zIndex={1100}>
    <Typography.Paragraph>{t('按需配置即可，不需要一次申请所有平台。API Key / MCP Key 可以理解为平台提供给应用的访问凭证。','Configure only the services you need. API / MCP keys are credentials that let the app access a provider.')}</Typography.Paragraph>
    <Select aria-label={t('选择服务','Choose a service')} value={service} onChange={onChange} style={{width:'100%'}} options={Object.entries(serviceGuides).map(([value,item])=>({value,label:item.name}))} />
    {guide && <div className="service-guide">
      <Space wrap><Typography.Link href={guide.url} target="_blank" rel="noreferrer">{t('打开官方申请 / 文档页面 ↗','Official signup / documentation ↗')}</Typography.Link><Button type="primary" onClick={()=>onConfigure(service!)}>{t('去填写配置','Enter configuration')}</Button></Space>
      <ol>{guide.steps.map(([zh,en],index)=><li key={index}>{t(zh,en)}</li>)}</ol>
      <Typography.Title level={5}>{t('保存后怎么确认？','How do I check it works?')}</Typography.Title>
      <Typography.Paragraph>{t(...guide.check)}</Typography.Paragraph>
      <Alert type="info" message={t(...guide.help)} />
    </div>}
    <Typography.Paragraph type="secondary" style={{marginTop:20}}>{t('“已配置”表示已保存，不等于连接或权限已验证。已有密钥留空会保留原值，不必重复粘贴；不要把密钥发到聊天里。','“Configured” means saved, not verified. Leave an existing key blank to keep it; do not paste keys into chat.')}</Typography.Paragraph>
  </Drawer>
}
