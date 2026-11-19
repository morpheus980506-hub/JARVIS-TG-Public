export async function* readJsonLines<T>(stream:ReadableStream<Uint8Array>):AsyncGenerator<T> {
  const reader=stream.getReader(),decoder=new TextDecoder()
  let buffer=''
  try {
    while(true) {
      const {value,done}=await reader.read()
      buffer+=decoder.decode(value || new Uint8Array(),{stream:!done})
      let end:number
      while((end=buffer.indexOf('\n'))!==-1) {
        const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1)
        if(line)yield JSON.parse(line) as T
      }
      if(done) {
        if(buffer.trim())yield JSON.parse(buffer) as T
        break
      }
    }
  } finally {
    try {await reader.cancel()} catch { /* An aborted fetch may already be closed. */ }
    reader.releaseLock()
  }
}
