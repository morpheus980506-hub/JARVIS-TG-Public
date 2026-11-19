import { Button, Space, Typography } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { useEffect,useState } from 'react'
import { useT } from '../stores/settings'

export function QueryProgress({message,onStop}:{message:string;onStop?:()=>void}) {
  const t=useT(),[seconds,setSeconds]=useState(0)
  useEffect(()=>{
    const started=Date.now()
    const interval=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000)
    return ()=>clearInterval(interval)
  },[])
  return <div className="query-progress"><Space wrap><LoadingOutlined spin /><span role="status">{message}</span>{seconds>=5 && <Typography.Text type="secondary">{seconds}s</Typography.Text>}{onStop && <Button type="text" size="small" onClick={onStop}>{t('停止','Stop')}</Button>}</Space></div>
}
