import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/services/weatherCache.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const { WeatherGridCache } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const view = {west:103,east:104,south:35,north:36}
const timestamp = Date.parse('2026-11-08T02:00:00Z')
const grid = (bounds,now) => ({bounds,fetched_at:new Date(now).toISOString(),points:[],hours:[]})

test('nearby pans and reopening weather reuse the complete forecast without requests', async () => {
  let calls = 0
  const cache = new WeatherGridCache(async bounds => {calls++; return grid(bounds,timestamp)},() => timestamp)
  const first = await cache.request(view)
  assert.equal(await cache.request({...view,west:103.05,east:104.05}),first)
  assert.equal(await cache.request(view),first)
  assert.equal(calls,1)
})

test('rapid overlapping requests share one in-flight fetch', async () => {
  let calls=0, release
  const gate = new Promise(resolve => {release=resolve})
  const cache = new WeatherGridCache(async bounds => {calls++; await gate; return grid(bounds,timestamp)},() => timestamp)
  const first = cache.request(view)
  const second = cache.request({...view,west:103.05,east:104.05})
  await Promise.resolve()
  release()
  const values = await Promise.all([first,second])
  assert.equal(calls,1)
  assert.equal(values[0],values[1])
})

test('expired forecast stays readable while a refresh is requested', async () => {
  let now=timestamp, calls=0
  const cache = new WeatherGridCache(async bounds => {calls++; return grid(bounds,now)},() => now)
  const first = await cache.request(view)
  now += 11*60*1000
  assert.equal(cache.peek(view),undefined)
  assert.equal(cache.peek(view,true),first)
  assert.notEqual(await cache.request(view),first)
  assert.equal(calls,2)
})

test('zooming from a national view into a city requests finer coverage', async () => {
  let calls=0
  const cache = new WeatherGridCache(async bounds => {calls++; return grid(bounds,timestamp)},() => timestamp)
  await cache.request({west:70,east:130,south:10,north:50})
  assert.equal(cache.peek(view),undefined)
  await cache.request(view)
  assert.equal(calls,2)
})

test('failed updates release the pending request and keep last data available', async () => {
  let now=timestamp, fail=false
  const cache = new WeatherGridCache(async bounds => {if(fail) throw Error('offline'); return grid(bounds,now)},() => now)
  const first = await cache.request(view)
  now += 11*60*1000; fail=true
  await assert.rejects(cache.request(view),/offline/)
  assert.equal(cache.peek(view,true),first)
  fail=false
  assert.notEqual(await cache.request(view),first)
})

test('zoom out, zoom in, zoom back restores full cached coverage and preserves fine samples',async()=>{
  let calls=0
  const cache=new WeatherGridCache(async bounds=>{calls++;return {...grid(bounds,timestamp),grid_step:bounds.grid_step}},()=>timestamp)
  const outer={west:102,east:106,south:34,north:38}
  const coarse=await cache.request(outer)
  const fine=await cache.request(view)
  assert.notEqual(fine.grid_step,coarse.grid_step)
  assert.equal(await cache.request(outer),coarse)
  assert.equal(calls,2)
  assert.deepEqual(cache.visible(outer),[fine,coarse])
})
