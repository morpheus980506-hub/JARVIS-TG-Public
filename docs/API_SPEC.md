# API Specification

- `GET /api/v1/health`：模型和工具真实健康状态。工具项分别返回 `configured` 与 `healthy`，当前包括 Open-Meteo、和风天气、高德、Tavily 和飞常准 MCP。
- `GET /api/v1/agents`：Agent Registry 目录与能力。
- `GET /api/v1/config/map`：返回可公开的高德 JS Key 与安全代理地址，不返回安全密钥。
- `GET|POST /api/v1/_AMapService/{path}`：高德 JS API 安全代理（官方固定前缀），由后端附加 `jscode`。
- `POST /api/v1/trips/intake`：根据多轮对话收集旅行需求，返回下一条补问或可确认的结构化请求。
- `POST /api/v1/trips/intake/stream`：流式返回意图判断、联网检索、模型整理等可核验处理摘要，最后返回顾问回复或结构化补问。
- `POST /api/v1/trips/plan/stream`：以 NDJSON 流返回真实 Agent 阶段事件，最后返回完整旅行方案。
- `POST /api/v1/trips/plan`：运行端到端规划。
- `GET /api/v1/trips`：读取已保存方案。
- `GET /api/v1/trips/{trip_id}`：读取单个方案。
- `POST /api/v1/approvals`：创建 L1/L2/L3 授权请求。
- `POST /api/v1/approvals/{id}/decision`：批准或拒绝待处理请求。

关键字段缺失返回 422；依赖服务导致核心任务暂停返回 503。OpenAPI 交互文档由 FastAPI 在 `/docs` 自动生成。

