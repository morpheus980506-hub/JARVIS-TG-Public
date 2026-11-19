import { Card, Col, Row, Tag, Typography } from 'antd'
import { AlipayCircleOutlined, CreditCardOutlined, WechatOutlined } from '@ant-design/icons'
import { useT } from '../stores/settings'

export function PaymentSettings() {
  const t=useT()
  return <>
    <Typography.Title level={3}>{t('支付方式','Payment methods')}</Typography.Title>
    <Typography.Paragraph type="secondary">{t('支付服务暂未接入，当前不支持绑定账户或扣款。接入后可在这里绑定和管理支付方式。','Payment services are not connected yet. Account linking and charging are unavailable. Connected payment methods will be managed here.')}</Typography.Paragraph>
    <Row gutter={[16,16]}>{[
      {name:t('支付宝','Alipay'),icon:<AlipayCircleOutlined />},
      {name:t('微信支付','WeChat Pay'),icon:<WechatOutlined />},
      {name:t('银行卡','Bank cards'),icon:<CreditCardOutlined />},
    ].map(method=><Col xs={24} md={8} key={method.name}><Card><div className="payment-method-heading">{method.icon}<Typography.Text strong>{method.name}</Typography.Text></div><Tag style={{marginTop:16}}>{t('未接入','Not connected')}</Tag></Card></Col>)}</Row>
  </>
}
