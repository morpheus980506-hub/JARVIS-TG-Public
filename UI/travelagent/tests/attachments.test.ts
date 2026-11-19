import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { imageMime, MAX_ATTACHMENT_BYTES } from '../src/attachments'
import { contextSize } from '../src/backend/agent-context'
import { AttachmentStore } from '../src/backend/attachment-store'

const png = Buffer.from('89504e470d0a1a0a', 'hex')
async function fixture(run: (store: AttachmentStore, root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'travelagent-attachments-'))
  try {
    await run(
      new AttachmentStore(root, () => ({
        image: png,
        preview: 'data:image/png;base64,' + png.toString('base64'),
      })),
      root,
    )
  } finally {
    assert.ok(path.basename(root).startsWith('travelagent-attachments-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('image attachments persist original bytes and previews, and use real image blocks for the model', () =>
  fixture(async (store) => {
    const item = await store.importBytes('screenshot.png', png, true)
    assert.equal(item.mimeType, 'image/png')
    assert.equal(item.size, png.length)
    assert.deepEqual(await store.get(item.id), item)
    assert.equal(await store.imageData(item.id), 'data:image/png;base64,' + png.toString('base64'))
    const content = await store.modelContent(item.id)
    assert.match(content[0].text, /不可信数据/)
    assert.equal(content[1].type, 'image')
    assert.equal(content[1].source.media_type, 'image/png')
    assert.equal(content[1].source.data, png.toString('base64'))
  }))

test('text files are readable with bounded content and binary files are never presented as parsed text', () =>
  fixture(async (store, root) => {
    const file = path.join(root, 'plan.txt')
    await fs.writeFile(file, '杭州旅行计划\n' + '行程'.repeat(10000))
    const text = await store.importFile(file)
    const content = await store.modelContent(text.id)
    assert.match(content[0].text, /plan.txt/)
    assert.match(content[1].text, /杭州旅行计划/)
    assert.match(content[1].text, /已截断/)
    assert.ok(content[1].text.length < 12100)
    const binary = await store.importBytes('trip.pdf', Buffer.from([0, 255, 1]))
    await assert.rejects(store.imageData(binary.id), /不是图片/)
    assert.match((await store.modelContent(binary.id))[1].text, /正文尚未解析/)
  }))

test('attachment ingestion rejects empty, oversize, forged images and path traversal ids', () =>
  fixture(async (store) => {
    await assert.rejects(store.importBytes('empty', new Uint8Array()), /不能为空/)
    await assert.rejects(
      store.importBytes('large', new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
      /20 MB/,
    )
    await assert.rejects(store.importBytes('fake.png', Buffer.from('text'), true), /不是支持的图片/)
    await assert.rejects(store.get('../outside'))
    await assert.rejects(store.imageData('../outside'))
    assert.equal(imageMime(Buffer.from('not an image')), undefined)
    assert.equal(imageMime(Buffer.from('ffd8ffe0', 'hex')), 'image/jpeg')
  }))

test('context budgeting excludes thumbnail payloads and reserves image input capacity', () => {
  const base = [
    {
      role: 'user',
      content: '看图',
      attachments: [{ id: 'a', name: 'image', mimeType: 'image/png', size: 100, preview: 'small' }],
    },
  ]
  const largePreview = structuredClone(base)
  largePreview[0].attachments[0].preview = 'x'.repeat(100000)
  assert.equal(contextSize(base), contextSize(largePreview))
  assert.ok(contextSize(base) >= 8192)
})
