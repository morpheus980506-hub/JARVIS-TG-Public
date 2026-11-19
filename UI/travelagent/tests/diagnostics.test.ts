import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createDiagnosticLogger } from '../src/backend/diagnostics'

test('diagnostics redact errors, rotate bounded files and tolerate unavailable storage', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'travelagent-log-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'main.log')
  const log = createDiagnosticLogger(
    () => file,
    (value) => value.replaceAll('private-key', '[REDACTED]'),
  )
  log('Renderer:', new Error('private-key'))
  assert.match(readFileSync(file, 'utf8'), /Renderer: Error: \[REDACTED\]/)
  assert.doesNotMatch(readFileSync(file, 'utf8'), /private-key/)
  writeFileSync(file, 'x'.repeat(1024 * 1024))
  log('Load:', -2, 'failed')
  assert.equal(readFileSync(`${file}.previous`, 'utf8').length, 1024 * 1024)
  assert.match(readFileSync(file, 'utf8'), /Load: -2 failed/)
  const unavailable = createDiagnosticLogger(
    () => path.join(file, 'child.log'),
    (value) => value,
  )
  assert.doesNotThrow(() => unavailable('failed to log'))
})

test('diagnostics survive the launcher closing both output pipes', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'travelagent-pipe-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'main.log')
  const moduleURL = pathToFileURL(path.resolve('src/backend/diagnostics.ts')).href
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { createDiagnosticLogger } from ${JSON.stringify(moduleURL)};
    const log = createDiagnosticLogger(() => ${JSON.stringify(file)}, value => value);
    process.stdout.write('ready');
    process.stdin.once('data', () => log('Renderer:', 'map SDK warning'));
  `,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
  child.stdout.destroy()
  child.stderr.destroy()
  child.stdin.end('continue')
  assert.equal(await exited, 0)
  assert.match(readFileSync(file, 'utf8'), /Renderer: map SDK warning/)
})
