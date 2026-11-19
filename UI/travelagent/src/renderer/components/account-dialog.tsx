import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { assistantName } from '../../app-name'
import type { LocalAccount } from '../../shared'

export function AccountDialog({
  open,
  onOpenChange,
  account,
  update,
  credentials,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: LocalAccount | null
  update: (account: LocalAccount | null) => Promise<void>
  credentials?: { username: string }
}) {
  const [username, setUsername] = useState<string>()
  const loginUsername = username ?? credentials?.username ?? ''
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [presentation, setPresentation] = useState({ open, account })
  if (open !== presentation.open) {
    setPresentation({ open, account: open ? account : presentation.account })
  }
  // Keep this opening's content through asynchronous account updates and the exit animation.
  const visibleAccount = presentation.account
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          onOpenChange(value)
        }
      }}
    >
      <DialogContent
        id="account-dialog"
        className="gap-0 p-5 sm:max-w-sm"
        onCloseAutoFocus={() => {
          setPassword('')
          setError('')
          setBusy(false)
        }}
      >
        <form
          aria-busy={busy}
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            try {
              if (visibleAccount) {
                await api.logout()
                await update(null)
              } else {
                const value = await api.login(loginUsername.trim(), password)
                await update(value)
              }
              onOpenChange(false)
            } catch (value) {
              setError(String(value).replace(/^Error:.*?: /, ''))
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{visibleAccount ? '账户' : `登录 ${assistantName}`}</DialogTitle>
            <DialogDescription className="sr-only">
              {visibleAccount ? '查看当前账户信息。' : '输入用户名和密码登录。'}
            </DialogDescription>
          </DialogHeader>
          {visibleAccount ? (
            <FieldGroup className="gap-4">
              <Field className="gap-2">
                <FieldLabel>当前账户</FieldLabel>
                <p>
                  {visibleAccount.displayName}@{visibleAccount.username}
                </p>
              </Field>
            </FieldGroup>
          ) : (
            <FieldGroup className="gap-4">
              <Field className="gap-2" data-invalid={Boolean(error)} data-disabled={busy}>
                <FieldLabel htmlFor="account-username">用户名</FieldLabel>
                <Input
                  id="account-username"
                  autoComplete="username"
                  value={loginUsername}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={busy}
                  maxLength={64}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'account-error' : undefined}
                />
              </Field>
              <Field className="gap-2" data-invalid={Boolean(error)} data-disabled={busy}>
                <FieldLabel htmlFor="account-password">密码</FieldLabel>
                <Input
                  id="account-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  maxLength={128}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'account-error' : undefined}
                />
              </Field>
            </FieldGroup>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription id="account-error" role="alert">
                {error}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              className="min-w-20"
              disabled={busy || (!visibleAccount && (!loginUsername.trim() || !password))}
            >
              {busy ? '处理中…' : visibleAccount ? '退出登录' : '登录'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
