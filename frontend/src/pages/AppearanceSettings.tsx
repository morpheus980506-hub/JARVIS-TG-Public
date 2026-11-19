import { Card, Segmented, Space, Typography } from 'antd'
import { useSettings, useT } from '../stores/settings'

export function AppearanceSettings() {
  const { appearance, language, setAppearance, setLanguage } = useSettings()
  const t = useT()
  return <Card title={t('界面设置', 'Appearance & language')}><Space direction="vertical" size={20}>
    <div><Typography.Paragraph>{t('主题', 'Theme')}</Typography.Paragraph><Segmented value={appearance} onChange={setAppearance} options={[
      {value:'light',label:t('亮色','Light')},{value:'dark',label:t('暗色','Dark')},{value:'system',label:t('跟随系统','System')},
    ]} /></div>
    <div><Typography.Paragraph>{t('语言', 'Language')}</Typography.Paragraph><Segmented value={language} onChange={setLanguage} options={[{value:'zh',label:'中文'},{value:'en',label:'English'}]} /></div>
  </Space></Card>
}
