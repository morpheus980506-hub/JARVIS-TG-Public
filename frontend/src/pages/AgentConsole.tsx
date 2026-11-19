import { Card, Empty, Table, Typography } from 'antd'
import { StatusPill } from '../components/StatusPill'
import { useTripStore } from '../stores/trip'
import { useT } from '../stores/settings'

export function AgentConsole() {
  const t = useT()
  const plan = useTripStore(state => state.plan)
  return <><Typography.Title level={2}>{t('执行记录','Execution log')}</Typography.Title><Typography.Paragraph type="secondary">{t('这里只显示实际执行记录。','Actual execution records only.')}</Typography.Paragraph>
    <Card>{!plan ? <Empty description={t('运行一次旅行规划后查看执行轨迹','Run a trip plan to see execution records')} /> : <Table rowKey={(row) => `${row.agent_id}-${row.duration_ms}`} pagination={false} dataSource={plan.traces} columns={[
      { title: 'Agent', dataIndex: 'agent_name' },
      { title: t('状态','Status'), dataIndex: 'status', render: value => <StatusPill value={value} /> },
      { title: t('耗时','Duration'), dataIndex: 'duration_ms', render: value => `${value ?? 0} ms` },
      { title: t('执行摘要','Summary'), dataIndex: 'output_summary' },
      { title: t('模型/工具','Provider'), dataIndex: 'model_provider' },
    ]} />}</Card></>
}

