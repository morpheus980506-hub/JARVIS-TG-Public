export function createRouteService(sdk: any, mode: string, options: Record<string,unknown>) {
  if (mode === 'electric' || mode === 'motorcycle') return specialRoute(sdk,mode,options)
  if (mode === 'subway') return metroRoute(sdk,options)
  const Route = ({driving:sdk.Driving,taxi:sdk.Driving,walking:sdk.Walking,riding:sdk.Riding,transit:sdk.Transfer})[mode]
  if (!Route) throw new Error('Unsupported travel mode')
  return new Route(options)
}

function specialRoute(sdk: any,mode: string,options: Record<string,any>) {
  let overlays: any[] = []
  let controller: AbortController | undefined
  return {
    clear() {controller?.abort(); if(overlays.length) options.map.remove(overlays); overlays=[]},
    search(start: any,end: any,done: (status: string,data: any) => void) {
      controller = new AbortController()
      const coordinate = (p:any) => [p.getLng?.() ?? p.lng ?? p[0],p.getLat?.() ?? p.lat ?? p[1]]
      void fetch('/api/v1/map/route',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({mode,origin:coordinate(start),destination:coordinate(end)})}).then(async response => {
          const data = await response.json()
          if (controller?.signal.aborted) return
          if (!response.ok) {done('error',{message:data.detail}); return}
          overlays=[new sdk.Polyline({path:data.path,strokeColor:'#168bce',strokeWeight:6}),new sdk.Marker({position:start}),new sdk.Marker({position:end})]
          options.map.add(overlays); options.map.setFitView(overlays)
          if (options.panel) {
            options.panel.replaceChildren()
            for (const instruction of data.instructions) {
              const row=document.createElement('p'); row.textContent=instruction; options.panel.append(row)
            }
          }
          done('complete',{routes:[data]})
        }).catch(error => {if(error.name !== 'AbortError') done('error',{})})
    },
  }
}

export function isMetroPlan(plan: any) {
  return (plan.segments ?? []).some((segment:any) => segment.transit_mode === 'SUBWAY' ||
    [...(segment.transit?.lines ?? []),...(segment.bus?.buslines ?? [])].some((line:any) => line.type === '地铁' || line.type === 'SUBWAY'))
}

function metroRoute(sdk: any,options: Record<string,any>) {
  const transfer = new sdk.Transfer({...options,map:undefined,panel:undefined})
  let overlays: any[] = []
  let generation = 0
  const clear = () => {generation++; transfer.clear(); if(overlays.length) options.map.remove(overlays); overlays=[]}
  return {
    clear,
    setCity: (city:string) => transfer.setCity(city),
    setCityd: (city:string) => transfer.setCityd(city),
    search(start:any,end:any,done:(status:string,data:any)=>void) {
      const current=++generation
      transfer.search(start,end,(status:string,result:any) => {
        if(current !== generation) return
        const plans=(result?.plans ?? []).filter(isMetroPlan)
        if(status !== 'complete' || !plans.length) {done('no_data',{message:'未找到包含地铁的方案，请更换地点或查询其他出行方式。'});return}
        const plan=plans[0]
        const lines=(plan.segments ?? []).flatMap((segment:any) => {
          const raw=segment.transit?.path ?? segment.walking?.path ?? segment.bus?.buslines?.[0]?.polyline
          const path=typeof raw === 'string' ? raw.split(';').map((point:string)=>point.split(',').map(Number)) : raw
          return path?.length ? [new sdk.Polyline({path,strokeColor:segment.transit_mode === 'WALK' ? '#8b929a' : '#168bce',strokeWeight:6})] : []
        })
        if(!lines.length) {done('error',{message:'地铁服务未返回可绘制的线路，请稍后重试。'});return}
        overlays=[...lines,new sdk.Marker({position:start}),new sdk.Marker({position:end})]
        options.map.add(overlays);options.map.setFitView(overlays)
        if(options.panel) {
          options.panel.replaceChildren()
          for(const segment of plan.segments) {
            const row=document.createElement('p')
            row.textContent=segment.instruction || segment.transit?.lines?.map((line:any)=>line.name).join(' / ') || (segment.transit_mode === 'WALK' ? '步行接驳' : '地铁换乘')
            options.panel.append(row)
          }
        }
        done('complete',{...result,plans})
      })
    },
  }
}
