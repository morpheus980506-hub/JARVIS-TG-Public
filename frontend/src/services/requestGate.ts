export function createRequestGate() {
  let serial=0
  let controller:AbortController|undefined
  const cancel=()=>{serial++;controller?.abort();controller=undefined}
  return {
    cancel,
    start:()=>{
      cancel()
      const ticket=serial
      const current=new AbortController()
      controller=current
      return {signal:current.signal,isCurrent:()=>ticket===serial && !current.signal.aborted}
    },
  }
}
