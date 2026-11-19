import crypto from 'node:crypto'
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { z } from 'zod'
import { desktopName } from '../app-name'
import { attachmentId, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../attachments'
import { beforeEditedMessage } from '../conversation'
import { DEEPSEEK_BASE_URL } from '../deepseek-config'
import { saveHotelBudgetEntry } from '../hotel-budget'
import { modelCatalogURL, parseModelCatalog } from '../model-catalog'
import { defaultWorkspaceId, type Session } from '../shared'
import { approve, cancel, isRunning, runAgent } from './agent'
import { attachmentStore, resolveAttachments } from './attachments'
import { composerMenu } from './context-menu'
import { registerDictation } from './dictation-ipc'
import { registerLocationBridge } from './location-browser'
import type { MapServerConfig } from './map-server'
import { mcpServers, saveMcpServers, testMcpServer } from './mcp'
import { rememberModelCatalog } from './model-context'
import { request } from './network'
import * as store from './store'
const idSchema = z.string().uuid()
const workspaceIdSchema = z.union([z.literal(defaultWorkspaceId), idSchema])
const sessionWorkspace = (id: string) =>
  store.session(idSchema.parse(id)).workspace ?? store.defaultWorkspace()
const profileSchema = z.object({
  reasoningEffort: z.string().min(1).max(64).optional(),
  baseURL: z.literal(DEEPSEEK_BASE_URL),
  headers: z.object({}),
  model: z.string().min(1),
  protocol: z.literal('messages'),
})
export function registerIpc(win: BrowserWindow, { proxy, frame: mapFrame }: MapServerConfig) {
  const handle = (name: string, fn: (...args: any[]) => any) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('不允许的调用来源')
      }
      return fn(...args)
    })
  registerLocationBridge(win, handle, registerDictation(win, handle))
  handle('window:state', () => win.isMaximized())
  handle('attachments:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '添加文件',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return []
    if (result.filePaths.length > MAX_ATTACHMENTS)
      throw new Error(`最多选择 ${MAX_ATTACHMENTS} 个文件`)
    return Promise.all(result.filePaths.map((file) => attachmentStore().importFile(file)))
  })
  handle('attachments:paste', (name: unknown, bytes: unknown) => {
    const data = z
      .instanceof(Uint8Array)
      .refine((item) => item.byteLength <= MAX_ATTACHMENT_BYTES)
      .parse(bytes)
    return attachmentStore().importBytes(z.string().min(1).max(255).parse(name), data, true)
  })
  handle('composer:menu', () => composerMenu(win))
  handle('attachments:image', (id: unknown) => attachmentStore().imageData(attachmentId.parse(id)))
  handle('window:menu', (value: unknown) => {
    const name = z.enum(['file', 'edit', 'view', 'help']).parse(value)
    const action = (actionName: string) => () => win.webContents.send('desktop:action', actionName)
    const templates: Record<string, Electron.MenuItemConstructorOptions[]> = {
      edit: [
        {
          role: 'undo',
          label: '撤销',
        },
        {
          role: 'redo',
          label: '重做',
        },
        {
          type: 'separator',
        },
        {
          role: 'cut',
          label: '剪切',
        },
        {
          role: 'copy',
          label: '复制',
        },
        {
          role: 'paste',
          label: '粘贴',
        },
        {
          role: 'selectAll',
          label: '全选',
        },
      ],
      file: [
        {
          label: '新对话',
          accelerator: 'CmdOrCtrl+N',
          click: action('new'),
        },
        {
          label: '管理工作区…',
          click: action('workspace'),
        },
        {
          type: 'separator',
        },
        {
          label: '设置…',
          click: action('settings'),
        },
        {
          role: 'close',
          label: '关闭窗口',
        },
      ],
      help: [
        {
          label: `关于 ${desktopName}`,
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: `关于 ${desktopName}`,
              message: desktopName,
              detail: `版本 ${app.getVersion()}\n你的本地旅行规划助手`,
            })
          },
        },
      ],
      view: [
        {
          role: 'resetZoom',
          label: '实际大小',
        },
        {
          role: 'zoomIn',
          label: '放大',
        },
        {
          role: 'zoomOut',
          label: '缩小',
        },
        {
          type: 'separator',
        },
        {
          role: 'togglefullscreen',
          label: '切换全屏',
        },
      ],
    }
    Menu.buildFromTemplate(templates[name]).popup({
      window: win,
      x: {
        edit: 102,
        file: 48,
        help: 210,
        view: 156,
      }[name],
      y: 40,
    })
  })
  handle('window:control', (value: unknown) => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(value)
    if (action === 'minimize') {
      win.minimize()
    } else if (action === 'close') {
      win.close()
    } else if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })
  handle('account', store.account)
  handle('account:login', (username: unknown, password: unknown) =>
    store.login(
      z.string().trim().min(1).max(64).parse(username),
      z.string().min(1).max(128).parse(password),
    ),
  )
  handle('account:logout', store.logout)
  handle('settings', store.settings)
  handle('mcp:list', () => mcpServers())
  handle('mcp:save', (value: unknown) => {
    const input = z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          transport: z.enum(['stdio', 'http', 'builtin']),
          enabled: z.boolean(),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          url: z.string().optional(),
          builtin: z.enum(['12306', 'didi', 'rollinggo-hotel', 'variflight']).optional(),
        }),
      )
      .parse(value)
    return saveMcpServers(input)
  })
  handle('mcp:test', (value: unknown) =>
    testMcpServer(
      z
        .object({
          id: z.string(),
          name: z.string(),
          transport: z.enum(['stdio', 'http', 'builtin']),
          enabled: z.boolean(),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          url: z.string().optional(),
          builtin: z.enum(['12306', 'didi', 'rollinggo-hotel', 'variflight']).optional(),
        })
        .parse(value),
    ),
  )
  handle('models', async () => {
    const { profile } = store.settings()
    const key = store.secret('deepseek')
    if (!key) throw new Error('请先配置模型密钥')
    const headers = { Authorization: `Bearer ${key}` }
    return rememberModelCatalog(
      profile,
      parseModelCatalog(
        await request(modelCatalogURL(profile), { headers }, AbortSignal.timeout(15000)),
      ),
    )
  })
  handle('settings:save', async (value) => {
    const input = z
      .object({
        profile: profileSchema.optional(),
        secrets: z.record(z.string(), z.string()).optional(),
        theme: z.enum(['system', 'light', 'dark']).optional(),
      })
      .parse(value)
    const settings = await store.saveSettings(input)
    if (input.theme !== undefined) nativeTheme.themeSource = settings.theme
    return settings
  })
  handle('panel:width', (panel: unknown, width?: unknown) => {
    const name = z.enum(['sidebar', 'workbench']).parse(panel)
    const key = `panelWidth:${name}`
    if (width === undefined) return store.get(key)
    const bounds = name === 'sidebar' ? { min: 200, max: 400 } : { min: 300, max: 900 }
    store.put(key, z.number().int().min(bounds.min).max(bounds.max).parse(width))
  })
  handle('validate', async (key?: string) => {
    const apiKey = key?.trim() || store.secret('deepseek')
    if (!apiKey) {
      throw new Error('请输入 DeepSeek API Key')
    }
    const options = {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
    const [models, balance] = await Promise.all([
      request('https://api.deepseek.com/models', options),
      request('https://api.deepseek.com/user/balance', options),
    ])
    return {
      available: balance.is_available,
      balance: balance.balance_infos,
      models: models.data.map((message: any) => message.id),
    }
  })
  handle('workspace:add', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    await store.addWorkspace(result.filePaths[0])
    return store.settings()
  })
  handle('workspace:remove', (id: unknown) => {
    store.removeWorkspace(workspaceIdSchema.parse(id))
    return store.settings()
  })
  handle('workspace:open', (sessionId: string) => shell.openPath(sessionWorkspace(sessionId).path))
  handle('sessions', () =>
    store.sessions().map(({ history: _history, ...session }) =>
      Object.assign(session, {
        history: [],
      }),
    ),
  )
  handle('session:create', (workspaceId?: string) => {
    const session: Session = {
      history: [],
      id: crypto.randomUUID(),
      workspace: store.workspaceById(workspaceIdSchema.optional().parse(workspaceId)),
      messages: [],
      title: '新对话',
      updatedAt: Date.now(),
    }
    store.saveSession(session)
    return session
  })
  handle('session:rename', (id: string, title: string) => {
    idSchema.parse(id)
    const value = store.session(id)
    value.title = z.string().trim().min(1).max(80).parse(title)
    value.titleManual = true
    store.saveSession(value)
  })
  handle('session:delete', (id: string) => {
    idSchema.parse(id)
    if (isRunning(id)) {
      throw new Error('请先停止生成，再删除会话')
    }
    cancel(id)
    store.deleteSession(id)
  })
  function saveBudget(session: Session) {
    store.saveSession(session)
    win.webContents.send('agent:event', {
      type: 'hotel-budget',
      sessionId: session.id,
      hotelBudget: session.hotelBudget,
    })
  }
  handle(
    'hotel-budget:save',
    (id: unknown, lookupId: unknown, candidateId: unknown, amount: unknown) => {
      const session = store.session(idSchema.parse(id))
      session.hotelBudget = saveHotelBudgetEntry(
        session,
        idSchema.parse(lookupId),
        idSchema.parse(candidateId),
        z.number().min(0).max(10_000_000).nullable().parse(amount),
      )
      saveBudget(session)
    },
  )
  handle('hotel-budget:remove', (id: unknown, entryId: unknown) => {
    const session = store.session(idSchema.parse(id))
    const key = idSchema.parse(entryId)
    session.hotelBudget = (session.hotelBudget ?? []).filter((entry) => entry.id !== key)
    saveBudget(session)
  })
  handle(
    'run',
    async (
      id: string,
      text: string,
      editMessageId?: string,
      attachmentIds: string[] = [],
      clarificationReplyTo?: string,
    ) => {
      idSchema.parse(id)
      z.string().max(50_000).parse(text)
      if (editMessageId !== undefined) idSchema.parse(editMessageId)
      if (clarificationReplyTo !== undefined) idSchema.parse(clarificationReplyTo)
      if (isRunning(id)) throw new Error('请先停止生成，再修改消息')
      if (editMessageId) beforeEditedMessage(store.session(id), editMessageId)
      const ids = editMessageId
        ? store
            .session(id)
            .messages.find((message) => message.id === editMessageId)
            ?.attachments?.map((item) => item.id) || []
        : z.array(attachmentId).max(MAX_ATTACHMENTS).parse(attachmentIds)
      const attachments = await resolveAttachments(ids)
      if (!text.trim() && !attachments.length) throw new Error('请输入消息或添加文件')
      if (isRunning(id)) throw new Error('该会话仍在执行')
      if (clarificationReplyTo) {
        const latest = store.session(id).messages.at(-1)
        if (
          editMessageId ||
          attachments.length ||
          latest?.id !== clarificationReplyTo ||
          !latest.clarification
        ) {
          throw new Error('此澄清问题已失效')
        }
      }
      void runAgent(
        id,
        text,
        (event) => {
          if (!win.isDestroyed()) {
            if (event.type === 'done') {
              const { history: _history, ...completed } = store.session(id)
              win.webContents.send('agent:event', {
                ...event,
                completedSession: { ...completed, history: [] },
              })
            } else {
              win.webContents.send('agent:event', event)
            }
          }
        },
        editMessageId,
        attachments,
        clarificationReplyTo,
      ).catch((error) =>
        win.webContents.send('agent:event', {
          sessionId: id,
          type: 'error',
          text: store.redact(error.message),
        }),
      )
    },
  )
  handle('cancel', (id: string) => cancel(idSchema.parse(id)))
  handle('approve', (id: string, allow: boolean) =>
    approve(idSchema.parse(id), z.boolean().parse(allow)),
  )
  handle('external', (url: string) => {
    const value = new URL(url)
    if (!['https:', 'http:'].includes(value.protocol)) {
      throw new Error('不支持的链接')
    }
    return shell.openExternal(value.href)
  })
  handle('map:static', async (locations: string[]) => {
    const points = z
      .array(z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/))
      .max(30)
      .parse(locations)
    const key = store.secret('amap')
    if (!key) {
      throw new Error('请配置高德 Web 服务 Key')
    }
    const params = new URLSearchParams({
      key,
      location: points[0] || '116.3974,39.9092',
      size: '600*450',
      zoom: points.length > 1 ? '11' : '12',
    })
    if (points.length) {
      params.set('markers', `mid,0x5b8c6f:${points.join(';')}`)
    }
    if (points.length > 1) {
      params.delete('location')
      params.delete('zoom')
    }
    const response = await fetch(`https://restapi.amap.com/v3/staticmap?${params}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      throw new Error('地图预览不可用，请配置高德 JS Key')
    }
    return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`
  })
  handle('map:config', () => ({
    key: store.secret('amapJs'),
    proxy,
    frame: mapFrame,
  }))
}
