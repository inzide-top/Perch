# PERCH — 技术设计（当前实现与后续边界）

> 本文优先描述当前代码真实具备的能力；明确标为“后续”的内容不应被当作已实现功能。

## 1. 技术选型

| 层   | 当前选择                                   | 作用                                       |
| ---- | ------------------------------------------ | ------------------------------------------ |
| Web  | Vue 3、Vite、TypeScript、Vue Router、Pinia | 工作台页面、路由、前端状态与详情缓存       |
| UI   | Nuxt UI、Tailwind CSS                      | 表单、抽屉、弹窗、骨架屏和主题系统         |
| API  | Fastify                                    | HTTP 路由、输入校验、业务编排和错误返回    |
| 数据 | Supabase PostgreSQL                        | 简历、岗位、分析、运行记录和流程数据       |
| ORM  | Drizzle ORM + postgres driver              | TypeScript Schema、迁移、Repository 查询   |
| 校验 | Zod                                        | API 输入和模型结构化输出校验               |
| 模型 | OpenAI Chat Completions 兼容接口           | 当前支持由设置页传入 URL、模型名和 API Key |

当前不引入 LangChain / LangGraph。JD 分析先由显式 TypeScript 工作流完成，等面试、工具调用、暂停恢复和并行分支确实变复杂后再评估图工作流框架。

## 2. 当前目录与职责

```text
src/
├── pages/                 # Vue 页面和页面级组件
├── stores/                # Pinia：简历、机会、设置和详情缓存
├── services/              # HTTP 客户端及 API DTO
├── shared/                # 前端复用的展示规则、地域映射
└── types/                 # 领域类型

server/src/
├── routes/                # Fastify 路由
├── services/              # 业务工作流与 Prompt
│   └── ai/                 # 共享模型调用、错误分类与取消边界
├── repositories/          # Drizzle 数据访问与事务
├── schemas/               # Zod API 输入 Schema
├── context/               # 当前用户等请求上下文边界
└── db/                    # Drizzle client 与表 Schema

server/drizzle/            # 已执行过的历史迁移；只能新增，不能改旧文件
docs/                      # PRD、技术设计、开发计划与开源素材
```

## 3. 当前运行架构

```text
Vue Web App
  │ HTTP
  ▼
Fastify API
  ├── Zod：校验请求与模型 JSON
  ├── Services：JD 分析、重试、重复检查、状态流转
  ├── Repositories：Drizzle 事务与查询
  ├── Supabase PostgreSQL
  └── OpenAI-compatible LLM API
```

JD 分析是 API 内的异步业务任务：创建后立即返回 `pending`，服务端将任务转为 `processing` 并调用模型；前端只轮询分析进度，不会在列表请求中携带完整分析 JSON。

## 4. 当前核心数据关系

```text
Resume 1 ─── N ResumeVersion
                 │
                 └── JobAnalysis N ─── 1 JobOpportunity
                                      │
                                      ├── N AgentRun
                                      ├── N InterviewRound（真实流程记录）
                                      ├── 0..1 WrittenTestReview
                                      └── 0..1 OpportunityTermination
```

### Resume 与 ResumeVersion

- `Resume` 保存简历主线：标题、当前版本 ID、创建/更新时间。
- `ResumeVersion` 保存完整不可变内容快照和 diff 摘要。
- 只有有效文本变化才创建新版本；纯空格、换行、标点变化更新当前版本而不制造版本噪音。

### JobOpportunity 与 JobAnalysis

- `JobOpportunity` 保存 JD 原文、流程状态、意向、行业、笔试开关和备注。
- `JobAnalysis` 保存当前有效的“JD + 指定 ResumeVersion”结构化分析结果。
- 用户主动重新分析会更新当前结果；每一次模型尝试仍以 `AgentRun` 保留，便于调试和审计。

### 精确重复 JD

创建机会时，后端对公司、岗位、城市、岗位介绍和岗位要求做规范化后生成 SHA-256 指纹：

```text
规范化内容 → dedupe_fingerprint → (user_id, dedupe_fingerprint) 唯一索引
```

规范化仅忽略空格、换行、标点、全半角和英文大小写，不做公司别名、错别字或语义相似度匹配。唯一索引同时承担查询加速和并发写入兜底：两个相同创建请求同时到达时，数据库最多允许一条记录写入。

## 5. JD 分析 Agent 工作流

```text
创建 / 重新分析
  → 创建 JobAnalysis + AgentRun（pending）
  → 调用模型（processing）
  → 提取 JSON
  → Zod 校验
  ├── 成功：写入 JobAnalysis.result，Run completed
  ├── 格式失败：携带 validationIssues 发起一次修复请求
  └── 网络/限流失败：最多重试两次，最终记录 failed
```

当前 Prompt 使用六个跨行业固定维度：

1. 核心要求匹配
2. 相关经验匹配
3. 资历深度匹配
4. 业务场景匹配
5. 加分项匹配
6. 岗位约束匹配

具体技能或行业名不会成为顶层固定字段，而进入 requirement、evidence、gap 或 suggestion。服务端根据最终分数固定推荐结论：0–29 不建议、30–59 谨慎投递、60–89 值得投递、90–100 强匹配。

## 6. 可观测性、缓存与轮询

`agent_runs` 已记录：模型名、Prompt 版本、受控业务输入、原始输出、解析结果、错误、Token、耗时、开始/结束时间和尝试次数。开发者可在独立的 AgentRun 调试台查看。

前端分析进度轮询：

- 0–45 秒：每 15 秒；45–75 秒：每 10 秒；之后：每 5 秒。
- 浏览器隐藏时统一降为每 30 秒；重新可见时立即刷新。
- 同一时刻全局只保留一个轮询请求，避免多个页面重复拉取。

### Egress 防护（P0）

后台任务轮询默认只返回状态摘要，不返回模型输入、原始输出、解析结果或完整会话：

- AgentRun 列表只读取运行元数据；点击调试记录后，详情接口才读取 `input`、`rawOutput` 和 `parsedOutput`。
- 后台任务状态接口只返回分析/深度点评的状态、尝试次数、错误摘要和时间；任务进入 `completed` 后，前端再发起一次详情请求。
- 模拟面试轮询使用 `/interview-sessions/:sessionId/status`，响应包含 `status`、`phase`、`stateVersion`、`currentTurnId`、`updatedAt` 和错误摘要。只有 `stateVersion` 变化才读取完整 Session。
- 权限校验使用 `id/userId` 投影，不为验证归属读取完整 JD。
- 设置 `API_METRICS_ENABLED=true` 后，服务端会记录接口响应字节数、数据库查询次数、关键读路径数据库耗时和总耗时；日志不记录模型输入、输出或 API Key。

这组改动解决的是“重复传输大 JSON”问题，不改变 AgentRun 的历史保存，也不引入缓存、Redis、队列或 SSE。详情页仍然可以按需查看完整数据。

机会详情缓存在 Pinia 中。缓存“存在”不代表“新鲜”：只有机会和分析的 `updatedAt` 未变化且缓存未超过 30 分钟，才跳过详情请求。

## 7. 本地模型配置与安全边界

当前为了便于本地测试，模型 URL、模型名与 API Key 保存在浏览器本地设置中，发起分析时临时传给本地 API；后端不会把 API Key、完整连接配置写入数据库或 AgentRun。

这不是生产级密钥方案。上线多用户版本前必须替换为：登录用户 → 服务端加密保存配置或服务端统一 Provider → 按用户授权调用。任何 README、演示或部署文档都必须明确这一点。

## 8. 测试与质量门槛

### 真实面试安排与复盘

真实面试统一使用一条 `InterviewRound` 记录，不为“安排”和“复盘”分别建表：

- `planned`：未来或待进行的安排，`result` 固定为 `pending`；
- `completed`：已经发生的面试，`result` 为 `passed / failed / unknown`，可以继续补充复盘；
- `canceled`：取消的安排，`result` 固定为 `unknown`。

普通 `PATCH` 只编辑轮次资料；`complete` 与 `cancel` 使用独立动作接口，并在事务中以 `planned` 作为条件更新，防止并发点击重复流转。机会终止时，剩余的 `planned` 轮次会在同一事务中统一取消。

安排备注和复盘原文严格分开：`note` 只描述时间、方式和准备事项，不会进入模型上下文；只有 `completed` 轮次的 `reviewNote` 或已完成结构化提取结果，才允许进入下一次模拟面试的历史复盘输入。迁移 `0016_normalize_interview_round_states.sql` 会把旧版的 `passed / failed` 状态以及历史复盘记录回填为 `completed`，避免旧数据被误判成未来安排；迁移 `0017_migrate_legacy_interview_review_notes.sql` 再将旧表单写入 `note` 的复盘正文搬到 `review_note`，并明确排除机会终止原因。

当前提供少量高价值核心测试：

- JD 指纹规范化与差异输入；
- 分数到推荐结论的边界；
- 固定评分维度展示文案；
- 模型 JSON 解析；
- Zod 校验失败后修复 Prompt 所需的错误上下文；
- 模拟面试的预算、状态机、幂等、取消/恢复与历史薄弱项聚合；
- 真实复盘文本切块、原文引用 offset、结构化提取重试与不可重试错误；
- 首页能力证据、历史薄弱项和完全空数据时的稳定聚合结果；
- 数据库时间格式转为前端可消费的 ISO 时间。
- 面试轮次状态与结果组合、普通编辑禁止状态流转、安排备注不进入模型历史。

前端的主题、骨架屏、局部错误、图表和抽屉交互目前采用人工验收，避免为了验证纯样式引入一套重量级浏览器测试基础设施。每次页面改动仍需执行对应的空数据、接口失败、刷新和深色模式验收。

执行：

```bash
pnpm test:core
pnpm lint
pnpm typecheck
pnpm typecheck:server
pnpm build
```

最近一次收尾验收还覆盖了：

- 简历版本选择标签在深色模式下保持可读；
- 机会接口失败时保留页面标题与筛选项，只在列表区域展示错误和重试；
- 模型配置的可复用标签去除额外阴影，选中态在浅色/深色主题下都有足够对比度；
- 首页求职流程和 JD 匹配环形图继续使用 ECharts，空数据不会绘制伪造分段；
- 复盘重试入口位于内容顶部，时间统一显示为年月日格式。

## 9. 当前已实现模块与后续边界

本节同时记录已经落地的模块和明确延后的设计。标注为“第一版”的内容属于当前代码；标注为“后续”或“明确不做”的内容不能在 README 中描述为已完成。

### 模拟面试

模拟面试已经建立 `InterviewSession`、`InterviewTurn`、Turn Interaction、回答证据、总体评价、最终复盘引用、深度点评和反馈的数据基础，并将 AgentRun 扩展为通用执行记录。面试计划、首题生成、回答分类、证据提取、追问决策、失败重试、主动中止、整场复盘和题次引用已经接入真实模型，详见 `06-mock-interview-backend-foundation.md`。

首页能力证据摘要也已经接入：它按模拟面试和真实笔试/面试复盘的来源数量标记 `empty`、`partial`、`sufficient`，并分别输出优势、待补强项、历史薄弱项、求职流程分布、JD 匹配分布和最近动态。

### 能力画像第一版（只读聚合）

能力画像页面位于 `/strategy`，当前只做证据聚合，不新增 AI 分析链路，也不新增数据库表：

- `GET /api/capability-profile?resumeId={id}` 是只读接口；不传 `resumeId` 时选择最近更新的简历主线。
- 当前简历版本的 `skills` 与 `projects` 原样展示为“简历声明”，不把自述直接标记为已验证能力。
- 只读取该简历主线下已有的 `job_analyses` 和已结束且具备结构化评估的 `interview_sessions`；进行中、失败或没有评估快照的任务不进入能力结论。
- 每条 JD 信号保留公司、岗位、机会状态、分析模型、来源 `resumeVersionId`/版本号和优势/待补强/简历建议；旧版本只标记为“基于 Vx”，不会覆盖当前版本。
- 模拟面试优势、待补强和历史薄弱项复用现有的结构化 `TopicEvaluation` 聚合规则，不产生新的统一总分；历史面试仍可通过 `opportunityId/sessionId` 回到原详情。
- 多份简历按主线隔离，切换下拉选项会重新查询，避免把不同目标方向的证据混在一起。
- 页面具备首次加载骨架、无简历空态、分区空态、局部错误和后台刷新态；刷新期间保留已有内容，避免整页闪动。

第一版明确不做：跨来源语义归一化、能力画像专属 AI 总结、自动把简历字段转换成能力项、每日定时刷新和外部岗位搜索。这些能力可以在真实数据量和产品边界稳定后单独设计。

### 行动策略第一版（规则优先、AI 文案可选）

行动策略位于 `/strategy/actions`，与 `/strategy` 能力画像并列。第一版不把求职建议全部交给模型，而是先由服务端根据确定性事实生成候选行动：机会状态、意向等级、已完成 JD 匹配度、面试/笔试安排、最近一次状态记录和历史薄弱项。规则结果即使没有模型配置、模型失败或任务仍在生成，也可以直接展示。

当前规则包括：即将到来的面试/笔试准备、过期安排补充完成记录、高意向且匹配度足够的投递推进、4～7 个工作日无进展的礼貌跟进、8～14 个工作日的停滞风险、超过 14 个工作日的降低优先级、失败分析重试和能力训练。工作日只排除周六日，不把节假日误判为确定事实；“可能停滞”只能作为建议，不能直接表述为已经淘汰。

模型只接收最多 10 条带 `A1...` 别名的行动候选和最多 5 条 `C1...` 能力候选，不接收 API Key、内部实体 ID、JD/简历全文或完整面试记录。模型输出必须引用已有别名；服务端用 Zod 和跨字段校验保证不能创建新行动、重复引用或遗漏紧急行动。AI 只生成标题、总结、原因和下一步文案，不得修改规则计算的优先级、状态和事实。

每次生成会创建 `action_strategy_snapshots` 和对应的 `agent_runs`（`workflowType=action_strategy`），最多重试三次。快照按确定性输入指纹、模型名称、Base URL 和 Prompt 版本缓存；同一用户最多一个行动策略任务同时执行，并纳入后台任务总容量。GET `/api/action-strategy` 只返回规则行动和当前 AI 快照状态，POST `/api/action-strategy/generate` 才主动调用模型。任务可由统一后台轮询恢复，页面离开后完成/失败仍会通过全局 Toast 通知。

第一版明确不做：每日八点批量刷新、自动投递或终止、外部招聘网站/MCP 搜索、跨 JD 的新能力推断和自动修改用户资料。后续如果需要扩大策略范围，应先增加确定性候选和验收样例，再扩展模型文案。

### RAG 与向量化

简历、JD 和结构化能力项不需要为了“用了 RAG”而进入向量库。只有用户上传多份项目复盘、README、面试笔记等非结构化材料，且普通数据库筛选无法定位证据时，再引入文档切块、embedding、pgvector 和带来源的检索展示。

### MCP 与外部工具

先保留接口边界，不接写权限工具。未来优先考虑只读 GitHub、Drive 或 Notion，用于补充项目证据；必须有授权、输入输出 Schema 与运行审计。
