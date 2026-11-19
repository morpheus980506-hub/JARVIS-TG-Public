# Architecture

## 请求链路

`User → FastAPI → Planner → DAG Scheduler → Research + Weather + Transport → Budget → Itinerary → Verifier → Persist → UI`

验证失败时只重跑受影响的 Itinerary 任务，最多 2 次。成功的天气、研究与预算结果保留。

## 边界

- Model Gateway：Provider 统一接口、并发上限、有限重试、指数退避、30 秒熔断、能力声明。
- Tool Gateway：每类外部服务独立 Adapter；当前真实链路包括和风天气/Open-Meteo、高德、Tavily 与飞常准 MCP。
- Agent Registry：按 capability 注册与匹配，不把 Agent 伪装成前端标签。
- Shared State：一次编排中的结构化状态，不依赖拼接聊天记录。
- Database：SQLAlchemy Async + SQLite；可通过 `DATABASE_URL` 切换 PostgreSQL。
- Approval Manager：L1 自动，L2/L3 等待明确确认；交易适配器尚未启用。

## Provider 恢复策略

主模型失败后执行有限重试。连续失败会短时打开熔断器。只有本地 Provider 健康且能力满足时才回退；否则任务明确暂停并返回 503。新任务在熔断恢复后重新优先尝试主模型。

