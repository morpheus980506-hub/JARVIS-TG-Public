import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/services/chatTimes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText
const {chatTimeSeparators}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const messages=(...times)=>times.map(created_at=>({created_at}))
const now=Date.parse('2026-11-09T12:40:00+08:00')

test('first message and five-minute gaps show centered time labels without repeating every message',()=>{
  assert.deepEqual(chatTimeSeparators(messages('2026-11-09T12:36:00+08:00','2026-11-09T12:37:00+08:00','2026-11-09T12:42:00+08:00'),'zh',now),['今天 12:36',undefined,'今天 12:42'])
})
test('midnight starts a new group even when the messages are less than five minutes apart',()=>{
  assert.deepEqual(chatTimeSeparators(messages('2026-11-08T23:59:00+08:00','2026-11-09T00:01:00+08:00'),'zh',now),['昨天 23:59','今天 00:01'])
})
test('dates use Shanghai calendar boundaries, with older years and English labels',()=>{
  assert.equal(chatTimeSeparators(messages('2026-11-08T16:36:00Z'),'zh',now)[0],'今天 00:36')
  assert.equal(chatTimeSeparators(messages('2025-12-31T12:36:00+08:00'),'zh',now)[0],'2025年12月31日 12:36')
  assert.equal(chatTimeSeparators(messages('2026-11-07T12:36:00+08:00'),'en',now)[0],'Nov 7 12:36')
  assert.equal(chatTimeSeparators(messages('2026-11-08T12:36:00+08:00'),'en',now)[0],'Yesterday 12:36')
})
test('missing legacy or invalid times are never assigned the current time',()=>{
  assert.deepEqual(chatTimeSeparators(messages(undefined,'invalid','2026-11-09T12:36:00+08:00'),'zh',now),['早期消息 · 未记录时间',undefined,'今天 12:36'])
  assert.equal(chatTimeSeparators(messages(undefined),'en',now)[0],'Earlier messages · time not recorded')
})
test('a page left open across midnight relabels today as yesterday',()=>{
  const saved=messages('2026-11-09T12:36:00+08:00')
  assert.equal(chatTimeSeparators(saved,'zh',now)[0],'今天 12:36')
  assert.equal(chatTimeSeparators(saved,'zh',Date.parse('2026-11-10T00:01:00+08:00'))[0],'昨天 12:36')
})
