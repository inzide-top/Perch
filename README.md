# PERCH · AI Career Workspace

> Where rest becomes readiness.

PERCH 是一个本地优先的求职 Agent 工作台。它把简历版本、岗位机会、结构化 JD 匹配、求职流程和可观测的模型运行记录组织在同一条工作流中。

当前可用闭环：

```text
简历版本
  → 创建 JD 机会
  → 异步结构化匹配分析
  → 查看优势、风险、简历建议与跟进建议
  → 在 AgentRun 调试台回看模型调用、重试和校验失败
  → 开始基础面或项目面模拟面试，查看本轮评分、复盘和证据引用
  → 在首页和求职策略中查看已有能力证据与行动建议
```

## 技术栈

- Web：Vue 3、Vite、TypeScript、Vue Router、Pinia
- UI：Nuxt UI、Tailwind CSS
- API：Fastify、Zod
- 数据：PostgreSQL（Supabase）、Drizzle ORM
- AI：兼容 OpenAI Chat Completions 的模型服务

## 本地运行

安装依赖后，在项目根目录创建 `.env`：

```bash
DATABASE_URL="postgresql://..."
DATABASE_SSL="require"
DATABASE_POOL_SIZE=3
VITE_API_BASE_URL="http://127.0.0.1:8787/api"
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

启动前端与 API：

```bash
pnpm dev
pnpm dev:api
```

首次连接数据库前执行迁移：

```bash
pnpm db:migrate
```

常用校验命令：

```bash
pnpm test:core
pnpm lint
pnpm typecheck
pnpm typecheck:server
pnpm build
```

模型配置目前由设置页保存在当前浏览器；每次分析时临时传给本地 API，不写入数据库或 AgentRun 记录。这种方式适合本地开发，正式多用户部署前会替换为登录后的服务端加密配置。

## 当前边界

- 已实现：简历版本链、机会流程管理、JD 匹配分析、失败重试、重复 JD 拦截、分析状态轮询、AgentRun 调试台、基础面/项目面模拟面试、真实复盘提取、首页能力证据摘要、能力画像和行动策略。
- 正在进入：全局 AI 对话与机会内 AI 对话。
- 尚未实现：登录、多设备同步、RAG、语音面试、外部 MCP、生产级密钥托管。

## 文档

- [产品需求](./docs/01-prd.md)
- [技术设计](./docs/02-technical-design.md)
- [开发计划](./docs/03-development-plan.md)
- [JD 分析框架](./docs/04-ai-analysis-framework.md)
- [未来开源 README 素材清单](./docs/05-open-source-readme-notes.md)
- [模拟面试后端与 Agent 可观测性](./docs/06-mock-interview-backend-foundation.md)

个人资料、面试复习笔记和本地 Prompt 样例不属于公开仓库内容，分别由 `personal/` 和 `.prompt-evals/*.local` 保存，并已加入 `.gitignore`。
