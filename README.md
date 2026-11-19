# JARVIS Travel Guider (JARVIS-TG)

> V0.8.0 — JARVIS Travel Guider

## 公开评审版

这是 V0.8.0 的脱敏源码副本，供评委查看和本机复现。仓库采用全新提交历史，不包含原私有仓库的历史、真实服务密钥、聊天记录、附件、数据库、日志或团队原始交付文件。

桌面端代码位于 [UI/travelagent](UI/travelagent)。首次运行请按其 README 安装 Node.js 26.13.0、pnpm 12 和依赖，再在应用「设置 → 接入教程」申请并填写自己的服务凭据。所有服务预置密钥均为空；公开源码不提供共享额度，未配置接口时不能复现真实供应商查询。桌面端 `admin / 123456` 仅为公开的本机演示登录，不是云端账户或安全边界。

网页版/后端的安装步骤见下文；两种客户端的模型调用与模拟数据行为不同。真实查询可能消耗使用者的供应商额度，测试记录不能替代当前账户的连接测试。发布范围和验证说明见 [公开版说明](docs/PUBLIC_RELEASE.md)。

当前版本为 `0.8.0`。本次核对团队交付与已发布 V0.7.0 的 411 个文件，确认内容一致，并统一网页端、后端、桌面端及旅行客户端版本。

JARVIS 支持聊天规划、平台候选查询、费用估算编辑、跨对话行程恢复，以及路线复核、天气更新和导出。预订在服务平台确认。此前版本的验证范围见 [V0.6 发布记录](docs/RELEASE_V06_PUBLIC.md) 和 [测试记录](docs/TEST_REPORT.md)。

JARVIS-TG 是面向中国国内旅行的多智能体规划与执行平台。当前竞赛 MVP 已实现：需求提取、并行天气/目的地研究、确定性预算、行程编排、独立验证、有限自循环、审批审计、执行轨迹和 React 控制台。

首页采用持久化对话式需求收集：允许用户先提供不完整信息，JARVIS 会逐项补问出发地、目的地、日期、天数、人数、预算和偏好；历史会话可恢复、切换和删除。用户确认后，通过流式接口按真实执行完成顺序反馈各 Agent 进度。

## 当前能力边界

- 天气链路优先使用和风天气，并以免密钥的 Open-Meteo 自动兜底；数据保存来源与获取时间。
- 高德提供 POI 与路线 Adapter，Tavily 提供带来源的联网研究，飞常准提供标准 MCP Adapter。
- 未配置相应凭据时，健康接口明确返回 `configured: false`；酒店候选会醒目标注为 Mock，其他候选也不会伪装成真实数据。
- 酒店页支持将模拟候选提交到 L2 授权中心；授权只记录用户决定，不会触发真实订单。
- 不执行真实预订、付款、取消或不可逆操作。L2/L3 操作必须先进入审批中心。
- DeepSeek 模型名不硬编码。配置 API Key 后，先通过 `/models` 核验账户可用模型，再填写 `DEEPSEEK_MODEL`。
- 一般聊天使用 `DEEPSEEK_FAST_MODEL=deepseek-flash` 且关闭 thinking，并以流式正文降低等待感；旅行咨询与正式规划保留深度推理。
- 无模型密钥时，确定性 Demo 仍可完整运行；它不会伪装成模型调用成功。

## 环境

- Python 3.12
- Node.js 20+，pnpm 10+
- Git

## 快速启动

团队桌面端位于 [UI/travelagent](UI/travelagent)。完成后端环境和[桌面依赖](UI/travelagent/README.md#开发环境)的安装后，在项目根目录运行：

```powershell
.\scripts\desktop.ps1
```

启动脚本会复用或启动本机 JARVIS-TG 后端，供桌面端查询飞猪和美团。桌面会话、附件和设置保存在本机 `~/.travelagent`。网页版历史仍可通过原网页版查看。

若需启动网页版，运行下列命令：

```powershell
Copy-Item .env.example .env
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
cd ..\frontend
pnpm install
cd ..
.\scripts\dev.ps1
```

打开：

- 前端：http://localhost:5173
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/v1/health

项目后端虚拟环境使用 Python 3.12；`pyproject.toml` 将运行范围固定为 `>=3.12,<3.13`。

## 外部服务配置

复制 `.env.example` 后可逐项填写：

- `AMAP_API_KEY`：高德 Web 服务 Key，用于后端 POI 和路线。
- `AMAP_JS_API_KEY` 与 `AMAP_JS_SECURITY_CODE`：前端地图凭据；安全密钥仅由后端代理使用，不写入 `VITE_*` 或前端源码。
- `QWEATHER_API_KEY` 与 `QWEATHER_API_HOST`：和风天气凭据及控制台分配的独立 Host。
- `TAVILY_API_KEY`：联网旅游研究。
- `VARIFLIGHT_MCP_KEY`：飞常准航班、票价、铁路与空铁联运工具。

密钥缺失不会阻止应用启动。`GET /api/v1/health` 会分别报告每个 Provider 是否已配置、是否健康。申请入口和合规边界见 `docs/API_PROVIDER_RESEARCH.md`。

## 端到端 API 示例

```powershell
$body = @{ text = '11月20日从兰州出发，去成都玩4天，两个人，预算3500元。'; allow_mock = $true } | ConvertTo-Json
Invoke-RestMethod http://localhost:8000/api/v1/trips/plan -Method Post -ContentType 'application/json' -Body $body
```

## 测试

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
pnpm build
```

## 目录

- `backend/app/orchestrator`：Router、DAG 调度与有限 Self-Loop
- `backend/app/agents`：独立 Agent 与 Registry
- `backend/app/models`：DeepSeek API 模型调用、流式回复和云端重试
- `backend/app/tools`：高德、和风天气、Open-Meteo、Tavily 与飞常准 MCP Adapter
- `backend/app/approval`：Human-in-the-Loop 审批
- `frontend`：12 个产品入口及可视化控制台
- `docs`：架构、API、安全、Demo 与开发计划

## 安全

不要提交 `.env`。API Key 只存在后端环境变量中。支付敏感信息（包括 CVV）不得保存。详细规则见 `docs/SECURITY.md`。

