import { clipboard, Menu, type BrowserWindow } from 'electron'
import type { Attachment } from '../shared'
import { attachmentStore } from './attachments'

export function registerSelectionMenu(win: BrowserWindow) {
  const menu = Menu.buildFromTemplate([{ label: '复制', role: 'copy' }])
  const contents = win.webContents
  contents.on('context-menu', (_event, params) => {
    if (!params.selectionText) return
    menu.popup({
      window: win,
      frame: params.frame ?? undefined,
      sourceType: params.menuSourceType,
    })
  })
}

export async function composerMenu(win: BrowserWindow): Promise<Attachment | null> {
  const hasImage = await clipboard.has('image/png')
  const hasText = await clipboard.has('text/plain')
  return new Promise((resolve, reject) => {
    let action: Promise<Attachment | null> = Promise.resolve(null)
    const menu = Menu.buildFromTemplate([
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      {
        label: '粘贴',
        accelerator: 'CommandOrControl+V',
        enabled: hasImage || hasText,
        click: () => {
          action = (async () => {
            const items = await clipboard.read()
            const image = items.find((item) => item.types.includes('image/png'))
            if (image) {
              const blob = await image.getType('image/png')
              return attachmentStore().importBytes(
                `粘贴图片-${Date.now()}.png`,
                new Uint8Array(await blob.arrayBuffer()),
                true,
              )
            }
            win.webContents.paste()
            return null
          })()
        },
      },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' },
    ])
    menu.popup({
      window: win,
      callback: () => {
        void action.then(resolve, reject)
      },
    })
  })
}
