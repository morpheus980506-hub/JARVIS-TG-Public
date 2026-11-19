import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollTextarea } from '@/components/ui/scroll-area'
import { api } from '@/lib/api'
import { isBuiltinMcp } from '../../../mcp-config'
import type { McpServerConfig, Settings } from '../../../shared'
import { DidiSettings } from './didi-settings'
import { QueryMcpSettings } from './query-mcp-settings'
export function McpSettings({
  value,
  status,
  onChange,
  onStatus,
  onSaved,
  cfg,
  onSettingsSaved,
}: {
  cfg: Settings
  onSettingsSaved: (value: Settings) => void
  value: McpServerConfig[]
  status: Record<string, string>
  onChange: (value: McpServerConfig[]) => void
  onStatus: (id: string, message: string) => void
  onSaved: (value: McpServerConfig[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const external = value.filter((server) => !isBuiltinMcp(server.id))
  const update = (id: string, change: Partial<McpServerConfig>) =>
    onChange(value.map((server) => (server.id === id ? { ...server, ...change } : server)))
  async function save() {
    setBusy(true)
    try {
      onSaved(await api.saveMcpServers(value))
    } catch (error: any) {
      onStatus('global', error.message)
    } finally {
      setBusy(false)
    }
  }
  async function test(server: McpServerConfig) {
    onStatus(server.id, '连接中…')
    try {
      const result = await api.testMcpServer(server)
      onStatus(server.id, `连接成功 · ${result.tools.length} 个工具`)
    } catch (error: any) {
      onStatus(server.id, error.message)
    }
  }
  return (
    <>
      <FieldDescription>
        MCP 服务为 JARVIS 提供旅行查询工具。内置 12306
        支持车站、直达余票、中转与经停查询；票价仅展示接口返回值。外部服务支持 stdio 和 Streamable
        HTTP。
      </FieldDescription>
      <Card>
        <CardHeader>
          <CardTitle>12306</CardTitle>
          <CardDescription>内置 MCP · 无需额外 Key · 直接访问 12306 官方接口</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <Badge variant="secondary">已启用</Badge>
          <span className="text-muted-foreground text-xs">
            8 个工具 · 车站 / 余票 / 中转 / 经停
          </span>
        </CardContent>
      </Card>
      <DidiSettings cfg={cfg} onSaved={onSettingsSaved} />
      <QueryMcpSettings provider="rollinggo" cfg={cfg} onSaved={onSettingsSaved} />
      <QueryMcpSettings provider="variflight" cfg={cfg} onSaved={onSettingsSaved} />
      {external.map((server) => (
        <Card key={server.id}>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{server.name || '未命名 MCP'}</CardTitle>
              <CardDescription>
                {server.transport === 'stdio' ? 'stdio 本机进程' : 'Streamable HTTP'}
              </CardDescription>
            </div>
            <Checkbox
              checked={server.enabled}
              aria-label={`启用 ${server.name}`}
              onCheckedChange={(checked) => update(server.id, { enabled: checked === true })}
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor={`mcp-name-${server.id}`}>名称</FieldLabel>
              <Input
                id={`mcp-name-${server.id}`}
                value={server.name}
                onChange={(event) => update(server.id, { name: event.target.value })}
              />
            </Field>
            {server.transport === 'stdio' ? (
              <>
                <Field>
                  <FieldLabel htmlFor={`mcp-command-${server.id}`}>启动命令</FieldLabel>
                  <Input
                    id={`mcp-command-${server.id}`}
                    value={server.command || ''}
                    placeholder="例如 npx"
                    onChange={(event) => update(server.id, { command: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`mcp-args-${server.id}`}>参数（每行一个）</FieldLabel>
                  <ScrollTextarea
                    id={`mcp-args-${server.id}`}
                    rows={3}
                    value={(server.args || []).join('\n')}
                    onChange={(event) =>
                      update(server.id, { args: event.target.value.split(/\r?\n/).filter(Boolean) })
                    }
                  />
                </Field>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor={`mcp-url-${server.id}`}>服务 URL</FieldLabel>
                <Input
                  id={`mcp-url-${server.id}`}
                  type="url"
                  value={server.url || ''}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => update(server.id, { url: event.target.value })}
                />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void test(server)}>
                测试连接
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(value.filter((item) => item.id !== server.id))}
              >
                删除
              </Button>
              {status[server.id] && (
                <span className="text-muted-foreground text-xs">{status[server.id]}</span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            onChange([
              ...value,
              {
                id: `mcp-${Date.now()}`,
                name: '新 MCP 服务',
                transport: 'stdio',
                enabled: true,
                command: '',
                args: [],
                env: {},
              },
            ])
          }
        >
          添加 stdio 服务
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            onChange([
              ...value,
              {
                id: `mcp-http-${Date.now()}`,
                name: '新的 HTTP MCP 服务',
                transport: 'http',
                enabled: true,
                url: '',
              },
            ])
          }
        >
          添加 HTTP 服务
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          保存 MCP 配置
        </Button>
      </div>
      {status.global && (
        <Alert role="status">
          <AlertDescription>{status.global}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
