import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/services/travelLinks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText
const {safeTravelLink}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('live Fliggy router links remain visible while deceptive domains stay blocked',()=>{
  assert.equal(safeTravelLink('https://router.feizhu.com/route?test=1','fliggy'),'https://router.feizhu.com/route?test=1')
  assert.equal(safeTravelLink('https://router.feizhu.com.evil.invalid/route','fliggy'),undefined)
  assert.equal(safeTravelLink('https://router.feizhu.com/route','meituan'),undefined)
})

test('legacy Meituan short links become HTTPS without accepting other insecure destinations',()=>{
  assert.equal(safeTravelLink('http://dpurl.cn/test?x=1','meituan'),'https://dpurl.cn/test?x=1')
  assert.equal(safeTravelLink('http://dpurl.cn.evil.invalid/test','meituan'),undefined)
  assert.equal(safeTravelLink('http://dpurl.cn/test','fliggy'),undefined)
  assert.equal(safeTravelLink('http://dpurl.cn:8080/test','meituan'),undefined)
})

test('external markup cannot introduce executable URLs or URL credentials',()=>{
  for(const url of ['javascript:alert(1)','https://user:password@dpurl.cn/test','data:text/html,test','https://[bad','https://evil.invalid/test']) {
    assert.equal(safeTravelLink(url,'meituan'),undefined)
  }
})
