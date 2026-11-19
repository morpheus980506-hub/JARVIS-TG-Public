import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { desktopName } from '../../../app-name'

export function TitleBar({
  sidebarOpen,
  sidebarUnavailable,
  toggleSidebar,
}: {
  sidebarOpen: boolean
  sidebarUnavailable?: boolean
  toggleSidebar: () => void
}) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const unsubscribe = api.onWindowState(setMaximized)
    void api.windowState().then(setMaximized)
    return unsubscribe
  }, [])
  return (
    <div className="bg-shell fixed inset-x-0 top-0 z-20 flex h-10 items-center justify-between select-none [-webkit-app-region:drag]">
      <nav
        className="flex h-full items-center gap-1 [-webkit-app-region:no-drag]"
        aria-label="应用菜单"
      >
        <div className="flex h-10 w-12 items-center justify-center">
          <Button
            variant="ghost"
            size="window-menu"
            title="切换侧栏"
            aria-label="切换聊天侧栏"
            aria-expanded={sidebarOpen}
            aria-controls={sidebarOpen ? 'chat-sidebar' : undefined}
            disabled={sidebarUnavailable}
            onClick={toggleSidebar}
          >
            <PanelLeft data-icon="inline-start" />
          </Button>
        </div>
        {(
          [
            ['file', '文件'],
            ['edit', '编辑'],
            ['view', '视图'],
            ['help', '帮助'],
          ] as const
        ).map(([key, label]) => (
          <Button
            variant="ghost"
            size="window-menu"
            aria-haspopup="menu"
            key={key}
            onClick={() => api.openMenu(key)}
          >
            {label}
          </Button>
        ))}
      </nav>
      <span className="text-muted-foreground pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-medium">
        {desktopName}
      </span>
      <div className="flex h-full [-webkit-app-region:no-drag]">
        <Button
          variant="ghost"
          size="window-control"
          aria-label="最小化"
          title="最小化"
          onClick={() => api.windowControl('minimize')}
        >
          <Minus data-icon="inline-start" />
        </Button>
        <Button
          variant="ghost"
          size="window-control"
          iconSize="sm"
          aria-label={maximized ? '还原窗口' : '最大化'}
          title={maximized ? '还原窗口' : '最大化'}
          onClick={() => api.windowControl('maximize')}
        >
          {maximized ? <Copy data-icon="inline-start" /> : <Square data-icon="inline-start" />}
        </Button>
        <Button
          variant="ghost"
          size="window-control"
          className="[--accent-foreground:var(--background)] [--accent:var(--destructive)]"
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={() => api.windowControl('close')}
        >
          <X data-icon="inline-start" />
        </Button>
      </div>
    </div>
  )
}
