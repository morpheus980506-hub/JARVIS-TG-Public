import { FieldDescription } from '@/components/ui/field'
import type { KeySource } from '../../../shared'

export function KeySourceHint({
  value,
  id,
  hidden = false,
}: {
  value?: KeySource
  id: string
  hidden?: boolean
}) {
  if (!value || value.kind === 'none') return null
  const text =
    value.kind === 'account'
      ? '账号接管，重新登录恢复账号预设。'
      : value.kind === 'demo'
        ? '使用代码中的演示预设。'
        : '自定义配置，登录演示账号时将被替换。'
  return (
    <FieldDescription id={id} className={hidden ? 'sr-only' : undefined}>
      {text}
    </FieldDescription>
  )
}
