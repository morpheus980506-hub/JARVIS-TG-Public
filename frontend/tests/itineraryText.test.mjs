import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'

let code=ts.transpileModule(readFileSync(new URL('../src/components/ItineraryText.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:'ItineraryText.tsx',
}).outputText
for(const dependency of ['react/jsx-runtime','react-markdown','remark-gfm'])code=code.replaceAll(JSON.stringify(dependency),JSON.stringify(import.meta.resolve(dependency))).replaceAll(`'${dependency}'`,JSON.stringify(import.meta.resolve(dependency)))
const {ItineraryText}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const render=text=>renderToStaticMarkup(createElement(ItineraryText,{text}))

test('Chinese itinerary labels render as bold instead of literal markdown markers',()=>{
  const html=render('**行车**：约 630 公里 / 约 7 小时；**上午**：7:30 出发')
  assert.match(html,/<strong>行车<\/strong>/)
  assert.match(html,/<strong>上午<\/strong>/)
  assert.ok(!html.includes('**'))
  assert.ok(html.includes('630 公里 / 约 7 小时'))
})

test('day headings and list items keep inline markup without extra paragraph or heading blocks',()=>{
  const html=render('### **兰州 → 西安** · *轻松游*')
  assert.match(html,/<strong>兰州 → 西安<\/strong>/)
  assert.match(html,/<em>轻松游<\/em>/)
  assert.doesNotMatch(html,/<(?:p|h[1-6]|ul|li)[ >]/)
})

test('itinerary formatting preserves safe links without loading images or executable HTML',()=>{
  const html=render('[地图](https://uri.amap.com/marker?position=108,34) [危险](javascript:alert%281%29) ![图片](https://example.com/a.png) <script>alert(1)</script>')
  assert.match(html,/href="https:\/\/uri.amap.com/)
  assert.match(html,/rel="noopener noreferrer"/)
  assert.doesNotMatch(html,/<script|<img|href="javascript:/)
  const preview=renderToStaticMarkup(createElement(ItineraryText,{text:'**游玩** · [地图](https://uri.amap.com/)',links:false}))
  assert.match(preview,/<strong>游玩<\/strong>/)
  assert.doesNotMatch(preview,/<a /)
})
