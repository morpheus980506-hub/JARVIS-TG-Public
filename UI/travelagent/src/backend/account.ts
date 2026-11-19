import { createHash, timingSafeEqual } from 'node:crypto'
import { demoConfig } from '../demo-config'
import type { LocalAccount } from '../shared'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function verifyDemoAccount(username: string, password: string): LocalAccount {
  const account = demoConfig.account
  if (
    username !== account.username ||
    !timingSafeEqual(digest(password), digest(account.password))
  ) {
    throw new Error('用户名或密码错误')
  }

  return { username: account.username, displayName: account.displayName, kind: 'demo' }
}
