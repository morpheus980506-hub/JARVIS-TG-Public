import type { WeatherGrid } from './mapWeather'

type Bounds = WeatherGrid['bounds'] & {grid_step?:number}
function resolution(view: Bounds) { return Math.max(.125,Math.min(32,2**Math.ceil(Math.log2(Math.max(.00001,Number((view.east-view.west).toFixed(5)))/3)))) }
const ttl = 10*60*1000
function area(b: Bounds) { return (b.east-b.west)*(b.north-b.south) }
function covers(box: Bounds, view: Bounds) {
  return box.west <= view.west && box.east >= view.east && box.south <= view.south && box.north >= view.north
    // Do not reuse a country-scale grid as a city-scale forecast after zooming in.
    && (box.east-box.west)/Math.max(.05,view.east-view.west,(box.grid_step ?? 0)*2) <= 2 && (box.north-box.south)/Math.max(.05,view.north-view.south,(box.grid_step ?? 0)*2) <= 2
}
export function paddedWeatherBounds(view: Bounds): Bounds {
  const dx = (view.east-view.west)*.18, dy = (view.north-view.south)*.18
  return {grid_step:resolution(view),west:Math.max(-180,Math.floor((view.west-dx)*20)/20),east:Math.min(180,Math.ceil((view.east+dx)*20)/20),
    south:Math.max(-85,Math.floor((view.south-dy)*20)/20),north:Math.min(85,Math.ceil((view.north+dy)*20)/20)}
}

async function fetchGrid(bounds: Bounds): Promise<WeatherGrid> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(),22000)
  try {
    const response = await fetch('/api/v1/map/weather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bounds),signal:controller.signal})
    if (!response.ok) throw new Error('Weather unavailable')
    return await response.json() as WeatherGrid
  } finally { clearTimeout(timeout) }
}

export class WeatherGridCache {
  private entries: WeatherGrid[] = []
  private pending = new Map<string,{bounds:Bounds;promise:Promise<WeatherGrid>}>()
  constructor(private fetcher = fetchGrid,private now = () => Date.now()) {}
  visible(view: Bounds,allowStale = false) {
    return this.entries.filter(grid => grid.bounds.west < view.east && grid.bounds.east > view.west && grid.bounds.south < view.north && grid.bounds.north > view.south
      && this.now()-Date.parse(grid.fetched_at) < ttl*(allowStale ? 3 : 1))
      .sort((a,b) => (a.grid_step ?? Math.sqrt(area(a.bounds))) - (b.grid_step ?? Math.sqrt(area(b.bounds))) || Date.parse(b.fetched_at)-Date.parse(a.fetched_at))
  }
  peek(view: Bounds,allowStale = false) {
    return this.entries.filter(grid => (grid.grid_step == null || grid.grid_step === resolution(view)) && covers({...grid.bounds,grid_step:grid.grid_step},view) && this.now()-Date.parse(grid.fetched_at) < ttl*(allowStale ? 3 : 1))
      .sort((a,b) => area(a.bounds)-area(b.bounds))[0]
  }
  request(view: Bounds): Promise<WeatherGrid> {
    const cached = this.peek(view)
    if (cached) return Promise.resolve(cached)
    const bounds = paddedWeatherBounds(view), key = JSON.stringify(bounds)
    const existing = this.pending.get(key) ?? [...this.pending.values()].find(entry => entry.bounds.grid_step === bounds.grid_step && covers(entry.bounds,view))
    if (existing) return existing.promise
    const promise = Promise.resolve().then(() => this.fetcher(bounds)).then(grid => {
      this.entries = [grid,...this.entries.filter(item => JSON.stringify(item.bounds) !== JSON.stringify(grid.bounds) || item.grid_step !== grid.grid_step)].slice(0,12)
      return grid
    }).finally(() => this.pending.delete(key))
    this.pending.set(key,{bounds,promise})
    return promise
  }
}

export const weatherGridCache = new WeatherGridCache()
