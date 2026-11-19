import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/services/mapRoutes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText
const {createRouteService,isMetroPlan}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('each travel mode uses its own SDK service; unknown modes never become walking',()=>{
  const sdk=Object.fromEntries(['Driving','Walking','Riding','Transfer'].map(name=>[name,class {constructor(options){this.name=name;this.options=options}}]))
  for(const [mode,name] of Object.entries({driving:'Driving',taxi:'Driving',walking:'Walking',riding:'Riding',transit:'Transfer'})) {
    const service=createRouteService(sdk,mode,{autoFitView:true})
    assert.equal(service.name,name)
    assert.equal(service.options.autoFitView,true)
  }
  assert.throws(()=>createRouteService(sdk,'unknown',{}),/Unsupported/)
})

test('metro mode rejects bus-only plans and recognizes metro legs',()=>{
  assert.equal(isMetroPlan({segments:[{transit_mode:'BUS'}]}),false)
  assert.equal(isMetroPlan({segments:[{transit_mode:'SUBWAY'}]}),true)
  assert.equal(isMetroPlan({segments:[{bus:{buslines:[{type:'地铁'}]}}]}),true)
})

test('motorcycle and e-bike use distinct server route modes rather than bicycle routes',async()=>{
  const original=global.fetch
  const requests=[]
  global.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:false,json:async()=>({detail:'not authorized'})}}
  try {
    for(const mode of ['motorcycle','electric']) {
      const status=await new Promise(resolve=>createRouteService({},mode,{}).search([103,36],[104,37],(status)=>resolve(status)))
      assert.equal(status,'error')
    }
    assert.deepEqual(requests.map(p=>p.mode),['motorcycle','electric'])
  } finally {global.fetch=original}
})
