import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyDemoAccount } from '../src/backend/account'
import { demoConfig } from '../src/demo-config'

test('local demo account accepts only the expected credentials', () => {
  const { username, password, displayName } = demoConfig.account
  assert.deepEqual(verifyDemoAccount(username, password), {
    username,
    displayName,
    kind: 'demo',
  })
  for (const [inputName, inputPassword] of [
    [username, ''],
    [username, `${password} `],
    [`${username}-other`, password],
    [username, `${password}-wrong`],
  ]) {
    assert.throws(() => verifyDemoAccount(inputName, inputPassword), /用户名或密码错误/)
  }
})
