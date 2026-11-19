import { Button, Card, Empty, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { decideApproval, getApprovals } from '../services/api'
import type { ApprovalRecord } from '../types'
import { useT } from '../stores/settings'

export function ApprovalPage() {
  const t = useT()
  const [records, setRecords] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  async function refresh() {
    setLoading(true)
    try { setRecords(await getApprovals()) } catch {void messageApi.error(t('操作记录加载失败','Could not load action approvals'))} finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  async function decide(record: ApprovalRecord, approved: boolean) {
    try {
      await decideApproval(record.id, approved, approved ? '用户确认行程操作' : '用户拒绝行程操作')
      messageApi.success(approved ? t('已确认（不会创建真实订单）','Confirmed (no booking made)') : t('已拒绝','Rejected'))
      await refresh()
    } catch {void messageApi.error(t('操作未完成，请刷新后重试','Could not complete this action. Refresh and retry.'))}
  }

  return <>
    {contextHolder}
    <Typography.Title level={3}>{t('操作确认','Action approvals')}</Typography.Title>
    <Typography.Paragraph type="secondary">{t('查看并确认住宿选择等行程操作。','Review and confirm itinerary actions such as accommodation choices.')}</Typography.Paragraph>
    <Card extra={<Button onClick={() => void refresh()}>{t('刷新','Refresh')}</Button>}>
      {!records.length && !loading ? <Empty description={t('暂无需要确认的行程操作','No itinerary actions to confirm')} /> : <Table rowKey="id" loading={loading} dataSource={records} columns={[
        { title: t('操作','Action'), dataIndex: 'action',render:(value:string)=>value==='SELECT_HOTEL_CANDIDATE' ? t('住宿选择','Accommodation selection') : t('行程操作','Itinerary action') },
        { title: t('状态','Status'), dataIndex: 'status',render:(value:string)=><Tag>{value==='PENDING_APPROVAL' ? t('待确认','Pending') : value==='AUTHORIZED' ? t('已同意','Approved') : value==='REJECTED' ? t('已拒绝','Rejected') : t('已处理','Processed')}</Tag> },
        { title: t('说明','Details'), dataIndex: 'parameters', render: (value: Record<string, unknown>) => String(value.hotel_name || '-') },
        { title: t('决定','Decision'), render: (_: unknown, record: ApprovalRecord) => record.status === 'PENDING_APPROVAL' ? <Space><Button type="primary" onClick={() => void decide(record, true)}>{t('同意','Approve')}</Button><Button danger onClick={() => void decide(record, false)}>{t('拒绝','Reject')}</Button></Space> : '-' },
      ]} />}
    </Card>
  </>
}
