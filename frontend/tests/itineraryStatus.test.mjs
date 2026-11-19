import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/services/itineraryStatus.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
}).outputText
const {itineraryNotice,itineraryBadge}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('paused planning is labeled as paused rather than an active update',()=>{
  assert.match(itineraryNotice({planning_status:'cancelled',pending_revision:true},true,'zh'),/已暂停/)
  assert.equal(itineraryBadge({planning_status:'cancelled'},'en'),'Paused')
})
test('reset and previous-trip labels persist when new conditions are added',()=>{
  assert.match(itineraryNotice({previous_trip:true,planning_status:'active'},false,'zh'),/上一趟/)
  assert.equal(itineraryBadge({planning_status:'reset'},'en'),'Previous trip')
})
test('ordinary saved plans and missing legacy status do not claim a pending update',()=>{
  assert.equal(itineraryNotice({planning_status:'active'},false,'en'),undefined)
  assert.equal(itineraryBadge({},'zh'),undefined)
  assert.equal(itineraryNotice(null,false,'zh'),undefined)
})
test('ordinary pending edits have localized labels',()=>{
  assert.match(itineraryNotice({pending_revision:true},false,'en'),/Update pending/)
  assert.equal(itineraryBadge({pending_revision:true},'zh'),'待更新')
})
test('missing requested days remain a visibly incomplete draft',()=>{
  assert.match(itineraryNotice({incomplete:true},false,'zh'),/未完成草案/)
  assert.equal(itineraryBadge({incomplete:true},'en'),'Incomplete draft')
})
