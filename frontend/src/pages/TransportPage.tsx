import { Card, Empty, Table, Tag, Typography } from 'antd'
import { useScopedTripStore } from '../stores/tripScope'
import { useT } from '../stores/settings'
import type { TransportOption } from '../types'

function durationLabel(minutes?: number, english = false) {
  if (minutes == null) return english ? 'Unverified' : '待核验'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return english ? `${hours}h ${rest}m` : `${hours}小时${rest ? `${rest}分` : ''}`
}

export function TransportPage() {
  const useTripStore=useScopedTripStore()
  const t = useT()
  const plan = useTripStore(state => state.plan)
  if (!plan) {
    return <><Typography.Title level={2}>{t('交通规划','Transport')}</Typography.Title><Card><Empty description={t('请先生成旅行方案','Generate a trip plan first')} /></Card></>
  }
  const options = plan.transport.filter(item => !item.is_mock && item.provider !== 'mock' && item.service_number !== 'MOCK')
  if (!options.length) {
    return <><Typography.Title level={2}>{t('交通规划','Transport')}</Typography.Title><Card><Empty description={t('这份行程没有已核验的交通结果，可回到对话查询路线。','No verified transport results for this itinerary. Return to chat to check the route.')} /></Card></>
  }
  const columns = [
    {
      title: t('方式','Mode'),
      dataIndex: 'mode',
      render: (value: string) => <Tag color={value === 'flight' ? 'blue' : 'cyan'}>{value === 'flight' ? t('航班','Flight') : t('火车','Train')}</Tag>,
    },
    { title: t('班次','Service'), dataIndex: 'service_number' },
    {
      title: t('路线','Route'),
      render: (_: unknown, item: TransportOption) => `${item.departure_name} → ${item.arrival_name}`,
    },
    { title: t('出发','Departs'), dataIndex: 'departure_time' },
    { title: t('抵达','Arrives'), dataIndex: 'arrival_time' },
    {
      title: t('历时','Duration'),
      dataIndex: 'duration_minutes',
      render: (value?: number) => durationLabel(value,t('zh','en') === 'en'),
    },
    {
      title: t('参考价','Price estimate'),
      dataIndex: 'price_cny',
      render: (value?: number) => value == null ? t('需二次核验','Unverified') : `¥${value.toFixed(2)}`,
    },
    { title: t('状态','Status'), render: (_: unknown, item: TransportOption) => item.status || item.availability },
  ]
  return <>
    <Typography.Title level={2}>{t('交通规划','Transport')}</Typography.Title>
    <Card title={`${plan.requirement.origin} → ${plan.requirement.destination}`}>
      <Table rowKey={item => `${item.mode}-${item.service_number}-${item.departure_time}`} dataSource={options} columns={columns} scroll={{ x: 1100 }} pagination={options.length > 8 ? { pageSize: 8 } : false} />
    </Card>
  </>
}
