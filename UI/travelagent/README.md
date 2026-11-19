# JARVIS 旅行助手

TravelAgent 是使用 DeepSeek 的本地桌面旅行规划 Agent。以聊天为主，提供行程地图、预算、文件工具和 12306、滴滴、酒店及航班查询。应用基于 Electron Forge、React、LangChain、LangGraph、Tailwind CSS 和 shadcn/ui。

## 开发环境

- Node.js 26.13.0；版本记录在 `.nvmrc` 和 `package.json`。
- pnpm 12.17.0 或兼容的 pnpm 12 版本。
- Electron 45.2.3 使用自己的 Node.js 运行时，与本机用于安装和构建的 Node.js 分开。

```powershell
nvm install 26.13.0
nvm use 26.13.0
npm install --global pnpm@12.17.0
pnpm install
pnpm start
```

## 使用功能

### 聊天与规划

Agent 使用 LangGraph 管理模型和工具调用，可在生成期间停止。需要澄清时会在聊天中呈现问题，支持选择、填写或跳过。消息可以编辑重发、复制或反馈；处理过程展示行动说明、工具记录、审批和模型耗时。

规划可按需查询跨城交通、住宿、地点和市内路线，再发布行程。票价区分真实查询、估算和未知；缺少金额时不当作零元。上下文指示器展示最近请求的 Token 用量及模型窗口占比。

### 工作区与文件

新对话默认使用内置工作区，也可从设置中登记本机文件夹。工作区绑定到会话，文件工具、命令默认目录和会话顶栏的文件夹按钮使用同一路径。移除自定义工作区只会取消登记，不删除目录或更改已有会话路径。

聊天支持添加文件、粘贴图片及仅发送附件。附件由主进程校验并保存在本机；图片可预览，文本文件以有界内容提供给模型，未解析的二进制文件不会冒充文本。

### 地图与行程

地图支持按天查看行程地点、编号、时间与说明，并可在地图和列表间定位。地图只绘制有效的 GCJ-02 坐标；没有真实道路轨迹时不会用地点连线表示路线。无高德 JS Key 时可使用静态地图预览。

若规划需要当前出发地且用户没有提供，Agent 可请求设备定位。Windows 优先使用系统定位服务，浏览器定位仅在系统服务不可用时作为后备；拒绝或取消后不会换渠道重试，也不会后台跟踪位置。

## 外部服务

按需在设置中配置 DeepSeek、高德或 MCP 服务。对话、命令审查、网页工具和听写共用当前生效的 DeepSeek API Key。设置不提供其他模型服务、协议、自定义请求头或独立审查模型。模型目录和思考强度从 DeepSeek 官方接口读取。

高德配置项：

- Web 服务 Key：地点检索、路线及地址解析。
- JS Key 与安全密钥：交互地图；缺少时可回退为静态预览。

MCP 查询服务：

- **12306 内置工具**：直接使用官方站点和余票接口，不依赖用户安装 Node.js 或 npx。支持北京时间、车站与城市、直达余票、中转和经停查询。站点范围区分 `auto`、`exact`、`city`；中转会校验日期、历时、等待时间及跨站信息。最多读取三页并去重，未完成搜索时会明确标记，接口错误不会被解释为无票。票价只采用接口返回值，不提供购票或下单。
- **滴滴**：在设置 → MCP 服务中配置官方 MCP API Key。仅开放地点、路线、价格估算和用户要求的已有订单查询；创建或取消订单、生成打车链接及未知操作均会被拒绝。估价不代表已叫车或最终车费。
- **RollingGo 酒店**：通过官方 MCP 查询酒店搜索、详情、标签与静态信息。连接失败或维护不会被解释为无库存；不开放创建订单、支付或订单变更。
- **飞猪与美团酒旅**：从 JARVIS-TG 根目录运行 `scripts/desktop.ps1`，桌面端会通过本机 JARVIS-TG 服务并行查询两个平台。复用网页版服务配置中的平台密钥，无日期时查具体酒店名单，日期齐全时查对应报价。
- **VariFlight Aviation**：通过官方 MCP 查询航班动态、直飞与中转、飞机位置、机场天气及票价等信息。不开放交易操作；业务查询可能消耗供应商额度。

外部服务未配置、连接失败或维护时会显示可操作的提示，不以演示数据代替查询结果。当前版本不提供购票、支付或云同步。

## 本地数据与账户

应用数据库、附件、备份和诊断日志位于用户主目录下的 `.travelagent`：

- `travelagent.sqlite`：设置、会话及本机状态。
- `attachments/`、`backups/` 和日志文件：本机附件、文件恢复副本及诊断数据。

Windows 默认工作区为 `E:\JARVIS-Workspace`。E 盘不可用时使用 `.travelagent/workspace`。已有对话保留原工作区。

密钥申请、表单填写和连接测试见「设置 → 接入教程」。

Electron 自身的渲染器缓存和配置仍由 Electron 管理。密钥使用系统安全存储加密后保存在本机数据库；会话、工具记录、模型历史和日志会脱敏已配置密钥。应用不会将会话或密钥同步到云端。

本地演示账户为 `admin` / `123456`。点击左下角头像登录；登录状态保存在本机，支持退出，不提供注册、云端认证或同步。演示账号用于展示账户交互，不承担本地数据访问控制。代码预设位于 `src/demo-config.ts`；本机自定义密钥覆盖单独加密保存。账号接管的密钥不能在设置中编辑或删除，界面只显示来源和掩码。

## 开发、检查与构建

常用命令：

```powershell
pnpm format        # 格式化
pnpm format:check  # 检查格式
pnpm lint          # Oxlint 静态检查（警告也会失败）
pnpm typecheck     # TypeScript 检查
pnpm test          # 单元测试
pnpm check         # 格式、lint、类型和测试
```

本地功能场景检查使用模拟模型，覆盖审批、取消、超时、恢复、长循环和工作区行为；命令与文件操作会实际执行：

```powershell
pnpm start -- --functional-check
```

也可将 `--functional-check` 传给便携版检查打包运行环境。检查期间请关闭其他应用实例；结果写入项目目录 `.local/functional-check.json`，任一场景失败时返回非零退出码。

真实服务集成验证会调用已配置的供应商接口，可能消耗额度：

```powershell
pnpm verify
```

无密钥结果写入 `.travelagent/verification.json`。账户预设的隔离检查使用 `pnpm verify:account`。不要将生成的验证结果或本地数据目录提交到仓库。

打包命令：

```powershell
pnpm package
pnpm make
pnpm verify:package
pwsh -File scripts/zip.ps1
```

`pnpm package` 生成应用目录；`pnpm make` 生成 Squirrel.Windows 安装程序。`scripts/zip.ps1` 将便携应用目录打包为 ZIP，兼容 Node.js 26。

## 代码结构

- `src/main.ts`：Electron 启动和窗口生命周期；`src/backend/ipc.ts`：带来源校验的 IPC；`src/backend/map-server.ts`：隔离地图页面与本机代理。
- `src/backend/agent.ts`：Agent 执行；`agent-graph.ts`：LangGraph 流程；`command-review.ts`：命令审查与审批；`deepseek-model.ts`：DeepSeek 模型创建。
- `src/renderer/main.tsx`：React 入口；`app.tsx`：面板布局；`hooks/use-travel-app.ts`：会话和界面状态。
- `src/renderer/components/`：按 `layout`、`chat`、`sidebar`、`composer`、`settings`、`workbench` 拆分业务组件；`ui` 存放共享组件。
- `src/renderer/lib/session-events.ts`：流式会话事件状态更新；相关纯逻辑由 `tests/` 覆盖。

界面使用 Tailwind 和 shadcn 组件变体；`styles.css` 集中主题、基础规则与公共动画。格式化和静态检查配置位于 `.oxfmtrc.json`、`.oxlintrc.json`，编辑器换行与缩进由 `.editorconfig` 管理。

## 第三方来源

内置 12306 实现参考 [Joooook/12306-mcp](https://github.com/Joooook/12306-mcp)，在应用进程内运行。来源与 MIT 许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
