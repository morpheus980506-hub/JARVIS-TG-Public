import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
async function load(name) {
  const source=readFileSync(new URL(`../src/services/${name}.ts`,import.meta.url),'utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const {readJsonLines}=await load('jsonLines')
const {createRequestGate}=await load('requestGate')
const {progressLabel}=await load('progress')

test('English progress uses meaningful translated steps while Chinese keeps actual progress details',()=>{
  assert.equal(progressLabel({stage:'hotel',status:'RUNNING',message:'中文内部消息'},'en'),'Preparing accommodation…')
  assert.equal(progressLabel({stage:'verifier',status:'WARNING',message:'WARNING raw'},'en'),'Plan checks: some details need review.')
  assert.equal(progressLabel({stage:'hotel',status:'SUCCESS',message:'已返回10条候选'},'zh'),'已返回10条候选')
})

test('stream parsing preserves split UTF-8 and a final result without a newline',async()=>{
  const bytes=new TextEncoder().encode(' \r\n{"type":"progress","text":"杭州😊"}\r\n{"type":"result","value":7}')
  const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close()}})
  const results=[]
  for await(const result of readJsonLines(stream))results.push(result)
  assert.deepEqual(results,[{type:'progress',text:'杭州😊'},{type:'result',value:7}])
  assert.equal(stream.locked,false)
})

test('malformed or truncated frames fail without silently reporting a finished result',async()=>{
  for(const text of ['{"type":','{"type":"progress"}\nnot-json']) {
    const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(text));controller.close()}})
    await assert.rejects(async()=>{for await(const result of readJsonLines(stream))void result},SyntaxError)
    assert.equal(stream.locked,false)
  }
})

test('leaving a stream early cancels its source and releases the reader',async()=>{
  let cancelled=false
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"one":1}\n{"two":2}\n'))},cancel(){cancelled=true}})
  for await(const result of readJsonLines(stream)){assert.equal(result.one,1);break}
  assert.equal(cancelled,true)
  assert.equal(stream.locked,false)
})

test('cancelled or superseded requests cannot apply late results or progress',async()=>{
  const gate=createRequestGate(),first=gate.start()
  const delayed=Promise.resolve('old plan')
  gate.cancel()
  const second=gate.start(),applied=[]
  await delayed.then(plan=>{if(first.isCurrent())applied.push(plan)})
  if(second.isCurrent())applied.push('new plan')
  assert.deepEqual(applied,['new plan'])
  assert.equal(first.signal.aborted,true)
  assert.equal(second.signal.aborted,false)
  gate.cancel()
  assert.equal(second.signal.aborted,true)
  assert.equal(second.isCurrent(),false)
})
