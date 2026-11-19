import type { BaseMessage } from '@langchain/core/messages'
import { nativeImage } from 'electron'
import { MAX_ATTACHMENTS } from '../attachments'
import type { Attachment } from '../shared'
import type { ModelMessage } from './agent-history-types'
import { toLangChainMessages } from './agent-messages'
import { AttachmentStore } from './attachment-store'
import { dataPath } from './data-directory'
import { redact } from './store'

export function attachmentStore() {
  return new AttachmentStore(dataPath('attachments'), (bytes) => {
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('无法读取该图片，请使用 PNG、JPEG、WebP 或 GIF')
    const { width, height } = image.getSize()
    if (width * height > 36_000_000) throw new Error('图片尺寸过大，请缩小后再添加')
    const resize = (max: number) => {
      const scale = Math.min(1, max / Math.max(width, height))
      return image.resize({
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
        quality: 'best',
      })
    }
    const resized = resize(1600)
    const thumbnail = resize(128)
    return { image: resized.toPNG(), preview: thumbnail.toDataURL() }
  })
}

export async function resolveAttachments(ids: string[]): Promise<Attachment[]> {
  if (ids.length > MAX_ATTACHMENTS) throw new Error(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`)
  return Promise.all([...new Set(ids)].map((id) => attachmentStore().get(id)))
}

export async function modelMessages(history: ModelMessage[]): Promise<BaseMessage[]> {
  const converted = toLangChainMessages(history)
  let offset = 0
  for (const message of history) {
    if (message.role === 'user' && message.attachments?.length) {
      // oxlint-disable-next-line no-await-in-loop -- Keep user content in transcript order.
      const contents = await Promise.all(
        message.attachments.map((item) => attachmentStore().modelContent(item.id)),
      )
      converted[offset].content = [
        { type: 'text', text: message.content || '请查看所附文件。' },
        ...contents
          .flat()
          .map((block) =>
            block.type === 'text' ? Object.assign(block, { text: redact(block.text) }) : block,
          ),
      ] as BaseMessage['content']
    }
    offset += message.role === 'tool' ? message.content.length : 1
  }
  return converted
}
