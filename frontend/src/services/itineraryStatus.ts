interface Status {
  planning_status?: 'active' | 'cancelled' | 'reset'
  previous_trip?: boolean
  pending_revision?: boolean
  incomplete?: boolean
}

export function itineraryNotice(snapshot: Status | null | undefined, stale: boolean, language: 'zh' | 'en'): string | undefined {
  const en=language==='en'
  if(snapshot?.planning_status==='cancelled') return en ? 'Planning paused. Showing the saved itinerary.' : '规划已暂停，下方为已保存行程。'
  if(snapshot?.previous_trip || snapshot?.planning_status==='reset') return en ? 'Requirements reset. Showing the previously saved trip.' : '旅行条件已重置，下方保留上一趟已保存行程。'
  if(snapshot?.incomplete)return en ? 'Draft itinerary: some requested days are still missing.' : '当前为未完成草案，部分天数仍待补齐。'
  if(stale || snapshot?.pending_revision) return en ? 'Update pending — showing the previous version.' : '修改尚未完成，当前为上一版。'
}

export function itineraryBadge(snapshot: Status, language: 'zh' | 'en'): string | undefined {
  if(snapshot.planning_status==='cancelled')return language==='en' ? 'Paused' : '已暂停'
  if(snapshot.previous_trip || snapshot.planning_status==='reset')return language==='en' ? 'Previous trip' : '上一趟'
  if(snapshot.incomplete)return language==='en' ? 'Incomplete draft' : '未完成草案'
  if(snapshot.pending_revision)return language==='en' ? 'Update pending' : '待更新'
}
