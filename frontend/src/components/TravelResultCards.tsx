import { Alert, Button, Card, Collapse, Space, Typography } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeTravelLink } from '../services/travelLinks'
import { useT } from '../stores/settings'
import type { TravelCandidate,TravelResult } from '../types'

export function TravelResultCards({results,onSelect}:{results:TravelResult[];onSelect:(item:TravelCandidate)=>void}) {
  const t=useT()
  return <div className="supplier-chat-results">{results.map(result=><Card size="small" key={result.provider} title={result.provider==='fliggy' ? t('飞猪','Fliggy') : t('美团','Meituan')}>
    {result.error && <Alert type="warning" message={t('本次查询未完成，可重新查询或使用另一平台','Search unavailable. Retry or use the other provider.')} />}
    {result.items.map(item=><article className="travel-search-item" key={item.candidate_id}><Typography.Text strong>{item.title}</Typography.Text><Typography.Text>{item.price_text || t('价格需到平台确认','Check the price on the provider page')}</Typography.Text><Space><Button size="small" onClick={()=>onSelect({...item,provider:result.provider,category:result.category})}>{t('加入行程','Add to trip')}</Button>{safeTravelLink(item.url || undefined,result.provider) && <Button size="small" href={safeTravelLink(item.url || undefined,result.provider)} target="_blank" rel="noreferrer">{t('查看详情','View details')}</Button>}</Space></article>)}
    {result.text && <Collapse items={[{key:'source',label:t('平台原文','Provider response'),children:<div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:()=>null,a:({href,children})=>{const url=safeTravelLink(href,result.provider);return url ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>}}}>{result.text}</ReactMarkdown></div>}]} />}
    {result.notice && <Typography.Paragraph type="secondary">{result.notice}</Typography.Paragraph>}
  </Card>)}</div>
}
