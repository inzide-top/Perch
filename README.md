<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./src/assets/brand/perch-mark-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./src/assets/brand/perch-mark-light.png">
    <img alt="PERCH logo" src="./src/assets/brand/perch-mark-light.png" width="112" height="112">
  </picture>

  <h1>PERCH</h1>

  <p><strong>AI Career Workspace · AI 求职工作台</strong></p>
  <p>把简历、岗位、JD 分析、面试准备和求职行动组织成一条可追踪、可复盘的工作流。</p>

  <p>
    <a href="https://github.com/inzide-top/web-seek-employ/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/inzide-top/web-seek-employ/actions/workflows/ci.yml/badge.svg"></a>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20.19-339933?logo=nodedotjs&logoColor=white">
    <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white">
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-5E83F5"></a>
  </p>

  <p>
    <a href="#features">功能</a> ·
    <a href="#architecture">架构</a> ·
    <a href="#quick-start">快速开始</a> ·
    <a href="#configuration">配置</a> ·
    <a href="#development">开发</a> ·
    <a href="#limitations">第一版边界</a>
  </p>
</div>

> **项目状态：第一版功能已收束，可用于本地求职管理与面试准备。**<br>
> 当前版本采用单用户、本地优先设计；如果要部署为面向公众的多用户服务，请先阅读[安全与部署边界](#security)。

<a id="why-perch"></a>

## 为什么做 PERCH

传统求职工具通常把简历、JD、面试记录和 AI 问答拆散在不同页面甚至不同产品中。PERCH 将这些信息放回同一条业务链路：

```mermaid
flowchart LR
  A[简历版本] --> B[岗位机会]
  B --> C[JD 匹配分析]
  C --> D[笔试 / 面试 / OC]
  D --> E[模拟面试与深度点评]
  E --> F[能力画像]
  F --> G[行动策略]
  H[PERCH AI 助手] -. 读取与操作 .-> B
  H -. 准备与复盘 .-> D
  H -. 历史记忆 .-> F
```

它不是只回答一次问题的聊天框。每条分析会绑定具体简历版本，每次 AI 执行都有状态和调试记录，数据修改工具需要经过业务校验，并可在必要时让用户确认。

<a id="features"></a>

## 功能概览

| 模块                 | 已实现能力                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 🧾 **简历管理**      | 多简历与版本链、主线简历、项目经历维护、PDF 文本提取与结构化导入、识别结果确认                                          |
| 🎯 **机会管理**      | 求职阶段流转、意向等级、笔试流程、面试安排与复盘、重复机会校验、列表筛选                                                |
| 🔍 **JD 分析**       | 指定简历版本匹配、结构化优势与风险、简历优化建议、异步生成、失败重试                                                    |
| 🌐 **岗位导入**      | 手动录入、单个或批量网址导入（最多 5 条）、长文本识别、审核工作台、城市规范化                                           |
| 🎙️ **模拟面试**      | 基础面 / 项目面、难度与规模配置、蓝图生成、流式问答、提示与跳题、评分、最终复盘与证据引用                               |
| ✨ **PERCH AI 助手** | 全局右侧助手、全局 / 机会作用域、流式 Markdown、停止与恢复、历史会话、归档、机会引用、自动标题                          |
| 🛠️ **Agent 工具**    | 搜索和读取机会、修改资料与阶段、批量修改、创建面试安排和模拟面试、保存笔试 / 面试复盘、岗位导入、读取能力画像和行动策略 |
| 🧠 **能力与策略**    | 首页求职概览、能力证据、能力画像、历史待补强项、训练记录、行动策略和过期提醒、紧凑面试日历                              |
| 🧬 **会话记忆**      | pgvector 语义检索、用户与机会作用域隔离、异步 Embedding、失败补偿、当前会话排除、长会话摘要压缩                         |
| 🔬 **可观测性**      | Agent Run 与 Chat Run 独立调试台、模型调用、工具执行、状态事件、错误与 RAG 检索信息                                     |

### AI 助手如何执行一次工具调用

```mermaid
sequenceDiagram
  participant U as 用户
  participant W as Web
  participant R as AgentRuntime
  participant M as 模型
  participant T as 业务工具
  participant D as PostgreSQL

  U->>W: 发送问题或修改指令
  W->>R: 创建 Chat Run
  R->>M: 会话上下文 + 可用工具
  M-->>R: 文本或结构化工具调用
  R->>R: Zod 参数校验与业务校验
  alt 需要用户确认
    R-->>W: waiting_confirmation + 确认卡片
    U->>W: 确认 / 取消
    W->>R: 从 checkpoint 继续
  end
  R->>T: 执行工具
  T->>D: 查询或更新数据
  T-->>R: 结构化结果
  R->>M: 工具结果
  M-->>W: 流式最终回答
```

<a id="architecture"></a>

## 技术架构

```mermaid
flowchart TB
  subgraph Browser[浏览器]
    Vue[Vue 3 + Vite]
    UI[Nuxt UI + Tailwind CSS]
    State[Pinia]
  end

  subgraph API[Fastify API]
    Routes[Routes + Zod]
    Services[Domain Services]
    Runtime[AgentRuntime]
    Workers[In-process Background Tasks]
  end

  subgraph Data[数据层]
    Drizzle[Drizzle ORM]
    PG[(PostgreSQL + pgvector)]
  end

  Model[OpenAI-compatible Chat API]
  Embedding[OpenAI-compatible Embedding API]
  Firecrawl[Firecrawl]

  Vue --> UI
  Vue --> State
  Vue -->|HTTP + fetch stream| Routes
  Routes --> Services
  Services --> Runtime
  Services --> Workers
  Services --> Drizzle --> PG
  Runtime --> Model
  Workers --> Model
  Workers --> Embedding
  Services --> Firecrawl
```

### 核心技术栈

- **Web**：Vue 3、Vite、TypeScript、Vue Router、Pinia
- **UI**：Nuxt UI、Tailwind CSS、ECharts、Marked、DOMPurify
- **API**：Fastify、Zod、原生 Fetch Stream
- **Data**：PostgreSQL / Supabase、Drizzle ORM、pgvector、HNSW
- **AI**：兼容 OpenAI Chat Completions 与 Embeddings 协议的模型服务
- **Import**：Firecrawl、unpdf
- **Quality**：Node Test Runner、ESLint、Prettier、GitHub Actions

<a id="quick-start"></a>

## 快速开始

### 1. 环境要求

- Node.js `>= 20.19`
- pnpm `9.15.4`
- PostgreSQL，并安装 `pgvector` 扩展（Supabase 已支持）
- 一个兼容 OpenAI Chat Completions 的模型服务
- 可选：Firecrawl API Key，用于岗位网页导入
- 可选：兼容 OpenAI Embeddings 的 1024 维向量服务，用于历史会话语义检索

### 2. 获取代码并安装依赖

```bash
git clone https://github.com/inzide-top/web-seek-employ.git
cd web-seek-employ
corepack enable
pnpm install
```

### 3. 创建环境配置

```bash
cp .env.example .env
```

至少修改数据库连接：

```dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_seek_employment
DATABASE_SSL=disable
```

使用 Supabase 等云数据库时，将 `DATABASE_URL` 替换为平台提供的连接串，并按服务要求设置 `DATABASE_SSL=require`。

### 4. 初始化数据库

```bash
pnpm db:check
pnpm db:migrate
```

迁移会创建业务表、Chat / Agent 运行记录、会话摘要以及 1024 维 pgvector 记忆表和索引。

### 5. 启动应用

分别打开两个终端：

```bash
# Terminal 1 · Web
pnpm dev
```

```bash
# Terminal 2 · API
pnpm dev:api
```

访问：

- Web：<http://localhost:5173>
- API 健康检查：<http://127.0.0.1:8787/api/health>

### 6. 配置聊天模型

打开应用的 **系统设置 → 模型连接**，填写：

- `Base URL`：模型服务地址，例如 `https://api.example.com`
- `模型名称`：该服务提供的模型 ID
- `API Key`：模型服务密钥

完成后建议按下面的顺序体验：

1. 新建或从 PDF 导入一份简历；
2. 手动、通过网页或文本导入岗位；
3. 选择具体简历版本生成 JD 分析；
4. 维护投递阶段、安排和复盘；
5. 创建模拟面试；
6. 打开右侧 PERCH AI 助手查询或操作当前求职数据。

<a id="configuration"></a>

## 环境变量

`.env.example` 可以直接作为模板。带密钥的变量都只能由服务端读取，**不要添加 `VITE_` 前缀**。

| 变量                            | 必需 | 默认值 / 示例               | 用途                                     |
| ------------------------------- | :--: | --------------------------- | ---------------------------------------- |
| `PORT`                          |  否  | `8787`                      | API 端口                                 |
| `API_HOST`                      |  否  | `127.0.0.1`                 | API 监听地址；容器部署通常改为 `0.0.0.0` |
| `DATABASE_URL`                  |  是  | 本地 PostgreSQL URL         | 主数据库连接                             |
| `DATABASE_SSL`                  |  否  | `disable`                   | 数据库 SSL 策略                          |
| `DATABASE_POOL_SIZE`            |  否  | `3`                         | PostgreSQL 连接池大小                    |
| `VITE_API_BASE_URL`             |  是  | `http://127.0.0.1:8787/api` | 浏览器请求 API 的公开地址                |
| `CORS_ORIGINS`                  |  是  | 本地前端地址                | 允许的前端来源，多个值用逗号分隔         |
| `API_METRICS_ENABLED`           |  否  | `false`                     | 输出 API 响应、DB 查询次数和耗时日志     |
| `FIRECRAWL_API_KEY`             |  否  | 空                          | 启用岗位网页导入                         |
| `EMBEDDING_BASE_URL`            |  否  | 空                          | OpenAI-compatible Embedding 服务地址     |
| `EMBEDDING_API_KEY`             |  否  | 空                          | Embedding 服务密钥                       |
| `EMBEDDING_MODEL`               |  否  | 空                          | 固定输出 1024 维的 Embedding 模型        |
| `RAG_EVAL_EMBEDDING_BATCH_SIZE` |  否  | `8`                         | 仅用于离线 RAG 评测脚本                  |

### 可选能力的启用规则

- **岗位网页导入**：配置 `FIRECRAWL_API_KEY` 后启用；不配置不影响手动与文本导入。
- **历史会话语义检索**：必须同时配置三个 `EMBEDDING_*` 变量；三个变量都留空时安全关闭，配置不完整时 API 会明确报错。
- **向量维度**：第一版数据库固定为 1024 维。切换到不同维度的模型前，需要修改常量、迁移数据库并重建历史索引。

<a id="project-structure"></a>

## 项目结构

```text
.
├── src/
│   ├── components/          # 全局布局、AI 助手与通用组件
│   ├── pages/               # 首页、简历、机会、策略、设置和调试台
│   ├── services/            # 前端 API 客户端
│   ├── shared/              # 前后端共享协议与 Schema
│   └── stores/              # Pinia 状态与页面缓存
├── server/
│   ├── drizzle/             # 数据库迁移与快照
│   └── src/
│       ├── routes/          # Fastify HTTP 边界
│       ├── schemas/         # 请求与模型输出校验
│       ├── services/        # 业务、Agent、Interview 与 RAG
│       ├── repositories/    # 数据访问层
│       └── scripts/         # 评测、修复与基准脚本
├── docs/                    # 产品、技术设计与发布审计
└── .github/workflows/       # CI
```

### 关键后端边界

- `server/src/services/chat/agent-runtime.ts`：模型调用、工具循环、确认与恢复的调度中心。
- `server/src/services/chat/chat-tools.ts`：按全局 / 机会作用域组装工具。
- `server/src/services/retrieval/`：文本分块、Embedding、Top-K 检索、作用域隔离和补偿索引。
- `server/src/services/interview.service.ts`：模拟面试主业务编排。
- `server/src/repositories/`：数据库读写和并发条件更新。

<a id="development"></a>

## 开发与验证

| 命令                           | 作用                                    |
| ------------------------------ | --------------------------------------- |
| `pnpm format:check`            | 检查 Prettier 格式                      |
| `pnpm lint`                    | 运行 ESLint                             |
| `pnpm typecheck`               | 检查前端类型                            |
| `pnpm typecheck:server`        | 检查服务端类型                          |
| `pnpm test:core`               | 核心业务、Agent、面试和 Schema 回归测试 |
| `pnpm test:retrieval`          | RAG 分块、作用域、索引、补偿和检索测试  |
| `pnpm test:chat-tools-matrix`  | AI 助手工具矩阵测试                     |
| `pnpm test:opportunity-import` | 岗位导入测试                            |
| `pnpm test:resume-pdf-import`  | 简历 PDF 导入测试                       |
| `pnpm evaluate:rag`            | 运行固定数据集 RAG 评测并生成本地报告   |
| `pnpm build`                   | 类型检查并构建生产资源                  |

GitHub Actions 会依次执行格式、Lint、前后端类型检查、核心测试、Drizzle 迁移检查和构建。

<a id="security"></a>

## 安全与数据边界

- `.env`、本地评测数据、日志和生成报告已被 `.gitignore` 排除；只有无真实凭据的 `.env.example` 会进入 Git。
- 聊天模型配置当前保存在浏览器 `localStorage`，并随具体请求传给本地 API；不会写入业务数据库或运行日志。**不要在共享电脑上保存真实生产 Key。**
- Firecrawl 与 Embedding Key 仅由服务端环境变量读取。
- URL 导入只接受公网 `http/https` 地址，并拒绝本机和私网地址。
- 模型输出先经过 Zod 和业务规则校验，不能直接成为数据库写入参数。
- 写操作工具根据风险进入确认流程，并通过 revision / checkpoint 避免旧确认覆盖新状态。

公开部署前至少需要补充：身份认证、用户级数据隔离、服务端密钥加密托管、限流、审计权限与生产级任务队列。

<a id="limitations"></a>

## 第一版边界

- **单用户**：当前请求身份固定为本地 `demo-user`，尚未接入登录与多租户鉴权。
- **本地优先**：模型 Key 存在当前浏览器，不适合直接作为公网多用户密钥方案。
- **轻量后台任务**：Chat Run、分析和索引任务主要运行在 API 进程内；API 重启可能中断正在执行的模型请求，历史记忆提供补偿扫描，但尚未接入 Redis / BullMQ 等生产级队列。
- **PDF 不含 OCR**：简历 PDF 使用文本提取；纯扫描图片 PDF 需要先做 OCR。
- **网页可访问性**：受登录、反爬、动态渲染和 Firecrawl 服务状态影响，部分招聘页面可能无法识别。
- **RAG 是辅助上下文**：精确的机会、简历和流程状态始终从关系数据库读取，不用向量近似结果替代业务事实。
- **暂未包含**：语音面试、外部 MCP、自动投递、多人协作与跨设备同步。

<a id="docs"></a>

## 文档

- [产品需求](./docs/01-prd.md)
- [技术设计](./docs/02-technical-design.md)
- [开发计划](./docs/03-development-plan.md)
- [JD 分析框架](./docs/04-ai-analysis-framework.md)
- [模拟面试后端与 Agent 可观测性](./docs/06-mock-interview-backend-foundation.md)
- [第一版发布前代码与数据审计](./docs/07-release-readiness-audit.md)

> `docs/` 中部分文件记录了项目演进过程，最终已实现能力与运行方式以本 README 和当前代码为准。

## License

[MIT](./LICENSE) © PERCH contributors
