import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'

function GuideLink({ href, children }: { href: string; children: string }) {
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto w-fit px-0"
      onClick={() => api.openExternal(href)}
    >
      {children}
      <ExternalLink data-icon="inline-end" />
    </Button>
  )
}

export function ConnectionGuide({ openTab }: { openTab: (tab: string) => void }) {
  return (
    <div className="grid gap-4 text-sm leading-relaxed">
      <p className="text-muted-foreground">按需要配置服务。密钥请填到对应的设置表单里。</p>
      <Card>
        <CardHeader>
          <CardTitle>DeepSeek · 对话</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p>
            登录 DeepSeek 开放平台，创建并复制 API
            Key。打开「DeepSeek」，粘贴到密钥栏，点「验证并保存」。
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <GuideLink href="https://platform.deepseek.com/api_keys">创建 API Key</GuideLink>
            <Button size="sm" variant="outline" onClick={() => openTab('DeepSeek')}>
              配置 DeepSeek
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>高德地图 · 地点、路线和地图</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p>在高德开放平台「应用管理」创建应用。添加一个「Web 服务」Key，用于地点和路线查询。</p>
          <p>
            要显示交互地图，再添加一个「Web 端（JS
            API）」Key，把它和配套的安全密钥一起填入「旅行服务」，然后点「保存服务密钥」。
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <GuideLink href="https://lbs.amap.com/api/webservice/create-project-and-key">
              Web 服务申请
            </GuideLink>
            <GuideLink href="https://lbs.amap.com/api/javascript-api-v2/prerequisites">
              JS API 申请
            </GuideLink>
            <Button size="sm" variant="outline" onClick={() => openTab('旅行服务')}>
              配置高德
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>MCP · 火车、航班、打车和酒店</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p>
            12306 已内置。滴滴、飞常准 Aviation 和 RollingGo 的 Key 由各平台发放。打开「MCP
            服务」，找到对应卡片，点「保存密钥」，再点「测试查询连接」。
          </p>
          <p>
            其他 MCP 服务可按供应商文档添加。Streamable HTTP 填服务地址。stdio
            填启动命令和参数，每行一个参数。测试连接后，确认服务已勾选，再点「保存 MCP 配置」。
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <GuideLink href="https://mcp.didichuxing.com/">滴滴 MCP 控制台</GuideLink>
            <GuideLink href="https://ai.variflight.com/zh/docs/aviation">
              飞常准 Aviation 文档
            </GuideLink>
            <GuideLink href="https://partner.rollinggo.cn">RollingGo 合作伙伴平台</GuideLink>
            <Button size="sm" variant="outline" onClick={() => openTab('MCP 服务')}>
              配置 MCP
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>飞猪与美团 · 酒店比查</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p>
            在 JARVIS 网页版打开「设置与服务 → API 接口」。在飞猪卡片填入控制台提供的 API
            Key，在美团旅行卡片填入有旅行服务权限的 API Token。
          </p>
          <p>
            保存后，通过桌面快捷方式启动
            JARVIS，在聊天中请它查某个城市和日期的酒店，查看两家平台分别返回的候选。
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <GuideLink href="https://flyai.open.fliggy.com/console">飞猪开放平台</GuideLink>
            <GuideLink href="https://developer.meituan.com/zh/v2/dev/token">美团开放平台</GuideLink>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
