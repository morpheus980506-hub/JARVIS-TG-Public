import { Tag } from 'antd'

const colors: Record<string, string> = {
  SUCCESS: 'green', PASS: 'green', RUNNING: 'blue', WARNING: 'gold',
  FAILED: 'red', FAIL: 'red', RETRY: 'orange', WAITING: 'default',
  WAITING_APPROVAL: 'purple',
}

export function StatusPill({ value }: { value: string }) {
  return <Tag color={colors[value] || 'default'}>{value}</Tag>
}

