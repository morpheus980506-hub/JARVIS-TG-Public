import { create } from 'zustand'
import { createPlanStream } from '../services/api'
import { createRequestGate } from '../services/requestGate'
import type { PlanProgressEvent, TripPlan, TripRequestPayload, TripWorkspace } from '../types'

interface TripStore {
  plan?: TripPlan
  conversationId?:string
  workspace?:TripWorkspace
  setWorkspace:(id:string,workspace:TripWorkspace)=>void
  loading: boolean
  error?: string
  run: (payload: TripRequestPayload, onEvent: (event: PlanProgressEvent) => void) => Promise<TripPlan|undefined>
  cancel:()=>void
  reset: () => void
}

export function createTripStore() {
const planning=createRequestGate()
return create<TripStore>((set,get) => ({
  loading: false,
  setWorkspace:(id,workspace)=>{if(get().conversationId!==id){planning.cancel();set({loading:false,error:undefined})}set({conversationId:id,workspace,plan:workspace.plan ?? undefined})},
  cancel:()=>{planning.cancel();set({loading:false,error:undefined})},
  reset: () => {planning.cancel();set({ plan: undefined, conversationId:undefined,workspace:undefined,loading: false, error: undefined })},
  run: async (payload, onEvent) => {
    const request=planning.start()
    set({ loading: true, error: undefined })
    try {
      const plan=await createPlanStream(payload,event=>{if(request.isCurrent())onEvent(event)},request.signal)
      if(!request.isCurrent())return
      set({plan,loading:false})
      return plan
    } catch (error: any) {
      if(!request.isCurrent())return
      const message = error?.response?.data?.detail || error?.message || '规划失败'
      set({ error: message, loading: false })
    }
  },
}))
}
export const useTripStore=createTripStore()

