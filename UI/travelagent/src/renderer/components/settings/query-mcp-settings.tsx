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

export function QueryMcpSettings({
  cfg,
  onSaved,
  provider,
}: {
  provider: 'rollinggo' | 'variflight'
  cfg: Settings
  onSaved: (value: Settings) => void
}) {
  const label = provider === 'rollinggo' ? 'RollingGo 酒店' : 'VariFlight 航空'
  const help =
    provider === 'rollinggo'
      ? '酒店搜索、详情、标签与静态信息'
      : '航班动态、中转、票价、舒适度、飞机位置与机场天气'
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const accountManaged = cfg.keySources[provider]?.kind === 'account'
  async function save() {
    if (accountManaged) return
    setBusy(true)
    setStatus('')
    try {
      onSaved(await api.saveSettings({ secrets: { [provider]: key.trim() } }))
      setKey('')
      setStatus(`${label}密钥已加密保存`)
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
        builtinMcpServers.find(
          (server) =>
            server.builtin === (provider === 'rollinggo' ? 'rollinggo-hotel' : 'variflight'),
        )!,
      )
      setStatus(`连接成功 · ${result.tools.length} 个查询工具 · 下单功能已禁用`)
    } catch (error: any) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card aria-label={`${label} MCP 仅查询配置`} aria-busy={busy}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>仅查询 · 创建订单、支付及订单变更已禁用</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant="secondary">{cfg.configured[provider] ? '已配置 · 仅查询' : '未配置'}</Badge>
        <FieldGroup>
          <Field data-disabled={busy || accountManaged}>
            <FieldLabel htmlFor={`${provider}-mcp-key`}>{label} MCP API Key</FieldLabel>
            <Input
              id={`${provider}-mcp-key`}
              type="password"
              autoComplete="off"
              disabled={busy || accountManaged}
              value={accountManaged ? '' : key}
              placeholder={accountManaged ? '账号接管中' : cfg.masked[provider] || '输入 API Key'}
              aria-describedby={
                cfg.keySources[provider]?.kind && cfg.keySources[provider].kind !== 'none'
                  ? `${provider}-mcp-help ${provider}-mcp-source`
                  : `${provider}-mcp-help`
              }
              onChange={(event) => setKey(event.target.value)}
            />
            <FieldDescription id={`${provider}-mcp-help`} className="sr-only">
              仅提供{help}查询，不创建订单。
            </FieldDescription>
            <KeySourceHint id={`${provider}-mcp-source`} value={cfg.keySources[provider]} hidden />
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
            disabled={busy || !cfg.configured[provider] || (!accountManaged && !!key.trim())}
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
