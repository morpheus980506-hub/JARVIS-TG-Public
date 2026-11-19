import { z } from 'zod'
import { defineTool } from './agent-tools'
import { locateCurrentPosition } from './location'

export function createLocationTool(signal: AbortSignal, locate = locateCurrentPosition) {
  let request: ReturnType<typeof locate> | undefined
  return defineTool({
    description:
      '在规划需要当前出发地且用户未明确指定时，主动获取一次当前位置。优先 Windows 系统定位，不可用时使用浏览器 Geolocation；权限拒绝不切换渠道，失败后询问出发地。结果含来源、采集时间、精度、WGS84 与已转换的 GCJ-02 坐标和地址。每轮仅查询一次，不后台跟踪。',
    inputSchema: z.object({}),
    execute: () => {
      signal.throwIfAborted()
      request ??= locate(signal)
      return request
    },
  })
}
