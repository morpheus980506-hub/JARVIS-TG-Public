import { Alert, Button, Card, Collapse, Empty, Table, Tag, Typography, message } from 'antd'
import { TravelSearch } from '../components/TravelSearch'
import { CandidateSelection,WorkspaceSelections } from '../components/TripWorkspace'
import { useState } from 'react'
import type { TravelCandidate } from '../types'
import { requestApproval } from '../services/api'
import { useScopedTripStore } from '../stores/tripScope'
import type { HotelOption } from '../types'
import { useT } from '../stores/settings'
import { hasTripStays } from '../services/tripPlaces'

export function HotelPage({onSettings}:{onSettings?:()=>void}) {
  const useTripStore=useScopedTripStore()
  const t = useT()
  const plan = useTripStore(state => state.plan)
  const conversationId=useTripStore(state=>state.conversationId)
  const [candidate,setCandidate]=useState<TravelCandidate>()
  const [messageApi, contextHolder] = message.useMessage()
  const selection=<CandidateSelection candidate={candidate} conversationId={conversationId} onClose={()=>setCandidate(undefined)} />
  if (!plan) return <><Typography.Title level={2}>{t('酒店与旅行搜索','Hotels & travel search')}</Typography.Title><TravelSearch onSettings={onSettings} onSelect={conversationId ? setCandidate : undefined} /><WorkspaceSelections />{selection}</>
  if (!hasTripStays(plan.requirement)) return <Empty description={plan.requirement.days === 1
    ? t('当日行程无需住宿','Day trips do not require an overnight stay')
    : t('请先确认行程目的地','Confirm the itinerary destination first')} />

  async function selectHotel(hotel: HotelOption) {
    await requestApproval(plan!.trip_id, 'SELECT_HOTEL_CANDIDATE', {
      hotel_id: hotel.hotel_id,
      hotel_name: hotel.name,
      total_price_cny: hotel.total_price_cny,
      is_mock: hotel.is_mock,
    })
    messageApi.success(t('已提交待确认；这不会创建真实订单','Submitted for approval; no booking has been made'))
  }

  return <>
    {contextHolder}
    <Typography.Title level={2}>{t('酒店与旅行搜索','Hotels & travel search')}</Typography.Title>
    <TravelSearch key={plan.requirement.destination} destination={plan.requirement.destination} onSettings={onSettings} onSelect={conversationId ? setCandidate : undefined} />
    <WorkspaceSelections showTripActions={false} />{selection}
    <Collapse style={{marginTop:24}} items={[{key:'budget',label:t('行程住宿候选','Trip accommodation options'),children:<>
    {plan.hotels.some(hotel=>hotel.is_mock) && <Alert type="warning" showIcon message={t('模拟候选仅用于预算演示','Simulated options are budget examples only')} style={{ marginBottom: 16 }} />}
    <Card title={`${plan.requirement.destination} · ${plan.requirement.days - 1} ${t('晚','nights')}`}>
      <Table rowKey="hotel_id" dataSource={plan.hotels} pagination={false} columns={[
        { title: t('候选','Option'), dataIndex: 'name', render: (value: string,hotel:HotelOption) => <>{value} <Tag color={hotel.is_mock ? 'orange' : 'cyan'}>{hotel.is_mock ? 'MOCK' : hotel.provider}</Tag></> },
        { title: t('位置','Location'), dataIndex: 'area', render: (area: string, hotel: HotelOption) =>
          hotel.map_location?.address
            ? <a href={hotel.map_location.source_url} target="_blank" rel="noreferrer">{hotel.map_location.address} ↗</a>
            : hotel.is_mock ? area : <>{area} · {t('分店地址待核对','Branch address pending')}</> },
        { title: t('房型','Room'), dataIndex: 'room_type' },
        { title: t('日期与状态','Dates & status'), dataIndex: 'availability', render: (value: string, hotel: HotelOption) => <>
          {value}{Boolean(hotel.pending_checks?.length) && <div><Tag color="orange">{t('条件待确认','Conditions pending')}</Tag>{hotel.pending_checks?.join('、')}</div>}
        </> },
        { title: t('评分','Rating'), dataIndex: 'rating' },
        { title: t('参考价格','Reference price'), dataIndex: 'nightly_price_cny', render: (value: number|null, hotel: HotelOption) => {
          if (value != null) return `¥${value.toFixed(2)}`
          if (!hotel.price_text) return t('待确认','Check provider')
          if (hotel.pending_checks?.includes('适用日期的每晚价格')) {
            return <>{hotel.price_text} · {t('每晚实价待核对','Nightly rate pending')}</>
          }
          return hotel.price_text
        } },
        { title: t('合计','Total'), dataIndex: 'total_price_cny', render: (value: number|null) => value==null ? '—' : `¥${value.toFixed(2)}` },
        { title: t('取消政策','Cancellation'), dataIndex: 'cancellation_policy' },
        { title: t('操作','Action'), render: (_: unknown, hotel: HotelOption) => hotel.pending_checks?.length
          ? <Button href={hotel.source_url} target="_blank" rel="noreferrer">{t('查看平台详情','Check provider')}</Button>
          : !hotel.is_mock && hotel.candidate_id ? <Button onClick={()=>setCandidate({candidate_id:hotel.candidate_id!,title:hotel.name,price_text:hotel.price_text || '',url:hotel.source_url,tags:[]})}>{t('加入行程','Add to trip')}</Button> : <Button onClick={() => void selectHotel(hotel)}>{t('提交选择','Select')}</Button> },
      ]} scroll={{ x: 1200 }} />
    </Card>
    </>}]} />
  </>
}
