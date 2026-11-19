import { contextBridge, ipcRenderer } from 'electron'
const invoke = (name: string, ...args: any[]) => ipcRenderer.invoke(name, ...args)
contextBridge.exposeInMainWorld('travel', {
  onLocationRequest: (fn: (request: unknown) => void) => {
    const listener = (_event: unknown, request: unknown) => fn(request)
    ipcRenderer.on('location:request', listener)
    return () => ipcRenderer.removeListener('location:request', listener)
  },
  locationResponse: (id: string, response: unknown) => invoke('location:response', id, response),
  chooseAttachments: () => invoke('attachments:choose'),
  pasteAttachment: (name: string, bytes: Uint8Array) => invoke('attachments:paste', name, bytes),
  composerMenu: () => invoke('composer:menu'),
  startDictation: (id: string) => invoke('dictation:start', id),
  dictationReady: (id: string) => invoke('dictation:ready', id),
  cancelDictation: (id: string) => invoke('dictation:cancel', id),
  transcribeDictation: (id: string, audio: Uint8Array) => invoke('dictation:transcribe', id, audio),
  attachmentImage: (id: string) => invoke('attachments:image', id),
  models: () => invoke('models'),
  account: () => invoke('account'),
  login: (username: string, password: string) => invoke('account:login', username, password),
  logout: () => invoke('account:logout'),
  approve: (id: string, allow: boolean) => invoke('approve', id, allow),
  cancel: (id: string) => invoke('cancel', id),
  addWorkspace: () => invoke('workspace:add'),
  removeWorkspace: (id: string) => invoke('workspace:remove', id),
  openWorkspace: (sessionId: string) => invoke('workspace:open', sessionId),
  createSession: (workspaceId: string) => invoke('session:create', workspaceId),
  renameSession: (id: string, title: string) => invoke('session:rename', id, title),
  deleteSession: (id: string) => invoke('session:delete', id),
  saveHotelBudget: (id: string, lookupId: string, candidateId: string, amount: number | null) =>
    invoke('hotel-budget:save', id, lookupId, candidateId, amount),
  removeHotelBudget: (id: string, entryId: string) => invoke('hotel-budget:remove', id, entryId),
  mapConfig: () => invoke('map:config'),
  onDesktopAction: (fn: (action: string) => void) => {
    const listener = (value: unknown, action: string) => fn(action)
    ipcRenderer.on('desktop:action', listener)
    return () => ipcRenderer.removeListener('desktop:action', listener)
  },
  onEvent: (fn: any) => {
    const listener = (value: unknown, event: any) => fn(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onWindowState: (fn: (maximized: boolean) => void) => {
    const listener = (value: unknown, maximized: boolean) => fn(maximized)
    ipcRenderer.on('window:state', listener)
    return () => ipcRenderer.removeListener('window:state', listener)
  },
  openExternal: (url: string) => invoke('external', url),
  openMenu: (menu: string) => invoke('window:menu', menu),
  run: (
    id: string,
    text: string,
    editMessageId?: string,
    attachmentIds?: string[],
    clarificationReplyTo?: string,
  ) => invoke('run', id, text, editMessageId, attachmentIds, clarificationReplyTo),
  saveSettings: (value: any) => invoke('settings:save', value),
  sessions: () => invoke('sessions'),
  settings: () => invoke('settings'),
  panelWidth: (panel: string, width?: number) => invoke('panel:width', panel, width),
  mcpServers: () => invoke('mcp:list'),
  saveMcpServers: (value: any) => invoke('mcp:save', value),
  testMcpServer: (value: any) => invoke('mcp:test', value),
  staticMap: (points: string[]) => invoke('map:static', points),
  validate: (key?: string) => invoke('validate', key),
  windowControl: (action: string) => invoke('window:control', action),
  windowState: () => invoke('window:state'),
})
