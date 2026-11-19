import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const encode=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`
const gate=encode(readFileSync(new URL('../src/services/requestGate.ts',import.meta.url),'utf8'))
const transport=encode('export const createPlanStream=(...args)=>globalThis[Symbol.for("jarvis-test-plan-transport")](...args)')
const source=readFileSync(new URL('../src/stores/trip.ts',import.meta.url),'utf8')
  .replace("'zustand'",JSON.stringify(import.meta.resolve('zustand')))
  .replace("'../services/api'",JSON.stringify(transport))
  .replace("'../services/requestGate'",JSON.stringify(gate))
const {useTripStore,createTripStore}=await import(encode(source))

test('browsing and editing another itinerary does not change the active chat or cancel its request',async()=>{
  const {calls,saved}=setup()
  const pending=useTripStore.getState().run({},()=>{})
  const detail=createTripStore()
  detail.getState().setWorkspace('other',{plan:{trip_id:'other-plan'},selections:[],budget:{selected_total_cny:0}})
  detail.getState().setWorkspace('other',{plan:{trip_id:'edited-other'},selections:[],budget:{selected_total_cny:20}})
  assert.equal(useTripStore.getState().conversationId,'a')
  assert.equal(useTripStore.getState().plan,saved)
  assert.equal(calls[0].signal.aborted,false)
  detail.getState().reset()
  assert.equal(useTripStore.getState().conversationId,'a')
  calls[0].resolve({trip_id:'finished-active-chat'})
  await pending
  assert.equal(useTripStore.getState().plan.trip_id,'finished-active-chat')
})
function setup() {
  useTripStore.getState().reset()
  const calls=[]
  globalThis[Symbol.for('jarvis-test-plan-transport')]=(payload,emit,signal)=>new Promise((resolve,reject)=>calls.push({resolve,reject,emit,signal}))
  const saved={trip_id:'saved'}
  useTripStore.getState().setWorkspace('a',{plan:saved,selections:[],budget:{selected_total_cny:0}})
  return {calls,saved}
}

test('stopping generation preserves the saved plan even when a late result arrives',async()=>{
  const {calls,saved}=setup(),events=[]
  const request=useTripStore.getState().run({},event=>events.push(event))
  useTripStore.getState().cancel()
  assert.equal(calls[0].signal.aborted,true)
  calls[0].emit({type:'progress',message:'late'})
  calls[0].resolve({trip_id:'late'})
  assert.equal(await request,undefined)
  assert.equal(useTripStore.getState().plan,saved)
  assert.equal(useTripStore.getState().loading,false)
  assert.equal(useTripStore.getState().error,undefined)
  assert.deepEqual(events,[])
})

test('an older request finishing after a newer one cannot overwrite it',async()=>{
  const {calls}=setup()
  const first=useTripStore.getState().run({},()=>{})
  const second=useTripStore.getState().run({},()=>{})
  assert.equal(calls[0].signal.aborted,true)
  calls[1].resolve({trip_id:'new'})
  assert.equal((await second).trip_id,'new')
  calls[0].resolve({trip_id:'old'})
  assert.equal(await first,undefined)
  assert.equal(useTripStore.getState().plan.trip_id,'new')
})

test('switching conversations cancels pending work, and a failed new request retains existing data',async()=>{
  const {calls}=setup()
  const request=useTripStore.getState().run({},()=>{})
  const other={trip_id:'other'}
  useTripStore.getState().setWorkspace('b',{plan:other,selections:[],budget:{selected_total_cny:0}})
  calls[0].resolve({trip_id:'wrong-conversation'})
  await request
  assert.equal(useTripStore.getState().conversationId,'b')
  assert.equal(useTripStore.getState().plan,other)
  const failed=useTripStore.getState().run({},()=>{})
  calls[1].reject(Error('request failed'))
  assert.equal(await failed,undefined)
  assert.equal(useTripStore.getState().plan,other)
  assert.equal(useTripStore.getState().error,'request failed')
})
