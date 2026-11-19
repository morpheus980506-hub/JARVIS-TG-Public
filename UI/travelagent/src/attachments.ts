import { z } from 'zod'
export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const attachmentId = z.string().uuid()
export const attachmentSchema = z.object({
  id: attachmentId,
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  preview: z.string().max(200000).startsWith('data:image/png;base64,').optional(),
})
export function imageMime(bytes: Uint8Array) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const header = String.fromCharCode(...bytes.slice(0, 12))
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
  return undefined
}
