# JARVIS-TG 外部数据与交易接口调研

更新日期：2026-11-05

## 结论

JARVIS-TG 的竞赛版应优先接入高德、和风天气、Tavily 和飞常准 MCP。携程/Trip.com 与美团可先使用官方跳转交接或 Mock Provider，待合作申请获批后再启用真实交易 Adapter。铁路 12306 不应通过网页内部接口、抓包接口或模拟登录完成查询和购票；航旅纵横也不应在没有书面合作授权时调用非公开接口。

## 平台清单

| 平台 | 开放状态 | 可用于 JARVIS-TG 的能力 | 接入建议 |
| --- | --- | --- | --- |
| 高德开放平台 | 面向开发者开放 | POI、地理编码、路线规划、距离、天气、地图展示、MCP | P0，直接申请 Web 服务 Key；前端另建 JS API Key |
| 和风天气 | 面向开发者开放 | 实况、逐日/逐小时预报、预警、空气质量、生活指数 | P0，优先使用 JWT；MVP 可先用 API Key |
| Tavily | 面向开发者开放 | 联网搜索、网页提取、来源链接 | P0，使用 Bearer API Key |
| 飞常准 MCP | 登录后生成 MCP Key | 航班动态、票价、机场、个人行程、直达火车、余票、空铁联运 | P0/P1，作为航空与铁路“查询”主 Provider |
| 铁路 12306 | 未发现面向普通开发者的官方 OpenAPI | 官方网站/App 可查询和购票 | 不接内部接口；查询优先飞常准 MCP，购票跳转 12306 由用户完成 |
| 航旅纵横 | 存在面向合作方的 API/SDK 形态，但未发现自助式公开开发者文档 | 航班、行程、值机等 | 发送合作申请；获批前用飞常准 MCP，不逆向 App/网站 |
| 携程/Trip.com | 有开放/合作平台，数据与交易 API 多需商务合作 | 酒店、机票、火车、门票、用车、订单 | 先申请 Affiliate 做官方跳转；真实库存/下单需另申请合作 API |
| 美团/大众点评 | 美团按业务开放，接入需要合作申请；大众点评不再作为独立个人开放平台使用 | 到店餐饮、团购、门店、评价等特定业务能力 | 竞赛版采用高德 POI + Tavily 公开网页来源；申请美团合作后再接业务 API |

## 推荐架构

### 第一批真实接入

1. `AmapProvider`
   - `search_poi()`
   - `geocode()` / `reverse_geocode()`
   - `get_route()`
   - `get_distance()`
   - 后端使用 Web 服务 Key，前端地图使用独立 JS API Key 和安全密钥。

2. `QWeatherProvider`
   - `get_current_weather()`
   - `get_forecast()`
   - `get_alerts()`
   - 生产环境优先 JWT；凭据只保存在后端。

3. `TavilySearchProvider`
   - `search()`
   - `extract()`
   - 保存 URL、标题、发布时间、抓取时间和可信状态。

4. `VariFlightMcpProvider`
   - 航班列表与状态
   - 实时票价与机场信息
   - 直达火车、车次详情与余票
   - 空铁中转
   - 仅在用户授权后读取个人行程。

### 第二批合作接入

- `TripProvider`：携程/Trip.com 合作审批通过后接酒店、门票、用车或订单接口。
- `MeituanProvider`：按照餐饮、服务零售等具体业务申请，不将其当成通用点评搜索 API。
- `UmetripProvider`：仅在航旅纵横提供正式合同、文档和凭据后实现。

### 不可用时的降级

- 酒店：展示可核验的候选信息与官方/联盟跳转，不宣称实时房态。
- 餐饮：高德 POI 获取地点基础信息，Tavily 获取公开来源；评分和评价必须标注来源与抓取时间。
- 火车：飞常准 MCP 查询；购票、改签、退票全部交接铁路 12306。
- 飞机：飞常准 MCP 查询；购票跳转航司或合规 OTA。
- 所有未获真实交易权限的流程使用清晰标记的 Mock Provider，不生成虚假订单号。

## 官方申请入口

- 高德 Key：https://lbs.amap.com/api/webservice/create-project-and-key
- 高德 Web 服务：https://lbs.amap.com/api/webservice/summary
- 高德 MCP：https://developer.amap.com/api/mcp-server/gettingstarted
- 和风天气：https://dev.qweather.com/docs/start/
- Tavily Search：https://docs.tavily.com/documentation/api-reference/endpoint/search
- 飞常准 MCP：https://cmcp.variflight.com/
- 航旅纵横合作：https://www.umetrip.com/webStatic/about/contact.html
- 携程酒店合作平台：https://connect.trip.com/
- Trip.com Affiliate：https://www.trip.com/partners/index
- 携程玩乐开放平台：https://ttdopen.ctrip.com/apiplatform/help-new.do
- 美团生态开放平台：https://openapi.meituan.com/
- 美团技术服务合作中心：https://developer.meituan.com/
- 铁路 12306：https://www.12306.cn/

## 需要用户申请的凭据

建议按以下顺序申请，申请完成后只写入本机 `.env`，不要发送到公开聊天、前端代码或 Git 仓库：

1. `AMAP_WEB_SERVICE_KEY`
2. `AMAP_JS_API_KEY` 与 `AMAP_JS_SECURITY_CODE`
3. 和风天气项目凭据与独立 API Host
4. `TAVILY_API_KEY`
5. `VARIFLIGHT_MCP_KEY`
6. 携程/Trip.com、美团、航旅纵横合作方凭据（审批后）

## 合规边界

- 不调用 12306、携程、航旅纵横、大众点评网站或 App 的未公开内部接口。
- 不绕过验证码、登录验证、风控、人脸识别或设备校验。
- 不保存铁路、航空或 OTA 账户密码。
- 不自动付款；创建、取消、改签等交易必须经过 Approval Manager 和 Transaction Manager。
- 第三方信息必须保留来源、获取时间和是否实时核验的标识。
- 任何合作 API 的实际能力以审批后提供的合同、权限和文档为准。

## 调研依据

- 高德 Web 服务对开发者开放，并提供 POI、地理编码、路线规划、距离和天气等 HTTP API；高德同时提供 Streamable HTTP MCP Server。
- 和风天气支持 JWT 和 API Key，并为每个项目提供独立 API Host。
- Tavily 的 Search API 为 `POST https://api.tavily.com/search`，使用 Bearer 鉴权。
- 飞常准 MCP 官方页面列出航班动态、实时票价、个人行程、直达火车、余票和空铁中转等工具，并使用 Bearer MCP Key。
- 铁路 12306 官方公告说明其是唯一官方互联网票务渠道，且未授权第三方平台发售火车票和办理相关业务。
- 航旅纵横隐私声明提到供第三方使用的 SDK/API 形态，但公开站点未提供普通开发者可自助申请的接口文档；官方合作邮箱为 `umetrip@travelsky.com.cn`。
- Trip.com Affiliate 对个人与企业开放，提供链接、搜索框等交接工具；库存、订单等深度接口应以合作审批结果为准。
- 美团生态开放平台的公开接入流程包括申请合作、商务评估、确认方案、开发测试和上线运营。
