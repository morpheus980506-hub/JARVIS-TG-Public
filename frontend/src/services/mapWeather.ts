import Delaunator from 'delaunator'

export interface WeatherGrid {
  grid_step?: number
  bounds: {west: number; east: number; south: number; north: number}
  hours: string[]
  points: Array<{latitude: number; longitude: number; precipitation: (number|null)[]; cloud_cover: (number|null)[]; wind_speed_10m: (number|null)[]; wind_direction_10m: (number|null)[]}>
  source_url: string
  fetched_at: string
}
export type WeatherField = 'rain' | 'wind' | 'clouds'

export function weatherCanvasSize(bounds: WeatherGrid['bounds']) {
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))
  const aspect = ((bounds.east-bounds.west)*Math.PI/180)/(mercator(bounds.north)-mercator(bounds.south))
  return {width:Math.max(2,Math.round(640*Math.min(1,aspect))),height:Math.max(2,Math.round(640*Math.min(1,1/aspect)))}
}

// Control points shared by the continuous raster and its legend.
export const weatherScales = {
  rain: {unit:'mm/h', stops:[
    {min:0,color:'#dceff7'},{min:.1,color:'#71c8f3'},{min:.5,color:'#258fdf'},
    {min:1,color:'#23b88b'},{min:2,color:'#e7d737'},{min:5,color:'#f29332'},
    {min:10,color:'#e34c4c'},{min:20,color:'#a737b9'},
  ]},
  wind: {unit:'m/s', stops:[
    {min:0,color:'#dceff7'},{min:2,color:'#6ecce4'},{min:5,color:'#38b895'},
    {min:8,color:'#b5cf46'},{min:11,color:'#f1c43e'},{min:14,color:'#ee8b3b'},
    {min:17,color:'#dd4e69'},{min:25,color:'#983fba'},
  ]},
  clouds: {unit:'%', stops:[
    {min:0,color:'#edf5fc'},{min:10,color:'#c2dbef'},{min:25,color:'#8db5db'},
    {min:50,color:'#6c8fbc'},{min:75,color:'#686fab'},{min:90,color:'#51477e'},
  ]},
} as const

const rgbScales = Object.fromEntries(Object.entries(weatherScales).map(([key,scale]) => [key,scale.stops.map(stop => ({min:stop.min,rgb:[parseInt(stop.color.slice(1,3),16),parseInt(stop.color.slice(3,5),16),parseInt(stop.color.slice(5,7),16)]}))]))

export function weatherRgb(field: WeatherField, value: number | null): number[] | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  const stops = rgbScales[field]
  for (let i=1;i<stops.length;i++) {
    if(value < stops[i].min) {
      const weight=(value-stops[i-1].min)/(stops[i].min-stops[i-1].min)
      return stops[i-1].rgb.map((channel,index)=>Math.round(channel+(stops[i].rgb[index]-channel)*weight))
    }
  }
  return stops[stops.length-1].rgb
}

export function weatherColor(field: WeatherField, value: number | null): string | null {
  const rgb=weatherRgb(field,value)
  return rgb ? '#'+rgb.map(channel=>channel.toString(16).padStart(2,'0')).join('') : null
}

export function weatherSampler(grid: WeatherGrid, field: WeatherField, hour: number) {
  const xs = [...new Set(grid.points.map(p => p.longitude))].sort((a,b) => a-b)
  const ys = [...new Set(grid.points.map(p => p.latitude))].sort((a,b) => a-b)
  const property = {rain:'precipitation',wind:'wind_speed_10m',clouds:'cloud_cover'} as const
  const cells = ys.map(latitude => xs.map(longitude => grid.points.find(p => p.longitude === longitude && p.latitude === latitude)?.[property[field]][hour]))
  function bracket(values: number[], position: number) {
    const upper = values.findIndex(v => v >= position)
    if (upper <= 0) return [0,0,0]
    const lower = upper-1
    return [lower,upper,(position-values[lower])/(values[upper]-values[lower])]
  }
  return (longitude: number, latitude: number): number | null => {
    if (!xs.length || !ys.length || longitude < xs[0] || longitude > xs.at(-1)! || latitude < ys[0] || latitude > ys.at(-1)!) return null
    const [x0,x1,tx] = bracket(xs,longitude), [y0,y1,ty] = bracket(ys,latitude)
    const corners = [[x0,y0,(1-tx)*(1-ty)],[x1,y0,tx*(1-ty)],[x0,y1,(1-tx)*ty],[x1,y1,tx*ty]]
    let value = 0
    for (const [x,y,weight] of corners) {
      if (weight < 1e-9) continue
      const cell = cells[y][x]
      if (cell == null || !Number.isFinite(cell)) return null
      value += cell*weight
    }
    return value
  }
}

// Wind direction is where the wind comes FROM; arrows point toward its destination.
export function windVector(direction: number) {
  const angle = direction * Math.PI / 180
  return {x: -Math.sin(angle), y: Math.cos(angle)}
}

export function compositeWeatherSampler(grids: WeatherGrid[], field: WeatherField, validTime: string) {
  const samplers = [...grids].sort((a,b) => (a.grid_step ?? (a.bounds.east-a.bounds.west))-(b.grid_step ?? (b.bounds.east-b.bounds.west)) || Date.parse(b.fetched_at)-Date.parse(a.fetched_at))
    .flatMap(grid => {const hour=grid.hours.indexOf(validTime); return hour < 0 ? [] : [{grid,hour,sample:weatherSampler(grid,field,hour)}]})
  const property={rain:'precipitation',wind:'wind_speed_10m',clouds:'cloud_cover'} as const
  const vertices=new Map<string,{lng:number;lat:number;value:number|null}>()
  for(const {grid,hour} of samplers) for(const point of grid.points) {
    const key=`${point.longitude.toFixed(7)},${point.latitude.toFixed(7)}`
    if(vertices.has(key)) continue
    let value=point[property[field]][hour]
    if(value == null) {
      for(const fallback of samplers) {const candidate=fallback.sample(point.longitude,point.latitude);if(candidate != null) {value=candidate;break}}
    }
    vertices.set(key,{lng:point.longitude,lat:point.latitude,value:value ?? null})
  }
  const points=[...vertices.values()]
  if(points.length<3) return (lng:number,lat:number)=>points.find(p=>Math.abs(p.lng-lng)<1e-8 && Math.abs(p.lat-lat)<1e-8)?.value ?? null
  const mesh=Delaunator.from(points,p=>p.lng,p=>p.lat)
  const minX=Math.min(...points.map(p=>p.lng)),maxX=Math.max(...points.map(p=>p.lng))
  const minY=Math.min(...points.map(p=>p.lat)),maxY=Math.max(...points.map(p=>p.lat))
  const bucketX=(x:number)=>Math.max(0,Math.min(31,Math.floor((x-minX)/Math.max(1e-12,maxX-minX)*32)))
  const bucketY=(y:number)=>Math.max(0,Math.min(31,Math.floor((y-minY)/Math.max(1e-12,maxY-minY)*32)))
  const buckets:number[][]=Array.from({length:1024},()=>[])
  const triangles:Array<{a:typeof points[number];b:typeof points[number];c:typeof points[number];den:number}>=[]
  for(let index=0;index<mesh.triangles.length;index+=3) {
    const [a,b,c]=[points[mesh.triangles[index]],points[mesh.triangles[index+1]],points[mesh.triangles[index+2]]]
    const den=(b.lat-c.lat)*(a.lng-c.lng)+(c.lng-b.lng)*(a.lat-c.lat)
    if(Math.abs(den)<1e-14) continue
    const id=triangles.push({a,b,c,den})-1
    for(let y=bucketY(Math.min(a.lat,b.lat,c.lat));y<=bucketY(Math.max(a.lat,b.lat,c.lat));y++)
      for(let x=bucketX(Math.min(a.lng,b.lng,c.lng));x<=bucketX(Math.max(a.lng,b.lng,c.lng));x++) buckets[y*32+x].push(id)
  }
  return (lng: number,lat: number) => {
    if(lng<minX || lng>maxX || lat<minY || lat>maxY || !samplers.some(({grid})=>lng>=grid.bounds.west && lng<=grid.bounds.east && lat>=grid.bounds.south && lat<=grid.bounds.north)) return null
    for(const id of buckets[bucketY(lat)*32+bucketX(lng)]) {
      const {a,b,c,den}=triangles[id]
      const wa=((b.lat-c.lat)*(lng-c.lng)+(c.lng-b.lng)*(lat-c.lat))/den
      const wb=((c.lat-a.lat)*(lng-c.lng)+(a.lng-c.lng)*(lat-c.lat))/den
      const wc=1-wa-wb
      if(wa < -1e-8 || wb < -1e-8 || wc < -1e-8) continue
      if((wa>1e-8 && a.value==null)||(wb>1e-8 && b.value==null)||(wc>1e-8 && c.value==null)) return null
      const x=Math.max(0,wa),y=Math.max(0,wb),z=Math.max(0,wc)
      return ((a.value ?? 0)*x+(b.value ?? 0)*y+(c.value ?? 0)*z)/(x+y+z)
    }
    return null
  }
}

export function drawWeather(canvas: HTMLCanvasElement, grid: WeatherGrid, field: WeatherField | null, hour: number, layers: WeatherGrid[] = [grid], bounds = grid.bounds) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = canvas.width, height = canvas.height
  ctx.clearRect(0,0,width,height)
  if (!field) return
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  const top = mercator(bounds.north), bottom = mercator(bounds.south)
  const sample = grid.hours?.[hour] ? compositeWeatherSampler(layers,field,grid.hours[hour]) : weatherSampler(grid,field,hour)
  const pixels = ctx.createImageData(width,height)
  for (let y=0; y<height; y++) {
    const latitude = Math.max(bounds.south,Math.min(bounds.north,(2*Math.atan(Math.exp(top - y/(height-1)*(top-bottom)))-Math.PI/2)*180/Math.PI))
    for (let x=0; x<width; x++) {
      const longitude = bounds.west + x/(width-1)*(bounds.east-bounds.west)
      const rgb = weatherRgb(field,sample(longitude,latitude))
      const offset = (y*width+x)*4
      if (rgb) {
        pixels.data[offset] = rgb[0]; pixels.data[offset+1] = rgb[1]; pixels.data[offset+2] = rgb[2]; pixels.data[offset+3] = 170
      } else if ((x+y)%14<2) pixels.data.set([80,90,105,110],offset)
    }
  }
  ctx.putImageData(pixels,0,0)
}

export function createWindSampler(grids: WeatherGrid[],time:string) {
  const component = (axis:'x'|'y') => compositeWeatherSampler(grids.map(grid=>({...grid,points:grid.points.map(point=>({...point,
    wind_speed_10m:point.wind_speed_10m.map((speed,index)=>speed == null || point.wind_direction_10m[index] == null ? null : speed*windVector(point.wind_direction_10m[index]!)[axis])
  }))})),'wind',time)
  const sx=component('x'),sy=component('y')
  return (lng:number,lat:number)=>{
    const x=sx(lng,lat),y=sy(lng,lat)
    return x == null || y == null || Math.hypot(x,y)<.2 ? null : {x,y}
  }
}

export function drawWindArrows(canvas: HTMLCanvasElement, grids: WeatherGrid[], time: string, viewport: {
  width:number; height:number; ratio:number; unproject:(x:number,y:number)=>{lng:number;lat:number};
  angle?:(lng:number,lat:number,vector:{x:number;y:number})=>number;
},sample=createWindSampler(grids,time)) {
  const ctx=canvas.getContext('2d')
  if(!ctx) return
  canvas.width=Math.round(viewport.width*viewport.ratio);canvas.height=Math.round(viewport.height*viewport.ratio)
  ctx.setTransform(viewport.ratio,0,0,viewport.ratio,0,0)
  ctx.clearRect(0,0,viewport.width,viewport.height)
  ctx.lineCap='round';ctx.lineJoin='round'
  for(let y=36;y<viewport.height-18;y+=72) for(let x=36;x<viewport.width-18;x+=72) {
    const point=viewport.unproject(x,y),vector=sample(point.lng,point.lat)
    if(!vector) continue
    ctx.save();ctx.translate(x,y);ctx.rotate(viewport.angle?.(point.lng,point.lat,vector) ?? Math.atan2(vector.y,vector.x))
    ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(9,0);ctx.lineTo(4,-4);ctx.moveTo(9,0);ctx.lineTo(4,4)
    ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.stroke()
    ctx.lineWidth=1.2;ctx.strokeStyle='#165966';ctx.stroke();ctx.restore()
  }
}
