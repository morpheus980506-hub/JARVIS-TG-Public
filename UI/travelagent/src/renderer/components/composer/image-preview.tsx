import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import type { Attachment } from '../../../shared'

export function ImagePreview({
  attachment,
  close,
  returnFocus,
}: {
  attachment: Attachment
  close: () => void
  returnFocus: () => void
}) {
  const [source, setSource] = useState<string>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void api.attachmentImage(attachment.id).then(
      (data) => {
        if (active) setSource(data)
      },
      () => {
        if (active) setError('原图加载失败，请重试')
      },
    )
    return () => {
      active = false
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- attempt explicitly retries the same original image after failure.
  }, [attachment.id, attempt])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        variant="image"
        onCloseAutoFocus={(event) => {
          // This dialog is opened programmatically from an attachment trigger.
          event.preventDefault()
          returnFocus()
        }}
      >
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="truncate text-sm">{attachment.name}</DialogTitle>
          <DialogDescription className="sr-only">
            图片原图预览，按 Escape 或点击关闭按钮返回。
          </DialogDescription>
        </DialogHeader>
        <div
          className="relative flex min-h-24 min-w-24 items-center justify-center"
          aria-busy={!source && !error}
        >
          <img
            src={source || attachment.preview}
            alt={attachment.name}
            className="max-h-[calc(90dvh-6rem)] max-w-[calc(100vw-6rem)] rounded-md object-contain"
            onError={() => setError('原图加载失败，请重试')}
          />
          {!source && !error && (
            <div
              role="status"
              className="bg-background/80 absolute inset-0 flex items-center justify-center gap-2 rounded-md text-sm"
            >
              <Spinner />
              正在加载原图…
            </div>
          )}
        </div>
        {error && (
          <div role="alert" className="flex items-center justify-center gap-3 text-sm">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSource(undefined)
                setError('')
                setAttempt((value) => value + 1)
              }}
            >
              重试
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
