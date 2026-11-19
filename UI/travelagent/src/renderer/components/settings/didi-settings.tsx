import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { builtinMcpServers } from '../../../mcp-config'
import type { Settings } from '../../../shared'
import { KeySourceHint } from './key-source-hint'

export function DidiSettings({
  cfg,
  onSaved,
}: {
  cfg: Settings
  onSaved: (value: Settings) => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const accountManaged = cfg.keySources.didi?.kind === 'account'
  async function save() {
    if (accountManaged) return
    setBusy(true)
    setStatus('')
    try {
      onSaved(await api.saveSettings({ secrets: { didi: key.trim() } }))
      setKey('')
      setStatus('滴滴密钥已加密保存')
    } catch (error: any) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    setBusy(true)
    setStatus('')
    try {
      const result = await api.testMcpServer(
        builtinMcpServers.find((server) => server.builtin === 'didi')!,
      )
      setStatus(`连接成功 · ${result.tools.length} 个查询工具 · 下单功能已禁用`)
    } catch (error: any) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card aria-label="滴滴 MCP 仅查询配置" aria-busy={busy}>
      <CardHeader>
        <CardTitle>滴滴出行</CardTitle>
        <CardDescription>仅查询 · 查价与路线 · 禁止下单、取消订单及生成打车链接</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant="secondary">{cfg.configured.didi ? '已配置 · 仅查询' : '未配置'}</Badge>
        <FieldGroup>
          <Field data-disabled={busy || accountManaged}>
            <FieldLabel htmlFor="didi-mcp-key">滴滴 MCP API Key</FieldLabel>
            <Input
              id="didi-mcp-key"
              type="password"
              autoComplete="off"
              disabled={busy || accountManaged}
              value={accountManaged ? '' : key}
              placeholder={accountManaged ? '账号接管中' : cfg.masked.didi || '输入 API Key'}
              aria-describedby={
                cfg.keySources.didi?.kind && cfg.keySources.didi.kind !== 'none'
                  ? 'didi-mcp-help didi-mcp-source'
                  : 'didi-mcp-help'
              }
              onChange={(event) => setKey(event.target.value)}
            />
            <FieldDescription id="didi-mcp-help" className="sr-only">
              预估价格仅供参考，不会实际叫车。
            </FieldDescription>
            <KeySourceHint id="didi-mcp-source" value={cfg.keySources.didi} hidden />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || accountManaged || !key.trim()}
            onClick={() => void save()}
          >
            保存密钥
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !cfg.configured.didi || (!accountManaged && !!key.trim())}
            onClick={() => void test()}
          >
            测试查询连接
          </Button>
        </div>
        {status && (
          <Alert role="status">
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
