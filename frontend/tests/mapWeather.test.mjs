import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/services/mapWeather.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/(from\s+)(['"])delaunator\2/g,(_,prefix)=>prefix+JSON.stringify(import.meta.resolve('delaunator')))
const { windVector, drawWeather, drawWindArrows, weatherCanvasSize, weatherColor, weatherScales, weatherSampler, compositeWeatherSampler } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('weather wind arrows show destination, not meteorological source direction', () => {
  assert.ok(windVector(0).y > 0.99) // northerly blows south (down on map)
  assert.ok(windVector(90).x < -0.99) // easterly blows west
  assert.ok(windVector(180).y < -0.99)
  assert.ok(windVector(270).x > 0.99)
})

test('raster follows projected map proportions to avoid stretching wind directions', () => {
  const size = weatherCanvasSize({west:0,east:10,south:0,north:1})
  assert.equal(size.width,640)
  assert.ok(size.height >= 63 && size.height <= 65)
})

function fixture(rain) {
  const images = []
  const ctx = { clearRect(){}, createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}}, putImageData(image){images.push(image)} }
  const canvas = {width:8,height:8,getContext(){ return ctx }}
  const grid = {bounds:{west:103,east:104,south:35,north:36}, points:[35,36].flatMap(latitude => [103,104].map(longitude =>
    ({latitude,longitude,precipitation:rain,cloud_cover:[null,null],wind_speed_10m:[null,null],wind_direction_10m:[null,null]})))}
  return {canvas,grid,images}
}

test('selected hour changes raster color; missing rain is hatched rather than zero', () => {
  const f = fixture([null,2.7])
  drawWeather(f.canvas,f.grid,'rain',0)
  assert.ok(f.images[0].data.every((value,index) => index%4 !== 3 || value <= 110))
  drawWeather(f.canvas,f.grid,'rain',1)
  assert.deepEqual([...f.images[1].data.slice(0,4)],[234,199,54,170])
  const zero = fixture([0,0])
  drawWeather(zero.canvas,zero.grid,'rain',0)
  assert.deepEqual([...zero.images[0].data.slice(0,4)],[220,239,247,170])
})

test('disabled layers produce no weather markings', () => {
  const f = fixture([9,12])
  drawWeather(f.canvas,f.grid,null,0)
  assert.deepEqual(f.images,[])
})

test('units and color ranges distinguish rain, wind and cloud quantities', () => {
  assert.equal(weatherScales.rain.unit,'mm/h')
  assert.equal(weatherScales.wind.unit,'m/s')
  assert.equal(weatherScales.clouds.unit,'%')
  assert.equal(weatherColor('rain',.5),'#258fdf')
  assert.equal(weatherColor('rain',10),'#e34c4c')
  assert.equal(weatherColor('wind',5),'#38b895')
  assert.equal(weatherColor('clouds',95),'#51477e')
  assert.equal(weatherColor('rain',null),null)
})

test('spatial interpolation is bounded by samples and never fills missing corners', () => {
  const f = fixture([0])
  f.grid.points.forEach((point,index) => {point.precipitation=[index*10]})
  assert.equal(weatherSampler(f.grid,'rain',0)(103.5,35.5),15)
  assert.equal(weatherSampler(f.grid,'rain',0)(105,35.5),null)
  f.grid.points[0].precipitation=[null]
  assert.equal(weatherSampler(f.grid,'rain',0)(103.5,35.5),null)
  assert.equal(weatherSampler(f.grid,'rain',0)(104,35),10)
})

test('panning across fixed geographic grids preserves the value at the same location', () => {
  const make = west => ({bounds:{west,east:west+1,south:35,north:36},points:[35,35.5,36].flatMap(latitude => [west,west+.5,west+1].map(longitude =>
    ({latitude,longitude,precipitation:[latitude+longitude],cloud_cover:[],wind_speed_10m:[],wind_direction_10m:[]})))})
  const a=weatherSampler(make(103),'rain',0)(103.75,35.25)
  const b=weatherSampler(make(103.5),'rain',0)(103.75,35.25)
  assert.equal(a,b)
})

test('zooming out keeps fine weather and fills surrounding coverage from coarse data at matching time', () => {
  const make = (bounds,step,values,hours) => ({bounds,grid_step:step,hours,points:[bounds.south,bounds.north].flatMap(latitude => [bounds.west,bounds.east].map(longitude =>
    ({latitude,longitude,precipitation:values,cloud_cover:[],wind_speed_10m:[],wind_direction_10m:[]})))})
  const coarse=make({west:0,east:4,south:0,north:4},2,[1,2],['00','01'])
  const fine=make({west:1,east:2,south:1,north:2},.5,[10,20],['01','02'])
  let sample=compositeWeatherSampler([coarse,fine],'rain','01')
  assert.equal(sample(1.5,1.5),10)
  assert.equal(sample(4,4),2)
  assert.ok(sample(3,3)>=2 && sample(3,3)<=10)
  assert.equal(compositeWeatherSampler([coarse,fine],'rain','02')(3,3),null)
  const f=fixture([0])
  drawWeather(f.canvas,fine,'rain',0,[coarse,fine],coarse.bounds)
  assert.deepEqual([...f.images[0].data.slice(-4)],[231,215,55,170])
  fine.points[0].precipitation=[null,null]
  sample=compositeWeatherSampler([fine,coarse],'rain','01')
  assert.equal(sample(1,1),2)
})

test('cached fine-grid edges blend continuously into coarse data without rectangular jumps',()=>{
  const make=(bounds,step,value)=>({bounds,grid_step:step,hours:['01'],points:[bounds.south,bounds.north].flatMap(latitude=>[bounds.west,bounds.east].map(longitude=>
    ({latitude,longitude,precipitation:[value],cloud_cover:[],wind_speed_10m:[],wind_direction_10m:[]})))})
  const coarse=make({west:0,east:4,south:0,north:4},2,2)
  const fine=make({west:1,east:2,south:1,north:2},.5,10)
  const sample=compositeWeatherSampler([coarse,fine],'rain','01')
  assert.ok(Math.abs(sample(1-1e-5,1.5)-sample(1+1e-5,1.5))<.001)
  const ramp=[0,.2,.4,.6,.8,1].map(x=>sample(x,1.5))
  assert.equal(ramp[0],2);assert.equal(ramp.at(-1),10)
  assert.ok(ramp.every((value,index)=>value>=2 && value<=10 && (!index || value>=ramp[index-1])))
  assert.equal(compositeWeatherSampler([fine],'rain','01')(1,1.5),10)
})

test('weather colors remain continuous across scale thresholds',()=>{
  const rgb=value=>weatherColor('rain',value).slice(1).match(/../g).map(channel=>parseInt(channel,16))
  const before=rgb(1.9999),after=rgb(2.0001)
  assert.ok(before.every((value,index)=>Math.abs(value-after[index])<=1))
  assert.notEqual(weatherColor('rain',2.1),weatherColor('rain',2.9))
})

test('wind arrows keep screen-pixel length and spacing across zoom and high DPI',()=>{
  const make=()=>{
    const rotations=[],segments=[],widths=[]
    const ctx={setTransform(){},clearRect(){},save(){},restore(){},translate(){},rotate(v){rotations.push(v)},beginPath(){},moveTo(x,y){segments.push([x,y])},lineTo(x,y){segments.push([x,y])},stroke(){widths.push(this.lineWidth)}}
    return {canvas:{getContext(){return ctx}},rotations,segments,widths}
  }
  const grid={bounds:{west:0,east:4,south:0,north:4},hours:['01'],points:[0,4].flatMap(latitude=>[0,4].map(longitude=>({latitude,longitude,precipitation:[],cloud_cover:[],wind_speed_10m:[10],wind_direction_10m:[0]})))}
  const a=make(),b=make()
  drawWindArrows(a.canvas,[grid],'01',{width:320,height:200,ratio:1,unproject:(x,y)=>({lng:x/80,lat:y/50})})
  drawWindArrows(b.canvas,[grid],'01',{width:320,height:200,ratio:2,unproject:(x,y)=>({lng:1+x/320,lat:1+y/200})})
  assert.equal(a.rotations.length,12);assert.equal(b.rotations.length,12)
  assert.deepEqual(a.segments,b.segments)
  assert.ok(a.segments.every(([x,y])=>Math.abs(x)<=9 && Math.abs(y)<=4))
  assert.ok(b.widths.every(width=>width<=3))
  assert.equal(b.canvas.width,640)
})

test('wind directions wrap correctly through north instead of flipping south',()=>{
  const angles=[]
  const ctx={setTransform(){},clearRect(){},save(){},restore(){},translate(){},rotate(v){angles.push(v)},beginPath(){},moveTo(){},lineTo(){},stroke(){}}
  const grid={bounds:{west:0,east:2,south:0,north:2},hours:['01'],points:[0,2].flatMap(latitude=>[0,2].map(longitude=>({latitude,longitude,precipitation:[],cloud_cover:[],wind_speed_10m:[10],wind_direction_10m:[longitude ? 1 : 359]})))}
  drawWindArrows({getContext(){return ctx}},[grid],'01',{width:72,height:72,ratio:1,unproject:()=>({lng:1,lat:1})})
  assert.equal(angles.length,1)
  assert.ok(Math.abs(angles[0]-Math.PI/2)<.001)
})

test('unified mesh preserves observed samples and does not extrapolate beyond coverage',()=>{
  const make=(bounds,step)=>{const points=[];for(let lat=bounds.south;lat<=bounds.north;lat+=step)for(let lng=bounds.west;lng<=bounds.east;lng+=step)points.push({latitude:lat,longitude:lng,precipitation:[lng*2+lat],cloud_cover:[],wind_speed_10m:[],wind_direction_10m:[]});return {bounds,grid_step:step,hours:['01'],points}}
  const coarse=make({west:0,east:4,south:0,north:4},2),fine=make({west:1,east:3,south:1,north:3},.5)
  const sample=compositeWeatherSampler([coarse,fine],'rain','01')
  for(const point of [...coarse.points,...fine.points]) assert.ok(Math.abs(sample(point.longitude,point.latitude)-point.precipitation[0])<1e-7)
  assert.equal(sample(-1,2),null)
  assert.equal(sample(5,2),null)
})
