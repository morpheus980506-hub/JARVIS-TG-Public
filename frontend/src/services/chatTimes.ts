import type { ChatMessage } from '../types'

const timeZone='Asia/Shanghai'
function parts(time:number) {
  const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time).map(part=>[part.type,part.value]))
  return {year:fields.year,month:fields.month,day:fields.day,hour:fields.hour,minute:fields.minute,dayNumber:Date.UTC(Number(fields.year),Number(fields.month)-1,Number(fields.day))/86400000}
}
function timestamp(value?:string) {const time=value ? Date.parse(value) : NaN;return Number.isFinite(time) ? time : undefined}

export function chatTimeSeparators(messages:Pick<ChatMessage,'created_at'>[],language:'zh'|'en',now=Date.now()):(string|undefined)[] {
  const today=parts(now)
  return messages.map((message,index)=>{
    const time=timestamp(message.created_at),previous=timestamp(messages[index-1]?.created_at)
    if(time===undefined)return index===0 || previous!==undefined ? (language==='zh' ? '早期消息 · 未记录时间' : 'Earlier messages · time not recorded') : undefined
    const date=parts(time)
    if(previous!==undefined && time>=previous && time-previous<5*60*1000 && date.dayNumber===parts(previous).dayNumber)return undefined
    const clock=`${date.hour}:${date.minute}`
    if(date.dayNumber===today.dayNumber)return `${language==='zh' ? '今天' : 'Today'} ${clock}`
    if(date.dayNumber===today.dayNumber-1)return `${language==='zh' ? '昨天' : 'Yesterday'} ${clock}`
    const prefix=language==='zh' ? `${date.year!==today.year ? date.year+'年' : ''}${Number(date.month)}月${Number(date.day)}日` : new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',...(date.year!==today.year ? {year:'numeric'} : {})}).format(time)
    return `${prefix} ${clock}`
  })
}
