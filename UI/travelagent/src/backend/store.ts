import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { safeStorage } from 'electron'
import { deepseekProfile } from '../deepseek-config'
import { demoConfig } from '../demo-config'
import { builtinMcpServers, isBuiltinMcp } from '../mcp-config'
import {
  defaultWorkspaceId,
  type LocalAccount,
  type McpServerConfig,
  type Session,
  type Settings,
  type Workspace,
} from '../shared'
import { verifyDemoAccount } from './account'
import { dataPath, preferredWorkspacePath } from './data-directory'
import { keySources } from './key-sources'
import { redactData, redactText } from './redaction'
import { observedTrip } from './trip'

let db: DatabaseSync
let workspaceDirectory: string | undefined
const secrets = new Map<string, string>()
export const secretNames = Object.keys(demoConfig.secrets)
const fingerprintOf = (config: object) =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex')
export async function initStore() {
  fs.mkdirSync(dataPath(), {
    recursive: true,
  })
  db = new DatabaseSync(dataPath('travelagent.sqlite'))
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,value TEXT NOT NULL)',
  )
  const validSecretKeys = new Set(secretNames.map((name) => `secret:${name}`))
  const retiredSecretValues: string[] = []
  for (const row of db.prepare("SELECT key,value FROM kv WHERE key LIKE 'secret:%'").all() as {
    key: string
    value: string
  }[]) {
    if (!validSecretKeys.has(row.key)) {
      try {
        const encrypted = JSON.parse(row.value)
        if (typeof encrypted === 'string' && encrypted) {
          retiredSecretValues.push(
            // oxlint-disable-next-line no-await-in-loop -- Retired secrets are decrypted sequentially before removal.
            (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result,
          )
        }
      } catch {
        // Retired credentials are removed even when the platform cannot decrypt them.
      }
      db.prepare('DELETE FROM kv WHERE key=?').run(row.key)
    }
  }
  const legacyDirectory = dataPath('workspace')
  const preferredDirectory = preferredWorkspacePath()
  try {
    fs.mkdirSync(preferredDirectory, { recursive: true })
    workspaceDirectory = preferredDirectory
  } catch (error) {
    if (preferredDirectory === legacyDirectory) throw error
    fs.mkdirSync(legacyDirectory, { recursive: true })
    workspaceDirectory = legacyDirectory
  }
  let legacyWorkspace = get('legacyDefaultWorkspace') as Workspace | undefined
  if (
    !legacyWorkspace &&
    !sameDirectory(legacyDirectory, workspaceDirectory) &&
    fs.existsSync(legacyDirectory)
  ) {
    legacyWorkspace = recordWorkspace(legacyDirectory, '旧默认工作区')
    put('legacyDefaultWorkspace', legacyWorkspace)
  }
  const previousDirectory: unknown = get('workspace')
  const previousWorkspace =
    typeof previousDirectory === 'string' && path.isAbsolute(previousDirectory)
      ? recordWorkspace(path.resolve(previousDirectory))
      : (legacyWorkspace ?? defaultWorkspace())
  for (const name of [...secretNames, 'model', 'review']) {
    const encrypted = get(`secret:${name}`)
    if (encrypted === null) secrets.set(name, '')
    else if (encrypted) {
      secrets.set(
        name,
        // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
        (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result,
      )
    }
  }
  const previousSecrets = [...retiredSecretValues, ...secrets.values()]
  db.prepare('DELETE FROM kv WHERE key IN (?, ?, ?)').run(
    'reviewProfile',
    'secret:model',
    'secret:review',
  )
  secrets.delete('model')
  secrets.delete('review')
  const fingerprint = fingerprintOf(demoConfig)
  // Reproduce the prior property order so retiring the tool key preserves other overrides.
  const { variflight, deepseek, ...remainingSecrets } = demoConfig.secrets
  const legacyConfig = {
    ...demoConfig,
    secrets: { variflight, deepseek, deepseekTools: '', ...remainingSecrets },
  }
  const legacyChatConfig = {
    ...legacyConfig,
    profile: { ...demoConfig.profile, protocol: 'chat', baseURL: 'https://api.deepseek.com' },
  }
  const storedFingerprint = get('demoConfigFingerprint')
  if (
    ![fingerprint, fingerprintOf(legacyConfig), fingerprintOf(legacyChatConfig)].includes(
      storedFingerprint,
    )
  ) {
    for (const name of secretNames) {
      db.prepare('DELETE FROM kv WHERE key=?').run(`secret:${name}`)
      secrets.delete(name)
    }
  }
  if (storedFingerprint !== fingerprint) put('demoConfigFingerprint', fingerprint)
  put('profile', deepseekProfile(get('profile'), demoConfig.profile.model))
  // Keep source defaults and previous overrides out of restored session history.
  for (const row of db.prepare('SELECT id,value FROM sessions').all() as {
    id: string
    value: string
  }[]) {
    const saved: Session = JSON.parse(row.value)
    saved.workspace ??= previousWorkspace
    const clean = JSON.stringify(redactData(saved, [...previousSecrets, ...secretValues()]))
    if (clean !== row.value) db.prepare('UPDATE sessions SET value=? WHERE id=?').run(clean, row.id)
  }
  db.prepare('DELETE FROM kv WHERE key = ?').run('workspace')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}
export function get(key: string): any {
  const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key) as any
  return row ? JSON.parse(row.value) : undefined
}
export function put(key: string, value: any) {
  db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(key, JSON.stringify(value))
}
export function defaultWorkspace(): Workspace {
  return {
    id: defaultWorkspaceId,
    name: '默认工作区',
    path: workspaceDirectory ?? preferredWorkspacePath(),
  }
}
function customWorkspaces(): Workspace[] {
  return get('workspaces') ?? []
}
function sameDirectory(left: string, right: string) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
function recordWorkspace(directory: string, name = path.basename(directory) || directory) {
  const registered = customWorkspaces()
  const existing = [defaultWorkspace(), ...registered].find((item) =>
    sameDirectory(item.path, directory),
  )
  if (existing) return existing
  const workspace = {
    id: randomUUID(),
    name,
    path: directory,
  }
  put('workspaces', [...registered, workspace])
  return workspace
}
export function workspaceById(id = defaultWorkspaceId) {
  const workspace = [defaultWorkspace(), ...customWorkspaces()].find((item) => item.id === id)
  if (!workspace) throw new Error('该工作区已移除，请重新选择')
  return workspace
}
export async function addWorkspace(directory: string) {
  const canonical = await fs.promises.realpath(directory)
  if (!(await fs.promises.stat(canonical)).isDirectory()) throw new Error('请选择一个文件夹')
  return recordWorkspace(canonical)
}
export function removeWorkspace(id: string) {
  if (id === defaultWorkspaceId) throw new Error('默认工作区不能移除')
  workspaceById(id)
  put(
    'workspaces',
    customWorkspaces().filter((item) => item.id !== id),
  )
}
export function secret(key: string): string {
  return secrets.get(key) ?? demoConfig.secrets[key as keyof typeof demoConfig.secrets] ?? ''
}
export async function setSecret(key: string, value: string) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('系统加密服务不可用')
  }
  const encrypted = value ? (await safeStorage.encryptStringAsync(value)).toString('base64') : null
  put(`secret:${key}`, encrypted)
  secrets.set(key, value)
}
export function settings(): Settings {
  const configured: Record<string, boolean> = {}
  const masked: Record<string, string> = {}
  for (const name of secretNames) {
    const sessionValue = secret(name)
    configured[name] = Boolean(sessionValue)
    masked[name] = sessionValue ? `••••••••${sessionValue.slice(-4)}` : ''
  }
  return {
    configured,
    keySources: keySources(
      Object.fromEntries(secretNames.map((name) => [name, secret(name)])),
      demoConfig.secrets,
      Boolean(account()),
    ),
    demoAccount: { username: demoConfig.account.username },
    masked,
    profile: get('profile') || demoConfig.profile,
    theme: get('theme') || 'system',
    workspaces: [defaultWorkspace(), ...customWorkspaces()],
    mcpServers: [
      ...builtinMcpServers.map((server) => Object.assign({}, server)),
      ...(Array.isArray(get('mcpServers')) ? get('mcpServers') : []).filter(
        (server: McpServerConfig) => !isBuiltinMcp(server.id),
      ),
    ],
  }
}
export async function saveSettings(value: any) {
  for (const key of ['profile', 'theme']) {
    if (value[key] !== undefined) {
      put(
        key,
        key === 'profile' ? deepseekProfile(value[key], demoConfig.profile.model) : value[key],
      )
    }
  }
  for (const [key, valueValue] of Object.entries(value.secrets || {})) {
    if (secretNames.includes(key) && typeof valueValue === 'string') {
      // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
      await setSecret(key, valueValue.trim())
    }
  }
  return settings()
}
export function sessions(): Session[] {
  return db
    .prepare('SELECT value FROM sessions')
    .all()
    .map((result: any) => {
      const session2Value = JSON.parse(result.value)
      if (session2Value.trip) {
        session2Value.trip = observedTrip(session2Value.trip, session2Value.messages)
      }
      return session2Value
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
}
export function session(id: string): Session {
  const result = db.prepare('SELECT value FROM sessions WHERE id=?').get(id) as any
  if (!result) {
    throw new Error('会话不存在')
  }
  const session3Value = JSON.parse(result.value)
  if (session3Value.trip) {
    session3Value.trip = observedTrip(session3Value.trip, session3Value.messages)
  }
  return session3Value
}
export function saveSession(session4Value: Session) {
  session4Value.updatedAt = Date.now()
  db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?)').run(
    session4Value.id,
    JSON.stringify(redactData(session4Value, secretValues())),
  )
}
export function deleteSession(id: string) {
  db.prepare('DELETE FROM sessions WHERE id=?').run(id)
}
export function redact(text: string) {
  return redactText(text, secretValues())
}
export function secretValues() {
  return [...Object.values(demoConfig.secrets), ...secrets.values()].filter(Boolean)
}
export function account(): LocalAccount | null {
  return get('account')?.username === demoConfig.account.username
    ? {
        username: demoConfig.account.username,
        displayName: demoConfig.account.displayName,
        kind: 'demo',
      }
    : null
}
export async function login(username: string, password: string): Promise<LocalAccount> {
  const value = verifyDemoAccount(username, password)
  await saveSettings({ profile: demoConfig.profile, secrets: demoConfig.secrets })
  put('account', value)
  return value
}
export function logout() {
  put('account', null)
}
