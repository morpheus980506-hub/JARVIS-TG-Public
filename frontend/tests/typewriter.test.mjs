import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/services/typewriter.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createTypewriter } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('final-only response reveals gradually and preserves emoji', async () => {
  const frames = []
  const writer = createTypewriter(text => frames.push(text))
  const text = '你好🌍，一起出发。'
  const done = writer.finish(text)
  assert.equal(frames.length, 0)
  await done
  assert.equal(frames.at(-1), text)
  assert.ok(frames.length > 1)
  assert.equal(frames[0], '你')
  assert.ok(frames.every(frame => !/[\uD800-\uDBFF]$/.test(frame)))
  writer.stop()
})

test('stream chunks followed by final result do not repeat content', async () => {
  const frames = []
  const writer = createTypewriter(text => frames.push(text))
  writer.append('### Day 1\n')
  writer.append('- Museum')
  await writer.finish('### Day 1\n- Museum')
  assert.equal(frames.at(-1), '### Day 1\n- Museum')
  assert.ok(frames.every(frame => '### Day 1\n- Museum'.startsWith(frame)))
  writer.stop()
})

test('stop resolves pending reveal and prevents later frames', async () => {
  const frames = []
  const writer = createTypewriter(text => frames.push(text))
  const done = writer.finish('A long response')
  writer.stop()
  await done
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.deepEqual(frames, [])
})

test('a final result arriving after stop cannot flash the complete reply',async()=>{
  const frames=[]
  const writer=createTypewriter(text=>frames.push(text))
  writer.append('尚未显示')
  writer.stop()
  await writer.finish('这是停止后迟到的完整回复')
  await new Promise(resolve=>setTimeout(resolve,25))
  assert.deepEqual(frames,[])
})
