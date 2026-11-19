import { homedir } from 'node:os'
import path from 'node:path'

let directory = path.join(homedir(), '.travelagent')
let isolated = false

export function dataPath(...parts: string[]) {
  return path.join(directory, ...parts)
}

export function useTestDataDirectory(root: string) {
  directory = root
  isolated = true
}

export function preferredWorkspacePath() {
  return process.platform === 'win32' && !isolated
    ? path.join('E:\\', 'JARVIS-Workspace')
    : dataPath('workspace')
}
