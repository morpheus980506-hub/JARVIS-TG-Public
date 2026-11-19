import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Day titles and list items share inline formatting without introducing nested paragraphs.
export function ItineraryText({text,links=true}:{text:string;links?:boolean}) {
  return <span className="itinerary-text"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    allowedElements={['strong','em','del','code','a','br']} unwrapDisallowed
    components={{a:({href,children})=>{
      let safe=false
      try {const url=new URL(href || '');safe=['https:','http:'].includes(url.protocol) && !url.username && !url.password} catch { /* Render invalid destinations as text. */ }
      return safe && links ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
    }}}>{text}</ReactMarkdown></span>
}
