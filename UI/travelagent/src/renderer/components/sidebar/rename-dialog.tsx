import { useState } from 'react'
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
import type { Session } from '../../../shared'
export function RenameDialog({
  session,
  onClose,
  onSaved,
}: {
  session: Session
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [renameTitle, setRenameTitle] = useState(session.title)
  const [renameError, setRenameError] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !renameSaving) onClose()
      }}
    >
      <DialogContent className="p-5 sm:max-w-md">
        <form
          aria-label="修改对话标题"
          aria-busy={renameSaving}
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (renameSaving || !renameTitle.trim()) return
            setRenameSaving(true)
            setRenameError('')
            try {
              await api.renameSession(session.id, renameTitle.trim())
              await onSaved()
              onClose()
            } catch (saveError) {
              setRenameError(String(saveError))
            } finally {
              setRenameSaving(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>修改标题</DialogTitle>
            <DialogDescription>为这段对话设置一个便于查找的名称。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(renameError)} data-disabled={renameSaving}>
              <FieldLabel className="sr-only" htmlFor="rename-title">
                会话标题
              </FieldLabel>
              <Input
                id="rename-title"
                autoFocus
                maxLength={80}
                value={renameTitle}
                disabled={renameSaving}
                aria-invalid={Boolean(renameError)}
                aria-describedby={renameError ? 'rename-title-error' : undefined}
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
                }}
              />
              {renameError && (
                <p id="rename-title-error" role="alert">
                  {renameError}
                </p>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-16"
              disabled={renameSaving}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              className="min-w-16"
              disabled={renameSaving || !renameTitle.trim()}
            >
              {renameSaving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
