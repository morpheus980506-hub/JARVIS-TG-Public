import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { useModelCatalog } from '@/hooks/use-model-catalog'
import { api } from '@/lib/api'
import { modelEfforts, modelEffort, formatContext } from '../../../model-catalog'
import { effortLabel } from '../../../reasoning'
import type { ModelInfo, Settings } from '../../../shared'

export function ModelPicker({
  cfg,
  catalog,
  disabled,
  update,
}: {
  cfg: Settings
  catalog: ReturnType<typeof useModelCatalog>
  disabled: boolean
  update: (value: Settings) => void
}) {
  const { models, failed, refresh } = catalog
  const [saving, setSaving] = useState(false)
  const selectedModel = models.find((model) => model.id === cfg.profile.model)
  const choices = modelEfforts(selectedModel)
  const selectedEffort = modelEffort(selectedModel, cfg.profile.reasoningEffort)
  const displayModels: ModelInfo[] = selectedModel ? models : [{ id: cfg.profile.model }, ...models]
  async function selectEffort(
    reasoningEffort: NonNullable<Settings['profile']['reasoningEffort']>,
  ) {
    if (saving || disabled || !choices.includes(reasoningEffort)) return
    setSaving(true)
    try {
      update(await api.saveSettings({ profile: { ...cfg.profile, reasoningEffort } }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换失败')
    } finally {
      setSaving(false)
    }
  }
  async function selectModel(model: string) {
    if (saving || disabled || model === cfg.profile.model) return
    setSaving(true)
    try {
      update(
        await api.saveSettings({
          profile: {
            ...cfg.profile,
            model,
            reasoningEffort:
              cfg.profile.reasoningEffort === undefined
                ? undefined
                : modelEffort(
                    models.find((item) => item.id === model),
                    cfg.profile.reasoningEffort,
                  ),
          },
        }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换失败')
    } finally {
      setSaving(false)
    }
  }
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void refresh()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="model"
          shape="round"
          className="min-w-0"
          aria-label={`选择模型：${selectedModel?.name || cfg.profile.model} · ${effortLabel(selectedEffort)}`}
          title="选择模型"
          disabled={disabled || saving}
        >
          <span className="truncate">
            {selectedModel?.name || cfg.profile.model} · {effortLabel(selectedEffort)}
          </span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-56 max-w-[calc(100vw-32px)] rounded-xl p-1.5"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>选择模型</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-label="选择模型"
            value={cfg.profile.model}
            onValueChange={(model) => void selectModel(model)}
          >
            {displayModels.map((model) => (
              <DropdownMenuRadioItem
                key={model.id}
                value={model.id}
                title={model.id}
                disabled={saving}
              >
                <span className="truncate">{model.name || model.id}</span>
                {model.contextWindow && (
                  <span
                    className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
                    title={`${model.contextWindow.toLocaleString()} tokens`}
                  >
                    {formatContext(model.contextWindow)}
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {failed && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void refresh()
              }}
            >
              获取失败，重试
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>思考强度</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-label="思考强度"
            value={selectedEffort}
            onValueChange={(value) =>
              void selectEffort(value as NonNullable<Settings['profile']['reasoningEffort']>)
            }
          >
            {choices.map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort} disabled={saving}>
                {effortLabel(effort)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
