import { Card, Table, Typography } from 'antd'
import ReactECharts from 'echarts-for-react'
import { useScopedTripStore } from '../stores/tripScope'
import { useT } from '../stores/settings'
import { WorkspaceSelections } from '../components/TripWorkspace'

export function BudgetPage() {
  const useTripStore=useScopedTripStore()
  const t = useT()
  const plan = useTripStore(state => state.plan)
  if (!plan) return <><Typography.Title level={2}>{t('预算中心','Budget')}</Typography.Title><WorkspaceSelections /><Typography.Paragraph type="secondary">{t('合计仅包含已选项目，尚未填写的费用不计为零。','Totals cover selected options only; missing costs are not treated as zero.')}</Typography.Paragraph></>
  return <><Typography.Title level={2}>{t('预算中心','Budget')}</Typography.Title><div className="grid-two"><Card title={`${t('总预算','Total budget')} ¥${plan.requirement.budget_cny}`}><ReactECharts style={{ height: 300 }} option={{ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['45%', '72%'], data: plan.costs.map(item => ({ name: item.description, value: item.amount_cny })) }] }} /></Card><Card title={t('费用明细','Cost breakdown')}><Table pagination={false} rowKey="category" dataSource={plan.costs} columns={[{ title: t('类别','Category'), dataIndex: 'description' }, { title: t('金额','Amount'), dataIndex: 'amount_cny', render: value => `¥${value.toFixed(2)}` }, { title: t('性质','Type'), render: () => t('估算','Estimate') }]} /></Card></div></>
}

