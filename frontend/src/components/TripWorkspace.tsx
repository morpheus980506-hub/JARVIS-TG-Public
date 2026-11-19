import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd'
import { useState } from 'react'
import { useT } from '../stores/settings'
import { useTripStore } from '../stores/trip'
import { useScopedTripStore } from '../stores/tripScope'
import { isTripPlace } from '../services/tripPlaces'
import type { TravelCandidate,SelectedCandidate,TripWorkspace as Workspace } from '../types'

export async function loadWorkspace(id:string,tripId?:string,apply=true,language='zh') {
  const response=await fetch(`/api/v1/conversations/${id}/workspace${tripId ? '/plan' : ''}`,tripId ? {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({trip_id:tripId,language})} : {})
  if(!response.ok)throw Error('Workspace unavailable')
  const data:Workspace=await response.json()
  if(apply)useTripStore.getState().setWorkspace(id,data)
  return data
}

export function CandidateSelection({candidate,editing,conversationId,onClose}:{candidate?:TravelCandidate;editing?:SelectedCandidate;conversationId?:string;onClose:()=>void}) {
  const useTripStore=useScopedTripStore()
  const t=useT(),{message}=App.useApp(),[saving,setSaving]=useState(false)
  const item=editing || candidate
  return <Modal title={editing ? t('编辑费用估算','Edit estimate') : t('加入当前行程','Add to this trip')} open={Boolean(item)} onCancel={()=>{if(!saving)onClose()}} footer={null} destroyOnHidden>
    <Typography.Paragraph>{item?.title}</Typography.Paragraph>
    <Typography.Paragraph type="secondary">{t('平台参考价','Provider price')}：{item?.price_text || t('未提供','Not supplied')}</Typography.Paragraph>
    <Form key={editing?.id || candidate?.candidate_id || 'none'} layout="vertical" initialValues={{category:item?.category || 'hotel',quantity:editing?.quantity || 1,unit_price_cny:editing?.unit_price_cny,note:editing?.note || '',review_confirmed:false}} onFinish={async values=>{
      if(!item || !conversationId)return
      setSaving(true)
      try {
        const {review_confirmed,...cost}=values
        const response=await fetch(`/api/v1/conversations/${conversationId}/workspace/selections${editing ? '/'+editing.id : ''}`,{method:editing ? 'PATCH' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(editing ? {...cost,review_confirmed:Boolean(review_confirmed)} : {candidate_id:item.candidate_id,...cost})})
        if(!response.ok)throw Error(response.status===410 ? t('候选已过期，请重新查询','Candidate expired. Search again.') : t('保存未完成，请检查金额和数量后重试','Could not save. Check the amount and quantity and retry.'))
        const workspace:Workspace=await response.json()
        if(useTripStore.getState().conversationId===conversationId)useTripStore.getState().setWorkspace(conversationId,workspace)
        onClose();void message.success(editing ? t('费用估算已更新','Estimate updated') : t('已加入行程，费用估算已更新','Added to the trip; estimate updated'))
      } catch(error) {void message.error(error instanceof Error ? error.message : t('保存失败，请重试','Could not save. Retry.'))}
      finally {setSaving(false)}
    }}>
      <Form.Item name="category" label={t('类别','Category')}><Select options={[{value:'hotel',label:t('住宿','Stay')},{value:'transport',label:t('交通','Transport')},{value:'tickets',label:t('门票','Tickets')},{value:'food',label:t('餐饮','Food')},{value:'other',label:t('其他','Other')}]} /></Form.Item>
      <Form.Item name="unit_price_cny" label={t('估算单价（人民币）','Estimated unit price (CNY)')} rules={[{required:true,message:t('请核对平台价格后填写','Check the provider price and enter an estimate')}]}><InputNumber min={0} max={10000000} precision={2} style={{width:'100%'}} /></Form.Item>
      <Form.Item name="quantity" label={t('数量（住宿填写晚数 × 房间数）','Quantity (room-nights for accommodation)')} rules={[{required:true}]}><InputNumber min={1} max={365} /></Form.Item>
      <Form.Item name="note" label={t('备注','Note')}><Input maxLength={300} /></Form.Item>
      {editing?.needs_review && <Form.Item name="review_confirmed" valuePropName="checked"><Checkbox>{t('我已重新核对当前行程条件和平台报价','I have reviewed the current trip details and provider price')}</Checkbox></Form.Item>}
      {editing && <Typography.Paragraph type="secondary">{t('平台参考价保留查询时的快照，编辑估算不会刷新平台报价。','The provider price is a saved snapshot. Editing an estimate does not refresh it.')}</Typography.Paragraph>}
      <Typography.Paragraph type="secondary">{t('起价不等于最终报价。此处仅记录估算，不会预订或付款。','Starting prices are not final quotes. This records an estimate without booking or payment.')}</Typography.Paragraph>
      <Button type="primary" htmlType="submit" loading={saving} disabled={!conversationId}>{editing ? t('保存修改','Save changes') : t('加入行程','Add to trip')}</Button>
    </Form>
  </Modal>
}

export function WorkspaceSelections({showTripActions = true}: {showTripActions?: boolean} = {}) {
  const useTripStore=useScopedTripStore()
  const t=useT(),{message}=App.useApp(),{workspace,conversationId}=useTripStore(),[removing,setRemoving]=useState<string>(),[checking,setChecking]=useState('')
  const [editing,setEditing]=useState<SelectedCandidate>()
  if(!workspace || !conversationId)return null
  async function check(action:string) {
    setChecking(action)
    try {
      const response=await fetch(`/api/v1/conversations/${conversationId}/workspace/${action}`,{method:'POST'})
      if(!response.ok){const body=await response.json();throw Error(typeof body.detail==='string' ? body.detail : t('查询未完成','Could not complete the check'))}
      if(useTripStore.getState().conversationId===conversationId)useTripStore.getState().setWorkspace(conversationId!,await response.json())
    } catch(error) {void message.error(error instanceof Error ? error.message : t('查询未完成','Could not complete the check'))}finally{setChecking('')}
  }
  return <section className="workspace-selections">
    {showTripActions && <Space wrap className="workspace-actions">
    {workspace.itinerary?.days.some(day=>/→|自驾|开车|驾车/.test(day.title)) && <Button size="small" loading={checking==='check-routes'} disabled={Boolean(checking)} onClick={()=>void check('check-routes')}>{t('核对自驾路程','Check driving distances')}</Button>}
    {isTripPlace(workspace.plan?.requirement.destination) && <Button size="small" loading={checking==='refresh-weather'} disabled={Boolean(checking)} onClick={()=>void check('refresh-weather')}>{t('更新天气','Refresh weather')}</Button>}
    {(workspace.itinerary || workspace.selections.length>0) && <><Button size="small" href={`/api/v1/conversations/${conversationId}/workspace/export`}>{t('导出行程','Export trip')}</Button><Button size="small" onClick={()=>window.print()}>{t('打印 / PDF','Print / PDF')}</Button></>}
    </Space>}
    {showTripActions && workspace.route_review?.days.map(day=><Alert key={day.day} type={day.driving_hours && day.driving_hours<=6 ? 'info' : 'warning'} message={`D${day.day} ${day.origin} → ${day.destination}`} description={`${day.driving_hours ?? '—'}h · ${day.warning}`} />)}
    {showTripActions && workspace.weather_review && <><Typography.Text type="secondary">{t('天气更新于','Weather updated at')} {new Date(workspace.weather_review.checked_at).toLocaleTimeString()}</Typography.Text>{!workspace.weather_review.covers_departure && <Alert type="warning" message={t('当前预报尚未覆盖出发日期','Forecast does not cover your departure date yet')} />}{workspace.weather_review.facts.map((fact,index)=><Typography.Paragraph key={index}><strong>{fact.name}</strong><br />{fact.value}</Typography.Paragraph>)}</>}
    {workspace.selections.length>0 && <>
      <Typography.Text strong>{t('已选候选','Selected options')}</Typography.Text>
      {workspace.selections.map(item=><div key={item.id} className="workspace-selection"><Typography.Text>{item.title}</Typography.Text>{item.needs_review && <Typography.Text type="warning">{t('行程条件已变更，请重新核对候选和报价','Trip details changed; review this option and its price')}</Typography.Text>}<Typography.Text type="secondary">¥{item.unit_price_cny.toFixed(2)} × {item.quantity} = ¥{(item.unit_price_cny*item.quantity).toFixed(2)} · {t('估算','Estimate')}</Typography.Text>{item.note && <Typography.Text type="secondary">{item.note}</Typography.Text>}<Space><Button size="small" type="text" disabled={Boolean(removing)} onClick={()=>setEditing(item)}>{t('编辑','Edit')}</Button><Button size="small" type="text" disabled={Boolean(removing)} loading={removing===item.id} onClick={async()=>{
        setRemoving(item.id)
        try {
          const response=await fetch(`/api/v1/conversations/${conversationId}/workspace/selections/${item.id}`,{method:'DELETE'})
          if(!response.ok)throw Error()
          if(useTripStore.getState().conversationId===conversationId)useTripStore.getState().setWorkspace(conversationId,await response.json())
        } catch {void message.error(t('移除失败','Could not remove'))}finally{setRemoving(undefined)}
      }}>{t('移除','Remove')}</Button></Space></div>)}
      <Typography.Paragraph>{t('已选估算合计','Selected estimate')}: ¥{workspace.budget.selected_total_cny.toFixed(2)}</Typography.Paragraph>
      <Typography.Text type="secondary">{t('只包含已选项目，尚未选择的费用未计入。','Includes selected options only; unselected costs are not included.')}</Typography.Text>
      {workspace.budget.remaining_cny!==null && workspace.budget.remaining_cny<0 && <Alert type="warning" message={t('已选项目已超过预算','Selected options exceed the budget')} />}
    </>}
    <CandidateSelection editing={editing} conversationId={conversationId} onClose={()=>setEditing(undefined)} />
  </section>
}
