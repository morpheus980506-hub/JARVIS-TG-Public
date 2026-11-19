import { useEffect, useState } from 'react'
import { AccountDialog } from '@/components/account-dialog'
import { ChatConversation } from '@/components/chat/chat-conversation'
import { ChatHeader } from '@/components/chat/chat-header'
import { Welcome } from '@/components/chat/welcome'
import { ClarificationPanel } from '@/components/composer/clarification-panel'
import { Composer } from '@/components/composer/composer'
import { ActivityRail } from '@/components/layout/activity-rail'
import { TitleBar } from '@/components/layout/title-bar'
import { SettingsModal } from '@/components/settings/settings-dialog'
import { ChatSidebar } from '@/components/sidebar/chat-sidebar'
import { RenameDialog } from '@/components/sidebar/rename-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Toaster } from '@/components/ui/sonner'
import { WorkPanel } from '@/components/workbench/work-panel'
import { useTravelApp } from '@/hooks/use-travel-app'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
export function App() {
  const state = useTravelApp()
  const {
    cfg,
    setCfg,
    account,
    setAccount,
    accountOpen,
    setAccountOpen,
    sidebar,
    setSidebar,
    sidebarWidth,
    resizeSidebar,
    sidebarPanelRef,
    modal,
    panel,
    setPanel,
    panelWidth,
    panelFullView,
    setPanelFullView,
    workbenchPanelRef,
    resizePanel,
    selected,
  } = state
  const renameSession = state.sessions.find((session) => session.id === state.renaming)
  const pendingQuestion = state.pendingClarification
  const [animateSidebar, setAnimateSidebar] = useState(false)
  useEffect(() => {
    if (!animateSidebar) return
    const frame = requestAnimationFrame(() => {
      if (sidebar) sidebarPanelRef.current?.expand()
      else sidebarPanelRef.current?.collapse()
    })
    const timer = window.setTimeout(() => setAnimateSidebar(false), 240)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [animateSidebar, sidebar, sidebarPanelRef])
  return (
    <div className="bg-shell flex h-dvh pt-10 pr-1.5 pb-1.5 pl-12 text-sm">
      <TitleBar
        sidebarOpen={sidebar && !panelFullView}
        sidebarUnavailable={panelFullView}
        toggleSidebar={() => {
          setAnimateSidebar(true)
          setSidebar((value) => !value)
        }}
      />
      <ActivityRail {...state} />
      <div className="bg-background relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border">
        <ResizablePanelGroup
          orientation="horizontal"
          data-sidebar-animating={animateSidebar}
          className="motion-safe:data-[sidebar-animating=true]:[&>[data-panel]]:transition-[flex-grow] motion-safe:data-[sidebar-animating=true]:[&>[data-panel]]:duration-200 motion-safe:data-[sidebar-animating=true]:[&>[data-panel]]:ease-out"
          onLayoutChanged={(_, meta) => {
            const sidebarHandle = sidebarPanelRef.current
            if (!meta.isUserInteraction || !sidebarHandle) return
            const visible = !sidebarHandle.isCollapsed()
            setSidebar(visible)
            if (visible) resizeSidebar(sidebarHandle.getSize().inPixels)
          }}
        >
          <ResizablePanel
            id="sidebar"
            className="size-full min-h-0 min-w-0 overflow-hidden"
            panelRef={sidebarPanelRef}
            defaultSize={sidebarWidth}
            groupResizeBehavior="preserve-pixel-size"
            collapsible
            collapsedSize={0}
            minSize={200}
            maxSize={400}
            inert={!sidebar || panelFullView}
            aria-hidden={!sidebar || panelFullView}
          >
            <ChatSidebar {...state} />
          </ResizablePanel>
          <ResizableHandle
            variant="sidebar"
            aria-label="调整聊天侧栏宽度"
            disabled={!sidebar || panelFullView}
            inert={!sidebar || panelFullView}
            aria-hidden={!sidebar || panelFullView}
            data-visible={sidebar}
            className="data-[visible=false]:w-0 data-[visible=false]:flex-[0_0_0px] data-[visible=false]:opacity-0"
          />
          <ResizablePanel
            id="workspace"
            className="size-full min-h-0 min-w-0 overflow-hidden"
            minSize={panel ? 708 : 400}
          >
            <ResizablePanelGroup
              key={panelFullView ? 'full-view' : 'split-view'}
              orientation="horizontal"
              className={cn(
                'min-h-0 min-w-0 flex-1 overflow-hidden',
                panelFullView && 'bg-background absolute inset-0 z-5',
              )}
              onLayoutChanged={(_, meta) => {
                if (meta.isUserInteraction && !panelFullView && panel) {
                  resizePanel(workbenchPanelRef.current?.getSize().inPixels ?? panelWidth)
                }
              }}
            >
              {!panelFullView && (
                <ResizablePanel
                  id="chat"
                  className="size-full min-h-0 min-w-0 overflow-hidden"
                  minSize={400}
                  defaultSize={panel ? undefined : '100%'}
                >
                  <main
                    aria-labelledby="chat-title"
                    className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  >
                    {selected?.messages.length ? (
                      <>
                        <ChatHeader {...state} selected={selected} />
                        <ChatConversation {...state} selected={selected} />
                        {pendingQuestion && (
                          <ClarificationPanel
                            key={pendingQuestion.id}
                            clarification={pendingQuestion.clarification}
                            hidden={state.clarificationHidden}
                            onClose={state.closeClarification}
                            onAnswer={(answer) =>
                              void state.send(answer, undefined, pendingQuestion.id)
                            }
                          />
                        )}
                      </>
                    ) : (
                      <Welcome />
                    )}
                    {(!pendingQuestion || state.clarificationHidden) && (
                      <Composer
                        key={state.current}
                        {...state}
                        showWorkspacePicker={!selected?.messages.length}
                      />
                    )}
                    <Toaster theme={cfg?.theme || 'system'} closeButton />
                  </main>
                </ResizablePanel>
              )}
              {panel && !panelFullView && (
                <ResizableHandle variant="workspace" aria-label="调整旅行工作台宽度" />
              )}
              {panel && (
                <ResizablePanel
                  id="workbench"
                  className="size-full min-h-0 min-w-0 overflow-hidden"
                  panelRef={workbenchPanelRef}
                  defaultSize={panelFullView ? '100%' : panelWidth}
                  minSize={panelFullView ? 0 : 300}
                  maxSize={panelFullView ? undefined : 900}
                >
                  <WorkPanel
                    tab={panel}
                    setTab={setPanel}
                    trip={selected?.trip}
                    hotelBudget={selected?.hotelBudget}
                    sessionId={selected?.id}
                    settings={cfg}
                    fullView={panelFullView}
                    setFullView={setPanelFullView}
                  />
                </ResizablePanel>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
        {renameSession && (
          <RenameDialog
            key={renameSession.id}
            session={renameSession}
            onClose={() => state.setRenaming(undefined)}
            onSaved={state.load}
          />
        )}
        <AccountDialog
          credentials={cfg?.demoAccount}
          open={accountOpen}
          onOpenChange={setAccountOpen}
          account={account}
          update={async (value) => {
            setAccount(value)
            setCfg(await api.settings())
          }}
        />
        {cfg && modal && (
          <SettingsModal
            key={state.settingsStart}
            open={modal}
            close={state.closeSettings}
            cfg={cfg}
            update={setCfg}
            initialTab={state.settingsStart}
          />
        )}
      </div>
    </div>
  )
}
