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
├── services/              # 业务工作流、Prompt、模型客户端
├── repositories/          # Drizzle 数据访问与事务
├── schemas/               # Zod API 输入 Schema
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

机会详情缓存在 Pinia 中。缓存“存在”不代表“新鲜”：只有机会和分析的 `updatedAt` 未变化且缓存未超过 30 分钟，才跳过详情请求。

## 7. 本地模型配置与安全边界

当前为了便于本地测试，模型 URL、模型名与 API Key 保存在浏览器本地设置中，发起分析时临时传给本地 API；后端不会把 API Key、完整连接配置写入数据库或 AgentRun。

这不是生产级密钥方案。上线多用户版本前必须替换为：登录用户 → 服务端加密保存配置或服务端统一 Provider → 按用户授权调用。任何 README、演示或部署文档都必须明确这一点。

## 8. 测试与质量门槛

当前提供少量高价值核心测试：

- JD 指纹规范化与差异输入；
- 分数到推荐结论的边界；
- 固定评分维度展示文案；
- 模型 JSON 解析；
- Zod 校验失败后修复 Prompt 所需的错误上下文。

执行：

```bash
pnpm test:core
pnpm lint
pnpm typecheck
pnpm typecheck:server
pnpm build
```

## 9. 后续设计，不代表当前实现

### 模拟面试

下一阶段先建立 `InterviewSession`、`InterviewTurn`、`AnswerEvaluation` 和 `CapabilityEvidence`，再接入基础面出题、单题评分、追问和会话总结。

### RAG 与向量化

简历、JD 和结构化能力项不需要为了“用了 RAG”而进入向量库。只有用户上传多份项目复盘、README、面试笔记等非结构化材料，且普通数据库筛选无法定位证据时，再引入文档切块、embedding、pgvector 和带来源的检索展示。

### MCP 与外部工具

先保留接口边界，不接写权限工具。未来优先考虑只读 GitHub、Drive 或 Notion，用于补充项目证据；必须有授权、输入输出 Schema 与运行审计。
