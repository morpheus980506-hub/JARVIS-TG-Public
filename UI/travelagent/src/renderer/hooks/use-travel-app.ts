import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { toast } from 'sonner'
import { applyAgentEvent } from '@/lib/session-events'
import { beforeEditedMessage } from '../../conversation'
import {
  defaultWorkspaceId,
  type AgentEvent,
  type LocalAccount,
  type Session,
  type Settings,
} from '../../shared'
import { api } from '../lib/api'
import { useComposerAttachments } from './use-composer-attachments'
import { useLocationBridge } from './use-location-bridge'
import { useModelCatalog } from './use-model-catalog'
import { usePanelWidth } from './use-panel-width'

export function useTravelApp() {
  useLocationBridge()
  const composerAttachments = useComposerAttachments()
  const [cfg, setCfg] = useState<Settings>()
  const modelCatalog = useModelCatalog(Boolean(cfg?.configured.deepseek || cfg?.configured.model))
  const [account, setAccount] = useState<LocalAccount | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [current, setCurrent] = useState<string>()
  const [chosenWorkspaceId, setChosenWorkspaceId] = useState(defaultWorkspaceId)
  const [sidebar, setSidebar] = useState(true)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const [sidebarWidth, resizeSidebar] = usePanelWidth('sidebar', 256, 200, 400, sidebarPanelRef)
  const [renaming, setRenaming] = useState<string>()
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ sessionId: string; messageId: string; text: string }>()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState<string>()
  const [modal, setModal] = useState(false)
  const [settingsStart, setSettingsStart] = useState<'外观' | '工作区'>('外观')
  const [panel, setPanel] = useState('')
  const [panelFullView, setPanelFullView] = useState(false)
  const workbenchPanelRef = useRef<PanelImperativeHandle>(null)
  const [panelWidth, resizePanel] = usePanelWidth('workbench', 400, 300, 900, workbenchPanelRef)
  const [error, setError] = useState('')
  const [approvals, setApprovals] = useState<Record<string, NonNullable<AgentEvent['approval']>>>(
    {},
  )
  const textArea = useRef<HTMLTextAreaElement>(null)
  const sendLock = useRef(false)
  const selected = sessions.find((session) => session.id === current)
  const draftWorkspace =
    cfg?.workspaces.find((item) => item.id === chosenWorkspaceId) ?? cfg?.workspaces[0]
  const workspaceId = draftWorkspace?.id ?? defaultWorkspaceId
  const openWorkspaceSettings = useCallback(() => {
    setSettingsStart('工作区')
    setModal(true)
  }, [])
  function closeSettings() {
    setModal(false)
    setSettingsStart('外观')
  }
  const [closedClarifications, setClosedClarifications] = useState<Set<string>>(() => new Set())
  const latestMessage = selected?.messages.at(-1)
  const pendingClarification =
    !running && !editing && latestMessage?.clarification?.questions.length
      ? { id: latestMessage.id, clarification: latestMessage.clarification }
      : undefined
  const clarificationHidden = pendingClarification
    ? closedClarifications.has(pendingClarification.id)
    : false
  function closeClarification() {
    if (!pendingClarification) return
    setClosedClarifications((previous) => new Set(previous).add(pendingClarification.id))
    requestAnimationFrame(() => textArea.current?.focus())
  }
  function reopenClarification() {
    if (!pendingClarification) return
    setClosedClarifications((previous) => {
      const next = new Set(previous)
      next.delete(pendingClarification.id)
      return next
    })
  }
  const newChat = useCallback(() => {
    setCurrent(undefined)
    setChosenWorkspaceId(defaultWorkspaceId)
    setPanel('')
    setPanelFullView(false)
  }, [])
  function togglePanel(tab: string) {
    if (panel === tab) {
      setPanel('')
      setPanelFullView(false)
    } else {
      setPanel(tab)
    }
  }
  useEffect(
    () =>
      api.onDesktopAction((action) => {
        if (action === 'new') {
          newChat()
        }
        if (action === 'settings') {
          setModal(true)
        }
        if (action === 'workspace') openWorkspaceSettings()
      }),
    [newChat, openWorkspaceSettings],
  )
  const load = useCallback(async () => {
    setSessions(await api.sessions())
  }, [])
  useEffect(() => {
    api.settings().then((config) => {
      setCfg(config)
      if (!config.configured.model && !config.configured.deepseek) {
        setModal(true)
      }
    })
    void api.account().then(setAccount)
    void api.sessions().then(setSessions)
    return api.onEvent((event) => {
      if (event.type === 'done') {
        const completed = event.completedSession
        if (completed) {
          setSessions((old) =>
            [completed, ...old.filter((item) => item.id !== completed.id)].toSorted(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
          )
        } else {
          void load()
        }
        setRunning(undefined)
        setApprovals((left) =>
          Object.fromEntries(
            Object.entries(left).filter(
              ([, value]) => (value as any).sessionId !== event.sessionId,
            ),
          ),
        )
        return
      }
      if (event.type === 'approval' && event.approval) {
        const left = {
          ...event.approval,
          sessionId: event.sessionId,
        }
        setApprovals((old) => ({
          ...old,
          [left.id]: left,
        }))
      }
      setSessions((old) => applyAgentEvent(old, event))
    })
  }, [load])
  useEffect(() => {
    const theme = cfg?.theme || 'system'
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      )
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [cfg?.theme])
  useEffect(() => {
    if (error) {
      toast.error(error)
    }
  }, [error])
  async function send(text = input, editMessageId?: string, clarificationMessageId?: string) {
    if (clarificationMessageId) {
      const latest = selected?.messages.at(-1)
      if (latest?.id !== clarificationMessageId || !latest.clarification || editing) return
    }
    const attachments = clarificationMessageId
      ? []
      : editMessageId
        ? selected?.messages.find((item) => item.id === editMessageId)?.attachments || []
        : composerAttachments.attachments
    if (
      (!text.trim() && !attachments.length) ||
      running ||
      sendLock.current ||
      (!clarificationMessageId && composerAttachments.attachmentsBusy)
    ) {
      return
    }
    if (!cfg?.configured.model && !cfg?.configured.deepseek) {
      setModal(true)
      return
    }
    sendLock.current = true
    let sendId = selected?.id
    try {
      setError('')
      let session = selected
      if (!session || (!session.messages.length && session.workspace?.id !== workspaceId)) {
        session = await api.createSession(workspaceId)
        setSessions((old) => [session!, ...old])
        setCurrent(session.id)
      }
      const { id } = session
      sendId = id
      setEditing(undefined)
      if (!editMessageId && !clarificationMessageId) {
        setInput('')
        composerAttachments.setAttachments([])
      }
      setRunning(id)
      setSessions((old) =>
        old.map((item) =>
          item.id === id
            ? {
                ...(editMessageId ? beforeEditedMessage(item, editMessageId) : item),
                messages: [
                  ...(editMessageId
                    ? beforeEditedMessage(item, editMessageId).messages
                    : item.messages),
                  {
                    id: crypto.randomUUID(),
                    role: 'user',
                    content: text,
                    attachments,
                    clarificationReplyTo: clarificationMessageId,
                  },
                  {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: '',
                    traces: [],
                    processNotes: [],
                    processSteps: [],
                    startedAt: Date.now(),
                  },
                ],
                title:
                  !item.titleManual && item.title === '新对话'
                    ? (text || attachments[0]?.name || '新对话').slice(0, 26)
                    : item.title,
              }
            : item,
        ),
      )
      await api.run(
        id,
        text,
        editMessageId,
        attachments.map((item) => item.id),
        clarificationMessageId,
      )
    } catch (error_: any) {
      setError(error_.message)
      setRunning(undefined)
      void load()
      if (editMessageId && sendId) setEditing({ sessionId: sendId, messageId: editMessageId, text })
      else if (!clarificationMessageId) {
        setInput(text)
        composerAttachments.setAttachments(attachments)
      }
    } finally {
      sendLock.current = false
    }
  }
  return {
    ...composerAttachments,
    modelCatalog,
    pendingClarification,
    clarificationHidden,
    closeClarification,
    reopenClarification,
    cfg,
    workspaceId,
    setChosenWorkspaceId,
    settingsStart,
    openWorkspaceSettings,
    closeSettings,
    setCfg,
    account,
    setAccount,
    accountOpen,
    setAccountOpen,
    sessions,
    current,
    setCurrent,
    sidebar,
    setSidebar,
    sidebarWidth,
    resizeSidebar,
    sidebarPanelRef,
    renaming,
    setRenaming,
    filter,
    setFilter,
    editing,
    setEditing,
    input,
    setInput,
    running,
    modal,
    setModal,
    panel,
    setPanel,
    panelWidth,
    panelFullView,
    setPanelFullView,
    workbenchPanelRef,
    resizePanel,
    approvals,
    setApprovals,
    textArea,
    selected,
    newChat,
    togglePanel,
    load,
    send,
  }
}
export type TravelAppState = ReturnType<typeof useTravelApp>
