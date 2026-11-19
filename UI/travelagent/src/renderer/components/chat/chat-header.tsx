import { Folder, Map } from 'lucide-react'
import { toast } from 'sonner'
import { ContextIndicator } from '@/components/chat/context-indicator'
import { TokenUsageIndicator } from '@/components/chat/token-usage-indicator'
import { Button } from '@/components/ui/button'
import type { TravelAppState } from '@/hooks/use-travel-app'
import { api } from '@/lib/api'
export function ChatHeader({
  panel,
  setPanel,
  selected,
  cfg,
  modelCatalog,
  togglePanel,
}: Pick<TravelAppState, 'panel' | 'setPanel' | 'togglePanel' | 'cfg' | 'modelCatalog'> & {
  selected: NonNullable<TravelAppState['selected']>
}) {
  const latestUsage = selected.messages.findLast((message) => message.contextUsage)?.contextUsage
  const model = cfg?.profile.model
  const usage = latestUsage?.model === model ? latestUsage : undefined
  const limit = modelCatalog.models.find((item) => item.id === model)?.contextWindow
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="在资源管理器中打开工作区"
          title="打开工作区"
          onClick={() =>
            void api.openWorkspace(selected.id).then(
              (error) => {
                if (error) toast.error('无法打开工作区', { description: error })
              },
              () => toast.error('无法打开工作区'),
            )
          }
        >
          <Folder />
        </Button>
        <h1 id="chat-title" className="truncate" title={selected.title}>
          {selected.title || '新对话'}
        </h1>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        {cfg && (
          <>
            <TokenUsageIndicator usage={usage} />
            <ContextIndicator usage={usage} limit={limit ?? usage?.contextWindow} />
          </>
        )}
        <Button
          variant={panel ? 'secondary' : 'ghost'}
          size="sm"
          aria-expanded={Boolean(panel)}
          aria-controls={panel ? 'travel-workbench' : undefined}
          onClick={() => (panel ? togglePanel(panel) : setPanel('地图'))}
        >
          <Map data-icon="inline-start" />
          旅行工作台
        </Button>
      </div>
    </header>
  )
}
