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
    <a href="https://github.com/inzide-top/Perch/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/inzide-top/Perch/actions/workflows/ci.yml/badge.svg"></a>
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

**[在线体验](https://perch.inzide.top) · [GitHub](https://github.com/inzide-top/Perch) · [虚构演示简历](./docs/demo/demo-resume.pdf)**

PERCH 将简历、岗位分析、模拟面试和 AI 助手组织到一个求职工作台中。支持本地开发模式、共享演示模式和 Supabase 登录模式。

体验 AI 功能前，请在“系统设置 → 模型连接”配置自己的兼容模型服务。模型 Key 会保存在当前浏览器，并随 AI 请求发往 PERCH API，再由 API 请求所选模型服务。首次体验建议使用[虚构数据](./docs/demo/README.md)，先阅读[数据与部署说明](#security)。

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

每条 JD 分析会绑定具体简历版本，AI 执行记录包含运行状态，数据修改工具经过业务校验，并可在需要时请求用户确认。

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
| 🔐 **登录与身份**    | Supabase 登录与会话验证、服务层用户归属校验；另有本地开发和共享演示模式                                                 |
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
git clone https://github.com/inzide-top/Perch.git
cd Perch
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

### 模型地址访问模式

GitHub 的 `.env.example` 默认面向开发者自用：

```dotenv
MODEL_ALLOW_UNRESTRICTED_LOCAL=true
```

设为 `true` 后，允许任意 HTTP/HTTPS 模型地址，包括第三方中转、本机、内网和自定义端口；忽略 `MODEL_ALLOWED_ORIGINS`，无需配置白名单。此开关虽名为 LOCAL，但**不检查 NODE_ENV**，生产环境设置 true 也会解除地址限制。它不会解除超时、认证或重定向限制；模型服务仍需兼容现有接口格式。

**Railway 公共后端必须显式设置 `MODEL_ALLOW_UNRESTRICTED_LOCAL=false`，并配置下面的白名单。不要将开发模板直接用于公共部署。** 未配置开关或值不是小写 `true` 时，也采用白名单模式。

后端白名单模式配置：

```dotenv
# Railway 公共部署
MODEL_ALLOW_UNRESTRICTED_LOCAL=false
# 官方来源预配置；可按部署需要删减
MODEL_ALLOWED_ORIGINS=https://api.openai.com,https://api.deepseek.com,https://api.minimax.io,https://api.minimax.cn,https://api.moonshot.cn,https://api.moonshot.ai,https://api.anthropic.com,https://dashscope.aliyuncs.com,https://dashscope-intl.aliyuncs.com,https://generativelanguage.googleapis.com
```

已整理 [7 家官方服务的 Base URL 与兼容性说明](./docs/model-providers.md)。这些是来源预配置，尚未逐家完成真实模型联调。

只填 HTTPS 来源（协议、域名、可选端口），不要包含 `/v1`、查询参数或通配符。用户在设置页仍填写完整 Base URL（如 `https://api.example.com/v1`）。不同子域或端口必须单独批准。普通分析与流式聊天共用校验，不跟随重定向；错误不会通过更换地址重试。

白名单模式下，未配置允许来源时关闭模型调用。此配置只放在 Fastify 后端，不使用 `VITE_` 前缀。新增中转时由管理员审核域名所有权、服务可信度后更新并重启后端，用户不能自行修改名单。白名单不保证被批准域名的 DNS 永远解析为公网；生产网络仍应阻止私网、回环与云元数据地址的出站访问。平台配置的 Embedding、Firecrawl 使用独立调用路径，本变量不控制它们。

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

- `Base URL`：模型服务地址，例如 `https://api.example.com/v1`（以供应商实际接口路径为准，程序会追加 `/chat/completions`）
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

`.env.example` 是本地开发模板，不可原样用于公网生产部署。环境变量中的服务端密钥**不要添加 `VITE_` 前缀**。用户在设置页填写的聊天模型 Key 按下文的数据边界处理。

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

### 身份与调试配置

| 变量                                                  | 说明                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AUTH_MODE` / `VITE_AUTH_MODE`                        | 前后端分别配置为 `development`、`interview` 或 `supabase`；正式多用户部署使用 `supabase` |
| `DEVELOPMENT_USER_ID`                                 | 本地模式共享数据身份，默认 `demo-user`                                                   |
| `INTERVIEW_DEMO_USER_ID`                              | 共享演示身份；访客共享该身份，不用于真实个人资料                                         |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`           | 后端验证登录身份所用的 Auth 项目公开配置                                                 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | 同一 Auth 项目的浏览器公开配置，不能填写 service_role 密钥                               |
| `ENABLE_DEVELOPER_TOOLS`                              | 后端仅在明确为 `true` 时注册调试接口，公网部署建议 `false`                               |
| `VITE_ENABLE_DEVELOPER_TOOLS`                         | 控制前端调试入口，公网部署建议 `false`                                                   |
| `WEB_PORT`                                            | 本地双模式启动脚本读取的 Web 端口                                                        |

正式部署请显式设置以下配置，并核对 Supabase 的 Site URL、允许的登录/密码重置回跳地址，以及数据库迁移：

```dotenv
NODE_ENV=production
AUTH_MODE=supabase
VITE_AUTH_MODE=supabase
ENABLE_DEVELOPER_TOOLS=false
VITE_ENABLE_DEVELOPER_TOOLS=false
```

生产前端的 `VITE_*` 在构建时注入；前端生产配置更改后需要重新构建。后端的显式 `AUTH_MODE` 优先于 `NODE_ENV`，不能依靠 `NODE_ENV=production` 覆盖模板中的 `development`。

`pnpm dev:local` 和 `pnpm dev:auth` 分别依赖未入库的 `.env.development.local` 与 `.env.auth.local`。新克隆可先按上面的双终端方式运行；需要双模式脚本时，按 `.env.example` 注释创建覆盖文件，保持 Web/API 端口与 CORS 一致。

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

- **业务数据**：简历、岗位、面试与会话记录存入 API 连接的 PostgreSQL。PDF 导入会保存提取文本及任务结果；不能将“取消导入”理解为已删除所有后台记录。
- **聊天模型**：当前模型与可复用连接（包含 API Key）保存在当前浏览器 `localStorage`，执行 AI 功能时随请求发往 PERCH API，再由 API 调用所选供应商。退出登录会清理应用浏览器缓存；不要使用共享设备保存高权限 Key。
- **第三方处理**：执行分析、面试和聊天时，会向所选模型发送完成任务所需的上下文。启用 Embedding 后，历史会话等相关文本可能发送给配置的向量服务；网页导入会通过 Firecrawl 处理岗位 URL。自部署者需要告知用户实际供应商、保留与删除方式。
- **运行记录**：Agent/Chat 的输入输出和错误记录可能含个人信息。调试接口受认证、用户作用域和启用开关限制，生产环境应按需要关闭并设定日志保留策略。
- **身份模式**：`development` 和 `interview` 使用固定身份；只有 `supabase` 模式进行登录验证。不要把共享演示模式用于多人真实简历存储。
- **公开配置**：Supabase Publishable Key 属于浏览器公开配置；数据库密码、service_role 密钥和平台 Firecrawl/Embedding 密钥不可放入前端。
- **Git 管理**：`.env*`（除 `.env.example`）、`personal/` 和部分报告目录有忽略规则。忽略规则不能清除既有历史、截图或已发布附件，发布前仍应独立审查。

公网运维应核对服务端出站目标限制、用户额度与入口限流、调试权限、备份与删除机制。代码中的输入校验、用户归属校验和任务容量限制不能替代部署层验证。

<a id="limitations"></a>

## 第一版边界

- **身份与隔离**：已接入 Supabase 登录与用户归属检查；自部署仍需验证 A/B 账号隔离、数据库角色权限与生产认证配置。
- **自备模型连接**：模型 Key 保存在浏览器，尚不是服务端加密托管的密钥方案。
- **轻量后台任务**：Chat Run、分析和索引任务主要运行在 API 进程内；API 重启可能中断正在执行的模型请求，历史记忆提供补偿扫描，但尚未接入 Redis / BullMQ 等生产级队列。
- **PDF 不含 OCR**：简历 PDF 使用文本提取；纯扫描图片 PDF 需要先做 OCR。
- **网页可访问性**：受登录、反爬、动态渲染和 Firecrawl 服务状态影响，部分招聘页面可能无法识别。
- **RAG 是辅助上下文**：精确的机会、简历和流程状态始终从关系数据库读取，不用向量近似结果替代业务事实。
- **暂未包含**：语音面试、外部 MCP、自动投递和多人协作。业务数据由后端数据库保存，但模型连接设置不会随账号跨设备同步。

<a id="docs"></a>

## 文档

- [产品需求](./docs/01-prd.md)
- [技术设计](./docs/02-technical-design.md)
- [JD 分析框架](./docs/04-ai-analysis-framework.md)
- [模拟面试后端与 Agent 可观测性](./docs/06-mock-interview-backend-foundation.md)
- [历史发布审计（2026-08，不代表当前安全验收）](./docs/07-release-readiness-audit.md)
- [虚构演示数据](./docs/demo/README.md)
- [贡献指南](./CONTRIBUTING.md)

> `docs/` 中部分文件记录了项目演进过程，最终已实现能力与运行方式以本 README 和当前代码为准。

## 反馈与支持

欢迎通过 [Issues](https://github.com/inzide-top/Perch/issues) 提交可复现问题和功能建议。请说明操作步骤、预期与实际结果，并对截图和日志脱敏，不要上传真实简历、联系方式或 API Key。

如果 PERCH 对你有帮助，欢迎点一个 Star，方便以后找到这个项目。

## License

[MIT](./LICENSE) © PERCH contributors

## 模型白名单部署检查

1. Railway 公共后端显式设置 `MODEL_ALLOW_UNRESTRICTED_LOCAL=false`，同时设置 `MODEL_ALLOWED_ORIGINS`，使用真实可信服务的来源，保留前端设置中的 `/v1` 等路径。
2. 部署新后端并重启。只更新 Vercel 前端无法启用此防护。
3. 用虚构数据验证一次 JD 分析和一次 AI 助手流式回答，确认现有供应商兼容。
4. 未批准域名、同名恶意后缀、不同端口、IP、本机地址及重定向必须失败；不要将真实 Key 发给测试地址。
5. 白名单模式下服务端名单为空或格式错误时会拒绝调用，出现相应中文配置提示。不要通过关闭校验恢复服务，应修正配置。
