import { FolderPlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { defaultWorkspaceId, type Settings } from '../../../shared'

export function WorkspaceSettings({
  cfg,
  update,
}: {
  cfg: Settings
  update: (config: Settings) => void
}) {
  const [busy, setBusy] = useState(false)
  async function changeWorkspace(action: () => Promise<Settings | null>) {
    setBusy(true)
    try {
      const config = await action()
      if (config) update(config)
    } catch (error) {
      toast.error('无法更新工作区', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul aria-label="工作区列表" className="divide-border divide-y rounded-lg border">
        {cfg.workspaces.map(({ id, name, path }) => (
          <li key={id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-all">{name}</span>
                {id === defaultWorkspaceId && <Badge variant="secondary">默认</Badge>}
              </div>
              <div className="text-muted-foreground mt-1 text-xs break-all select-text">{path}</div>
            </div>
            {id !== defaultWorkspaceId && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`从列表移除工作区 ${name}`}
                disabled={busy}
                onClick={() => void changeWorkspace(() => api.removeWorkspace(id))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        className="w-fit"
        variant="outline"
        disabled={busy}
        onClick={() => void changeWorkspace(api.addWorkspace)}
      >
        <FolderPlus data-icon="inline-start" />
        添加工作区
      </Button>
    </>
  )
}
