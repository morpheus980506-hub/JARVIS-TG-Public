import path from 'node:path'
export function resolveFile(workspace: string, target: string) {
  return path.resolve(workspace, target)
}
export function mandatoryReview(command: string): string | null {
  if (
    /(?:format(?:\.com)?\s+[a-z]:|Clear-Disk|Initialize-Disk|Remove-Partition|diskpart|bcdedit|Disable-.*(?:Firewall|Defender)|Set-MpPreference.*Disable)/i.test(
      command,
    )
  ) {
    return '可能破坏磁盘、启动配置或系统保护设置'
  }
  if (
    /(?:Remove-Item|\brm\b|\brd\b|\brmdir\b|\bdel\b).*(?:[a-z]:\\(?:\*|Windows|Users)(?:\s|\\|$)|\$env:(?:USERPROFILE|SYSTEMROOT)|\$HOME)/i.test(
      command,
    )
  ) {
    return '删除范围涉及系统或用户目录，需人工核实'
  }
  return null
}
export function canExecute(decision: unknown): boolean {
  return decision === 'allow'
}
export function retryable(status: number) {
  return status === 408 || status === 429 || status >= 500
}
