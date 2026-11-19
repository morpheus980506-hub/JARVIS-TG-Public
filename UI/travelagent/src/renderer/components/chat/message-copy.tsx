import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function MessageCopy({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={copied ? '已复制' : '复制消息'}
      aria-label={copied ? '已复制' : '复制消息'}
      disabled={!content}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content)
          setCopied(true)
        } catch {
          toast.error('复制失败，请重试')
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
