import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/services/requestFailure.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
}).outputText
const {requestFailure}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('stale and deleted conversation instructions remain actionable',()=>{
  assert.equal(requestFailure({detail:'对话已在其他窗口更新，请重新打开。'},409,'zh'),'对话已在其他窗口更新，请重新打开。')
  assert.equal(requestFailure({detail:'Conversation deleted'},404,'en'),'Conversation deleted')
})
test('validation errors tell users to fix input instead of repeatedly reopening',()=>{
  assert.equal(requestFailure({detail:[{msg:'Value error, 用户消息不能为空白。',input:'QA-private'}]},422,'zh'),'用户消息不能为空白。')
  assert.ok(!requestFailure({detail:[{msg:'Input should be a finite number',input:'QA-private'}]},422,'zh').includes('QA-private'))
  assert.match(requestFailure({detail:[]},422,'zh'),/检查/)
})
test('English errors retain validation feedback without rendering submitted values',()=>{
  assert.equal(requestFailure({detail:[{msg:'Input should be a finite number',input:'secret'}]},422,'en'),'Input should be a finite number')
})
test('non-JSON upstream failures and malformed error shapes have safe fallbacks',()=>{
  for(const body of [null,{},'<html>Error</html>',{detail:[null,{input:'private'}]}]) {
    assert.match(requestFailure(body,503,'zh','plan'),/行程规划/)
    assert.match(requestFailure(body,422,'en'),/Check the input/)
  }
})
