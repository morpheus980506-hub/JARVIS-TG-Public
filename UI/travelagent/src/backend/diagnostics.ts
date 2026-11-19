import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

/** File-only diagnostics remain usable after the launcher's stdout/stderr pipes close. */
export function createDiagnosticLogger(file: () => string, redact: (value: string) => string) {
  return (...values: unknown[]) => {
    try {
      const target = file()
      mkdirSync(path.dirname(target), { recursive: true })
      if ((statSync(target, { throwIfNoEntry: false })?.size ?? 0) >= 1024 * 1024) {
        renameSync(target, `${target}.previous`)
      }
      appendFileSync(target, `${new Date().toISOString()} ${redact(format(...values))}\n`, 'utf8')
    } catch {
      // Diagnostics must never crash the app, including when its log directory is unavailable.
    }
  }
}
