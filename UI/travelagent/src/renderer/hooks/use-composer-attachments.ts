import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../../attachments'
import type { Attachment } from '../../shared'
import { api } from '../lib/api'

export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsBusy, setBusy] = useState(false)
  const busy = useRef(false)
  const add = (items: Attachment[]) =>
    setAttachments((current) => {
      const combined = [
        ...current,
        ...items.filter((item) => !current.some((old) => old.id === item.id)),
      ]
      if (combined.length > MAX_ATTACHMENTS) {
        toast.error(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`)
        return current
      }
      return combined
    })
  async function importAttachments(load: () => Promise<Attachment[]>) {
    if (busy.current) return
    busy.current = true
    setBusy(true)
    try {
      add(await load())
    } catch (error: any) {
      toast.error(error.message || '添加文件失败')
    } finally {
      busy.current = false
      setBusy(false)
    }
  }
  return {
    attachments,
    attachmentsBusy,
    setAttachments,
    removeAttachment: (id: string) =>
      setAttachments((items) => items.filter((item) => item.id !== id)),
    chooseAttachments: () => importAttachments(api.chooseAttachments),
    pasteImages: (files: File[]) =>
      importAttachments(async () => {
        if (files.length + attachments.length > MAX_ATTACHMENTS)
          throw new Error(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`)
        if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES))
          throw new Error('每个附件不能超过 20 MB')
        return Promise.all(
          files.map(async (file) =>
            api.pasteAttachment(
              file.name || '粘贴图片.png',
              new Uint8Array(await file.arrayBuffer()),
            ),
          ),
        )
      }),
    showComposerMenu: () =>
      importAttachments(async () => {
        const item = await api.composerMenu()
        return item ? [item] : []
      }),
  }
}
