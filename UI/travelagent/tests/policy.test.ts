import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canExecute, mandatoryReview, resolveFile, retryable } from '../src/backend/policy'
test('normal development, network and scoped artifact cleanup can be reviewed normally', () => {
  for (const command of [
    'pnpm install',
    'pnpm test',
    'curl https://example.com',
    String.raw`Remove-Item -LiteralPath .\dist -Recurse`,
  ]) {
    assert.equal(mandatoryReview(command), null)
  }
})
test('destructive system operations must reach human approval', () => {
  for (const command of [
    'format C:',
    'Clear-Disk -Number 0',
    String.raw`Remove-Item C:\Users\* -Recurse`,
    'Set-MpPreference -DisableRealtimeMonitoring $true',
  ]) {
    assert.ok(mandatoryReview(command))
  }
})
test('file access is not confined to workspace', () => {
  assert.equal(
    resolveFile(String.raw`D:\Workspace\travelagent`, String.raw`..\outside.txt`),
    String.raw`D:\Workspace\outside.txt`,
  )
  assert.equal(
    resolveFile(String.raw`D:\Workspace\travelagent`, String.raw`C:\Users\test\notes.md`),
    String.raw`C:\Users\test\notes.md`,
  )
})
test('only explicit reviewer allow executes', () => {
  assert.equal(canExecute('allow'), true)
  for (const value of ['require_approval', 'error', undefined, undefined]) {
    assert.equal(canExecute(value), false)
  }
})
test('retry applies to temporary HTTP failures only', () => {
  for (const session of [408, 429, 500, 504]) {
    assert.ok(retryable(session))
  }
  for (const session of [400, 401, 402, 403, 404]) {
    assert.equal(retryable(session), false)
  }
})
