type Progress = {stage?:string;status?:string;message?:string;message_en?:string}

export function progressLabel(event:Progress,language:'zh'|'en') {
  if(language==='zh')return event.message || '正在处理…'
  if(event.message_en)return event.message_en
  const titles:Record<string,string>={intent:'Your request',planner:'Trip details',weather:'Weather',research:'Places to visit',transport:'Transport options',hotel:'Accommodation',budget:'Cost estimates',itinerary:'Daily itinerary',verifier:'Plan checks',complete:'Your plan',driving_route:'Driving distances',search:'Travel information',advisor_model:'Your reply',flight_intent:'Flight details',flight_search:'Flights',supplier_fliggy:'Fliggy results',supplier_meituan:'Meituan results'}
  titles.dining_search='Restaurant options'
  titles.rail_search='Direct trains'
  Object.assign(titles, {deep_thinking:'Your reply', cycling_route:'Cycling route', advice_places:'Local sights and restaurants',
    advice_hotels:'Stays for your dates', advice_transport:'Intercity schedules'})
  const title=titles[event.stage || ''] || 'Your request'
  if(event.status==='FAILED')return `${title}: unable to finish this step.`
  if(event.status==='WARNING')return `${title}: some details need review.`
  if(event.status==='WAITING_INPUT')return 'Waiting for a few more details.'
  if(event.status==='SUCCESS')return `${title}: ready.`
  return `Preparing ${title.toLowerCase()}…`
}

export function trackProgress(language:'zh'|'en') {
  const active = new Map<string, string>()
  return (event: Progress) => {
    const label = progressLabel(event, language)
    if (event.stage) {
      if (event.status === 'RUNNING' || event.status === 'RETRY') {
        if (event.stage === 'advisor_model' || event.stage === 'deep_thinking') active.clear()
        active.delete(event.stage)
        active.set(event.stage, label)
      }
      else active.delete(event.stage)
    }
    return active.size ? [...active.values()].at(-1)! : label
  }
}
