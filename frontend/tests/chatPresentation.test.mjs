import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function loadService(name) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const { trackProgress } = await loadService('progress')
const { splitWebSources } = await loadService('webSources')

test('completion of one lookup leaves the other active lookup visible', () => {
  const update = trackProgress('zh')
  update({stage:'advice_places',status:'RUNNING',message:'正在查询游玩地点'})
  update({stage:'search',status:'RUNNING',message:'正在复核网页资料'})
  assert.equal(update({stage:'search',status:'SUCCESS',message:'网页复核完成'}), '正在查询游玩地点')
  assert.equal(update({stage:'deep_thinking',status:'RUNNING',message:'正在整理回复'}), '正在整理回复')
})

test('saved replies display trailing source links as a separate footer', () => {
  const text = '行程建议\n\n**网页来源**\n\n- [通行公告](https://example.com)'
  assert.deepEqual(splitWebSources(text), {body:'行程建议', heading:'网页来源', sources:'\n- [通行公告](https://example.com)'})
  assert.deepEqual(splitWebSources(text + '\n\n正文继续'), {body:text + '\n\n正文继续'})
})
