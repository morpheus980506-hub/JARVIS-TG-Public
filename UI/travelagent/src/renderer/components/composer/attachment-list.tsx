import { FileText, X } from 'lucide-react'
import { useState, useRef } from 'react'
import { ImagePreview } from '@/components/composer/image-preview'
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
} from '@/components/ui/attachment'
import { cn } from '@/lib/utils'
import type { Attachment as AttachmentValue } from '../../../shared'

export function AttachmentList({
  items,
  remove,
  align = 'start',
}: {
  items: AttachmentValue[]
  remove?: (id: string) => void
  align?: 'start' | 'end'
}) {
  const previewTrigger = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<AttachmentValue>()
  if (!items.length) return null
  return (
    <>
      <AttachmentGroup
        aria-label={remove ? '待发送附件' : '消息附件'}
        className={cn('w-full', align === 'end' && 'justify-end')}
      >
        {items.map((item) => (
          <Attachment key={item.id} variant={item.preview ? 'image' : 'default'} title={item.name}>
            <AttachmentMedia variant={item.preview ? 'image' : 'icon'}>
              {item.preview ? <img src={item.preview} alt={item.name} /> : <FileText />}
            </AttachmentMedia>
            {!item.preview && (
              <AttachmentContent>
                <AttachmentTitle>{item.name}</AttachmentTitle>
                <AttachmentDescription>
                  {Math.max(1, Math.ceil(item.size / 1024))} KB
                </AttachmentDescription>
              </AttachmentContent>
            )}
            {item.preview && (
              <AttachmentTrigger
                data-preview-id={item.id}
                aria-label={`放大查看：${item.name}`}
                onClick={(event) => {
                  previewTrigger.current = event.currentTarget
                  setPreview(item)
                }}
              />
            )}
            {remove && (
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`移除附件：${item.name}`}
                  title="移除附件"
                  onClick={() => remove(item.id)}
                >
                  <X data-icon="inline-start" />
                </AttachmentAction>
              </AttachmentActions>
            )}
          </Attachment>
        ))}
      </AttachmentGroup>
      {preview && (
        <ImagePreview
          returnFocus={() => previewTrigger.current?.focus()}
          key={preview.id}
          attachment={preview}
          close={() => setPreview(undefined)}
        />
      )}
    </>
  )
}
