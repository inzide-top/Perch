# Agent Seek Employment — 技术设计（MVP v1）

## 1. 技术选型

选择原则：优先使用熟悉的 Vue 和 TypeScript；后端足够薄；先可观察、可验证，再引入框架和复杂基础设施。

| 层           | 选择                                           | 原因                                                           |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------- |
| 前端         | Vue 3 + Vite + TypeScript + Vue Router + Pinia | 与现有经验一致，降低框架学习成本                               |
| UI           | Tailwind CSS + 组件库（按项目启动时选定）      | 可用 AI 快速生成布局，保留统一样式系统                         |
| 后端         | Node.js + TypeScript + Hono                    | 轻量 HTTP API，前后端同语言，适合 Serverless 部署              |
| 数据库       | Supabase Postgres                              | 有可视化控制台、SQL Editor、后续可加 Storage / Auth / pgvector |
| 数据访问     | 后端使用 Supabase JS Client；首版不引入 ORM    | 降低新概念数量；Schema 通过 SQL 文件维护                       |
| 结构校验     | Zod                                            | 校验 API 输入和 LLM JSON 输出                                  |
| 模型接入     | 可配置的 LLM Provider Adapter                  | API Key 永不放到浏览器；可在后端切换兼容服务                   |
| 流式输出     | Server-Sent Events（后期）                     | 先完成普通请求；聊天/出题体验后再加流式                        |
| 部署（后期） | Vercel（Web/API）+ Supabase                    | 适合个人作品集；本地完成后再部署                               |

不在第一版使用 LangChain 或 LangGraph。所有流程先用显式 TypeScript 函数实现；当出现复杂分支、暂停恢复、并行任务时再评估引入图工作流框架。

## 2. 建议目录

```text
agent-seek-employment/
├── apps/
│   ├── web/                 # Vue 3 + Vite
│   └── api/                 # Hono API
├── packages/
│   └── shared/              # TypeScript 类型、Zod schema、常量
├── supabase/
│   └── migrations/          # 建表 SQL
├── docs/
└── README.md
```

如果 Monorepo 在第一天造成负担，也可先使用 `web/` 与 `api/` 两个目录；不要为了目录形式引入 Turborepo 等额外工具。

## 3. 运行架构

```text
Vue Web App
  │  HTTP
  ▼
Hono API（身份、校验、Agent 编排、权限）
  ├── Supabase Postgres
  ├── LLM Provider Adapter
  └── Internal Tool Registry
          ├── ResumeRepository
          ├── OpportunityRepository
          ├── CapabilityRepository
          └── AgentRunRepository
```

MVP 不需要 CLI 作为用户入口，也不需要常驻 Agent daemon。网页请求由后端执行；耗时分析先显示 `pending/running/succeeded/failed` 状态。未来的批量分析才考虑队列与 Worker。

## 4. 数据模型

### 4.1 六个核心业务对象

1. **Resume**：一份独立简历主线。
2. **ResumeVersion**：主线中的一个不可变版本快照；仅可线性追加。
3. **Opportunity**：一个公司和岗位，固定引用一个简历版本。
4. **JobAnalysis**：一次 JD + 简历版本的分析快照。
5. **CapabilityItem**：跨基础面/项目面可复用的能力画像与证据。
6. **InterviewSession / InterviewTurn**：一轮模拟面试及其逐题问答。

### 4.2 支持对象

- `agent_runs`：一次 Agent 工作流；
- `agent_run_steps`：工作流中的每一步；
- `strategy_signals`：每份 JD 产生的已归一化能力信号；
- `strategy_recommendations`：跨 JD 聚合后的建议快照。

### 4.3 关键字段（概念 Schema）

```text
resumes
  id, title, target_direction, created_at, updated_at

resume_versions
  id, resume_id, version_no, parent_version_id,
  content_json, raw_text, change_note, diff_summary_json,
  summary_status, ai_summary_json, created_at

opportunities
  id, company_name, role_name, jd_raw_text,
  resume_version_id, status, priority, location, salary_range,
  latest_analysis_id, created_at, updated_at

job_analyses
  id, opportunity_id, resume_version_id, status,
  requirement_items_json, match_score, strengths_json, gaps_json,
  role_risks_json, interview_prep_json, prompt_version, created_at

capability_items
  id, normalized_key, title, category, mastery_level,
  strengths_json, gaps_json, evidence_json, status, updated_at

interview_sessions
  id, opportunity_id, job_analysis_id, type, status,
  plan_json, overall_evaluation_json, summary_json,
  started_at, ended_at

interview_turns
  id, session_id, sequence_no, question, question_rationale,
  user_answer, follow_up_question, evaluation_json,
  capability_links_json, created_at
```

`content_json`、`requirement_items_json` 等 JSON 字段在 MVP 允许使用，但关键查询字段（ID、状态、时间、分数）必须独立成列。以后高频筛选的数据再正规化为关联表。

## 5. Prompt 设计与结构化输出

### 5.1 Prompt 切分

不要用一个超长 Prompt 同时完成理解 JD、比较简历、出题、评分和策略建议。

| Prompt                  | 输入                                     | 强制输出                         |
| ----------------------- | ---------------------------------------- | -------------------------------- |
| `extract_requirements`  | JD 原文                                  | `RequirementItem[]`              |
| `match_resume_evidence` | 需求项 + 简历版本                        | 匹配证据、缺口、置信度           |
| `plan_interview`        | JD 分析 + 简历项目 + 能力画像 + 会话类型 | 下一题、理由、追问方向           |
| `evaluate_answer`       | 当前题、回答、会话目标                   | 分数、证据、建议、能力项变更建议 |
| `aggregate_strategy`    | 聚合后的能力信号                         | Top 建议、来源、行动类型         |

每个 Prompt 都要有：版本号、系统目标、输入 JSON、输出 Zod Schema、禁止事项、至少两份验收样例。

### 5.2 RequirementItem 最小 Schema

```ts
type RequirementItem = {
  rawRequirement: string
  normalizedCapability: string
  category: 'technical' | 'business' | 'project' | 'communication'
  requirementStrength: 'core' | 'important' | 'preferred' | 'uncertain'
  sourceSection: 'responsibility' | 'requirement' | 'bonus' | 'unknown'
  sourceQuote: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}
```

岗位要求强度和候选人能力强度必须分开。对中文含糊措辞保留 `uncertain` 与低置信度，前端展示依据，避免伪精确。

## 6. Agent 工具与 Adapter

### 6.1 内部工具

第一版工具不是第三方 MCP，而是服务端定义的、受校验的业务函数：

```text
get_resume_version(versionId)
get_opportunity_context(opportunityId)
get_relevant_capabilities(query, opportunityId)
create_job_analysis(payload)
create_interview_turn(payload)
propose_capability_update(payload)
```

每个工具都有输入 Schema、输出 Schema、权限级别、错误码和审计记录。模型只能请求调用；服务端负责校验和执行。

### 6.2 Adapter

Adapter 是隔离具体实现的转接层。上层只依赖 `ResumeRepository.getVersion()`，不会直接依赖 LocalStorage 或 Supabase。未来替换数据源、模型供应商或日历服务时，Agent 工作流不需要重写。

```text
ResumeRepository 接口
  ├── LocalResumeAdapter（本地开发 / mock）
  └── SupabaseResumeAdapter（正式数据）

LLMProvider 接口
  ├── ProviderAAdapter
  └── ProviderBAdapter
```

## 7. 记忆、RAG 与向量化

### 7.1 MVP 的记忆

| 层级           | 数据                           | 用法                 |
| -------------- | ------------------------------ | -------------------- |
| 当前轮         | 当前问题与回答                 | 评分和追问           |
| 会话级         | 最近 1–3 题、会话计划          | 避免重复提问         |
| 长期结构化记忆 | 能力项、证据、薄弱点、会话总结 | 跨基础面/项目面复用  |
| 版本历史       | 简历版本、diff、旧分析摘要     | 新版本分析时按需参考 |

不把所有历史对话原文送给模型。旧会话结束后压缩为结构化总结，原始记录保留在数据库。

### 7.2 RAG 与向量化的边界

简历、岗位、能力项本身是结构化数据，MVP 应优先用确定性的数据库查询，而不是为了“用了 RAG”强行加向量库。

第二阶段可新增 `knowledge_documents` 与 `document_chunks`：用户上传项目复盘、面试笔记、README 等非结构化资料；服务端切块、生成 embedding 并存入 pgvector。面试出题或回答问题时，先按机会/简历过滤，再语义检索 Top-K 文本块。

RAG 检索结果必须展示来源：文档名、片段、相似度或引用理由。

## 8. Agent Run、失败处理与权限

### 8.1 可观测性

每个工作流创建 `agent_run`；每个阶段创建 `agent_run_step`，记录：

- run 类型、对象 ID、状态、开始/结束时间；
- Prompt 名称和版本、输入摘要、模型响应摘要；
- 工具调用参数摘要、结果、耗时；
- token / 成本（供应商可提供时）；
- 解析错误、重试次数和最终错误码。

开发者调试页可以审计历史，不保证模型重新执行后逐字一致。

### 8.2 失败策略

| 情况                  | 策略                                                      |
| --------------------- | --------------------------------------------------------- |
| LLM 输出不符合 Schema | 最多一次修复请求；仍失败则标记失败并保留原始输出供调试    |
| 可重试网络错误        | 指数退避，最多两次                                        |
| 数据不存在 / 参数非法 | 不重试；返回业务错误并提示用户                            |
| 单个工具失败          | 记录结构化错误，工作流按降级策略继续或结束，不让 API 崩溃 |

### 8.3 权限

- 只读工具可自动调用。
- 用户点击“生成分析”“提交回答”已代表对本次生成和保存的确认。
- 删除、覆盖、不可恢复写入必须由 UI 二次确认。
- 长期能力画像的改变以“建议卡”让用户接受、编辑或忽略。
- API Key 只保存在后端环境变量，不传给浏览器、不写入数据库日志。

## 9. MCP 预留，不纳入 MVP

内部 Tool Registry 应以统一 Schema 表达，未来可增加 MCP Client Adapter。第二阶段最有价值的是只读 GitHub：获取用户授权仓库的 README、项目描述和技术证据；其次是只读 Drive/Notion 文档库。不要优先连接拥有写权限的外部工具。
