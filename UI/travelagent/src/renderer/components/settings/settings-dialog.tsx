import {
  BookOpen,
  Check,
  Compass,
  ExternalLink,
  Folder,
  Plug,
  KeyRound,
  Map,
  Moon,
  Sun,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConnectionGuide } from '@/components/settings/connection-guide'
import { KeySourceHint } from '@/components/settings/key-source-hint'
import { McpSettings } from '@/components/settings/mcp-settings'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import type { McpServerConfig, Settings } from '../../../shared'

export function SettingsModal({
  open,
  close,
  cfg,
  update,
  initialTab,
}: {
  open: boolean
  close: () => void
  cfg: Settings
  update: (c: Settings) => void
  initialTab: '外观' | '工作区'
}) {
  const [tab, setTab] = useState<string>(initialTab)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [mcp, setMcp] = useState<McpServerConfig[]>(cfg.mcpServers)
  const [mcpStatus, setMcpStatus] = useState<Record<string, string>>({})
  async function save(validate = false) {
    setBusy(true)
    setStatus('')
    try {
      if (validate) {
        const result = await api.validate(keys.deepseek)
        if (!result.models.includes('deepseek-flash')) {
          throw new Error('默认模型 deepseek-flash 不可用')
        }
        setStatus(
          result.available ? '验证通过，已连接 DeepSeek' : 'Key 有效，账户余额不足，请充值后再使用',
        )
      }
      const value = { secrets: keys }
      update(await api.saveSettings(value))
      setKeys({})
      if (!validate) {
        setStatus('设置已保存')
      }
    } catch (error: any) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }
  function keyInput(name: string, label: string, description?: string) {
    const accountManaged = cfg.keySources[name]?.kind === 'account'
    const hideHints = ['deepseek', 'amap', 'amapJs', 'amapSecurity'].includes(name)
    return (
      <Field key={name} data-disabled={busy || accountManaged}>
        <FieldLabel htmlFor={`key-${name}`}>{label}</FieldLabel>
        <Input
          id={`key-${name}`}
          type="password"
          autoComplete="off"
          disabled={busy || accountManaged}
          aria-describedby={
            [
              description ? `key-${name}-description` : '',
              cfg.keySources[name]?.kind && cfg.keySources[name].kind !== 'none'
                ? `key-${name}-source`
                : '',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          placeholder={
            cfg.keySources[name]?.kind === 'account'
              ? '账号接管中'
              : cfg.masked[name] || '输入 API Key'
          }
          value={keys[name] ?? ''}
          onChange={(event) =>
            setKeys({
              ...keys,
              [name]: event.target.value,
            })
          }
        />
        {description && (
          <FieldDescription
            id={`key-${name}-description`}
            className={hideHints ? 'sr-only' : undefined}
          >
            {description}
          </FieldDescription>
        )}
        <KeySourceHint id={`key-${name}-source`} value={cfg.keySources[name]} hidden={hideHints} />
        {cfg.configured[name] && !accountManaged && (
          <Button
            variant="link"
            size="sm"
            className="w-fit px-0"
            onClick={async () => {
              update(
                await api.saveSettings({
                  secrets: {
                    [name]: '',
                  },
                }),
              )
              setStatus('密钥已删除')
            }}
          >
            删除已保存密钥
          </Button>
        )}
      </Field>
    )
  }
  const tabs = [
    ['外观', Sun],
    ['工作区', Folder],
    ['DeepSeek', KeyRound],
    ['旅行服务', Map],
    ['MCP 服务', Plug],
    ['接入教程', BookOpen],
  ] as const
  function selectTab(value: string) {
    setTab(value)
    setStatus('')
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          close()
        }
      }}
    >
      <DialogContent
        id="settings-dialog"
        aria-busy={busy}
        className="h-[620px] max-h-[90vh] w-[min(820px,90vw)] max-w-[min(820px,90vw)] gap-0 overflow-hidden p-0 sm:max-w-[min(820px,90vw)]"
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">配置模型、旅行服务和工作区</DialogDescription>
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={selectTab}
          className="size-full min-h-0 gap-0"
        >
          <ScrollArea
            className="bg-sidebar w-[200px] shrink-0 border-r [&_h3]:mx-3 [&_h3]:mb-[22px] [&_h3]:text-base [&_h3]:font-semibold"
            contentClassName="px-3 py-6"
          >
            <h3>设置</h3>
            <TabsList variant="navigation" className="w-full items-stretch" aria-label="设置分类">
              {tabs.map(([label, Icon]) => (
                <TabsTrigger key={label} value={label}>
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </ScrollArea>
          <ScrollArea
            className="min-h-0 min-w-0 flex-1 [&_h2]:text-xl [&_h2]:font-semibold"
            contentClassName="px-[37px] py-[35px]"
            key={tab}
          >
            <TabsContent value={tab} className="m-0">
              <FieldGroup>
                <h2>{tab === 'DeepSeek' ? '连接 DeepSeek' : tab}</h2>
                {tab === 'DeepSeek' ? (
                  <>
                    <FieldDescription>对话、网页工具和听写共用此 API Key。</FieldDescription>
                    <Card>
                      <CardHeader>
                        <CardTitle>DeepSeek</CardTitle>
                        <CardDescription>默认模型 · deepseek-flash</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Badge variant="secondary">
                          {cfg.configured.deepseek ? '已配置' : '推荐'}
                        </Badge>
                      </CardContent>
                    </Card>
                    {keyInput('deepseek', 'DeepSeek API Key')}
                    <Button
                      variant="link"
                      className="w-fit px-0"
                      onClick={() => api.openExternal('https://platform.deepseek.com/api_keys')}
                    >
                      获取 API Key
                      <ExternalLink data-icon="inline-end" />
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy || (!keys.deepseek && !cfg.configured.deepseek)}
                        onClick={() => save(true)}
                      >
                        {busy ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Check data-icon="inline-start" />
                        )}
                        验证并保存
                      </Button>
                      {cfg.configured.deepseek && (
                        <Button variant="ghost" onClick={close}>
                          开始规划
                        </Button>
                      )}
                    </div>
                  </>
                ) : tab === '外观' ? (
                  <Field>
                    <FieldLabel id="theme-label">外观主题</FieldLabel>
                    <FieldDescription>为你的旅行空间选择合适的外观。</FieldDescription>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      spacing={2}
                      value={cfg.theme}
                      aria-labelledby="theme-label"
                      onValueChange={async (theme) => {
                        if (theme) {
                          try {
                            update(
                              await api.saveSettings({
                                theme,
                              }),
                            )
                          } catch (error: any) {
                            toast.error(error.message)
                          }
                        }
                      }}
                    >
                      <ToggleGroupItem value="light">
                        <Sun />
                        浅色
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dark">
                        <Moon />
                        深色
                      </ToggleGroupItem>
                      <ToggleGroupItem value="system">
                        <Compass />
                        跟随系统
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                ) : tab === '旅行服务' ? (
                  <>
                    <FieldDescription>
                      按需配置。缺少接口时，Agent 会明确标记待查询。
                    </FieldDescription>
                    {keyInput('amap', '高德 Web 服务 Key', '用于地点搜索与真实路线查询。')}
                    {keyInput(
                      'amapJs',
                      '高德 JavaScript API Key',
                      '交互地图需单独申请 JS 类型的 Key。',
                    )}
                    {keyInput('amapSecurity', '高德 JS 安全密钥', '通过本机代理注入，不传入页面。')}
                    <Button className="w-fit" disabled={busy} onClick={() => save()}>
                      保存服务密钥
                    </Button>
                  </>
                ) : tab === 'MCP 服务' ? (
                  <McpSettings
                    cfg={cfg}
                    onSettingsSaved={update}
                    value={mcp}
                    status={mcpStatus}
                    onChange={setMcp}
                    onStatus={(id, message) =>
                      setMcpStatus((current) => ({ ...current, [id]: message }))
                    }
                    onSaved={(servers) => {
                      setMcp(servers)
                      update({ ...cfg, mcpServers: servers })
                      setStatus('MCP 配置已保存')
                    }}
                  />
                ) : tab === '接入教程' ? (
                  <ConnectionGuide openTab={selectTab} />
                ) : (
                  <WorkspaceSettings cfg={cfg} update={update} />
                )}
                {status && (
                  <Alert role="status">
                    <AlertTitle>设置状态</AlertTitle>
                    <AlertDescription>{status}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
