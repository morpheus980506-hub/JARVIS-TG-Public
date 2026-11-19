# Agent Specification

| Agent | 核心能力 | 当前实现 |
|---|---|---|
| Planner | 需求提取、DAG | 硬字段校验，不猜测关键交易信息 |
| Research | 目的地研究 | 候选数据明确 Mock，等待搜索 API |
| Budget | 预算核算 | Decimal 确定性分配与校验 |
| Itinerary | 日程编排 | 到达、主题日、返程的平衡模板 |
| Verifier | 独立验证 | 天数、预算、来源、天气规则 |

每次运行保存 Agent ID、状态、开始/结束时间、耗时、输入输出摘要、模型/工具来源、回退标志和错误。后续 Transport、Hotel、Mobility、Booking 与 Monitor 可按相同接口注册。

