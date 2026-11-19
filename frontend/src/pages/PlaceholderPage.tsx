import { Card, Empty, Typography } from 'antd'

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <><Typography.Title level={2}>{title}</Typography.Title><Card><Empty description={description} /></Card></>
}

