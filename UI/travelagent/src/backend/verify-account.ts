import assert from 'node:assert/strict'
import { demoConfig } from '../demo-config'
import * as store from './store'

export async function verifyAccount() {
  const { username, password } = demoConfig.account
  store.logout()
  await assert.rejects(store.login(username, `${password}-wrong`), /用户名或密码错误/)
  assert.equal(store.account(), null)
  await store.login(username, password)
  assert.equal(store.account()?.username, username)
  for (const name of store.secretNames) {
    assert.ok(
      store.secret(name) === demoConfig.secrets[name as keyof typeof demoConfig.secrets],
      `Preset mismatch for ${name}`,
    )
  }
  assert.equal(store.settings().keySources.deepseek.kind, 'account')
  store.logout()
  assert.equal(store.settings().keySources.deepseek.kind, 'demo')
  await store.saveSettings({ secrets: { deepseek: 'account-rotation-placeholder' } })
  assert.equal(store.settings().keySources.deepseek.kind, 'custom')
  assert.equal(store.secret('deepseek'), 'account-rotation-placeholder')
  await store.login(username, password)
  assert.equal(store.settings().keySources.deepseek.kind, 'account')
  console.log(
    'ACCOUNT VERIFY PASS: source presets, invalid login, ownership, overrides, repeat login',
  )
}
