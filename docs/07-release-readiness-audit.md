# 第一版发布前代码与数据审计

审计日期：2026-08-12

## 1. 本轮代码结构优化

### AI 助手后端工具

原 `server/src/services/chat/chat-tools.ts` 超过 3000 行，同时包含读取、资料修改、阶段流转、面试安排、模拟面试和复盘工具。现在入口文件只负责根据会话作用域组装工具，各业务分别位于：

- `chat-tools/read-tools.ts`：机会搜索、上下文读取、能力画像、行动策略和岗位导入。
- `chat-tools/profile-tools.ts`：单个及批量机会资料修改。
- `chat-tools/status-tools.ts`：机会阶段流转。
- `chat-tools/interview-schedule-tools.ts`：面试安排。
- `chat-tools/mock-interview-tools.ts`：模拟面试创建。
- `chat-tools/review-tools.ts`：笔试与面试复盘。

工具名称、Schema、用户确认、并发快照和数据库执行路径未改变。服务端类型检查、工具矩阵测试和 34 条工具回归测试均通过。

### AI 助手前端

会话历史的搜索、范围筛选、归档切换、分页、重命名和删除确认已从 `GlobalChatAssistant.vue` 抽到 `ChatConversationHistoryPanel.vue`。主组件仍负责聊天运行、流式输出、停止恢复和工具卡片编排，避免把具有共同状态机的逻辑机械拆散。

本次复查中仍超过 1000 行、但不适合在发布前机械拆分的生产文件包括：

- `server/src/services/interview.service.ts`
- `src/components/chat/GlobalChatAssistant.vue`
- `server/src/repositories/interview.repository.ts`
- `server/src/repositories/chat.repository.ts`
- `src/pages/opportunity/detail/interview/pages/InterviewSessionPage.vue`
- `server/src/services/opportunity.service.ts`
- `src/pages/opportunity/detail/index.vue`
- `src/pages/opportunity/components/CreateOpportunityModal.vue`
- `src/stores/interview.ts`
- `src/pages/opportunity/index.vue`

这些文件行数较大，但当前分别承载了连续的面试状态机、聊天流生命周期、聚合数据访问或高度耦合的页面交互。它们应在对应模块再次发生业务改动时，按“状态机、数据访问、流式连接、工具卡片、展示组件”边界逐个拆分，不建议为了行数在发布前一次性重写。当前 TypeScript、Lint、核心测试和生产构建已经为后续渐进拆分提供回归保护。

## 2. 环境变量

`.env.example` 已按 API、数据库、浏览器公开配置、可观测性、Firecrawl 和 RAG 分区，并覆盖当前代码读取的全部变量：

- API：`PORT`、`API_HOST`、`CORS_ORIGINS`
- 数据库：`DATABASE_URL`、`DATABASE_SSL`、`DATABASE_POOL_SIZE`
- 前端公开配置：`VITE_API_BASE_URL`
- 可观测性：`API_METRICS_ENABLED`
- 网页导入：`FIRECRAWL_API_KEY`
- RAG：`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`、`RAG_EVAL_EMBEDDING_BATCH_SIZE`

密钥只能由服务端变量读取，不能添加 `VITE_` 前缀。

## 3. 页面状态检查

| 页面             | 加载中                       | 空数据                                     | 加载失败                     | 移动端检查                                       |
| ---------------- | ---------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------------ |
| 首页             | 概览骨架屏                   | 图表、动态、能力证据各自有空态             | 概览错误面板与重试           | 390px 无页面级横向溢出                           |
| 简历管理         | 工作区骨架屏                 | 首份简历引导、项目空态                     | 独立错误页与重试             | 390px 无页面级横向溢出                           |
| 机会管理         | 列表骨架屏                   | 全空态、筛选无结果空态                     | 错误只占列表区域并保留筛选   | 390px 无页面级横向溢出                           |
| 机会详情         | 详情骨架屏，返回入口始终存在 | 子模块各自空态                             | 友好中文错误与重试           | 390px 无页面级横向溢出                           |
| 模拟面试 Session | 会话、评分与复盘均有加载态   | 历史记录和评估空态                         | 提交、加载、深评失败反馈     | 静态响应式检查通过；需要在真实面试内测中继续验收 |
| 能力画像         | 能力画像骨架屏               | 无简历、无面试证据、无 JD 信号、无训练记录 | 错误页和保留旧数据的局部错误 | 390px 无页面级横向溢出                           |
| 行动策略         | 页面骨架屏                   | 无可执行行动空态                           | 错误页、AI 生成失败及重试    | 390px 无页面级横向溢出                           |
| 设置             | 本地配置即时加载             | 已保存模型为空时不展示列表                 | 保存操作使用 Toast 反馈      | 390px 无页面级横向溢出                           |
| Agent Run 调试台 | 列表和详情骨架屏             | 筛选无结果空态                             | 页面错误面板                 | 390px 无页面级横向溢出                           |
| Chat Run 调试台  | 列表和详情骨架屏             | Run、模型调用、工具和事件分别有空态        | 页面和单次 Run 错误面板      | 390px 无页面级横向溢出                           |

本轮修复：机会不存在时不再直接显示后端英文错误，也不再在详情尚未确认存在时并行请求复盘状态，避免重复错误 Toast。

移动端检查代表主路由在 390×844 视口下的页面级溢出检查，不等同于全部真机交互验收。日期选择器、富文本滚动、模拟面试输入和软键盘顶起仍应在 iOS Safari 与 Android Chrome 上人工走查。

## 4. GitHub 密钥检查

检查范围包括当前已跟踪文件、准备提交但尚未跟踪的文件，以及本地全部 Git 提交历史的新增行。

结论：未发现真实 API Key、JWT、私钥或数据库密码。扫描命中项均为：

- `.env.example` 中的本地示例数据库地址；
- 测试代码中的故意伪造 Key，用于验证密钥不会进入模型输入或数据库；
- Embedding Adapter 测试中的固定占位 Key。

`.env`、`.env.local`、`.env.production` 均被 `.gitignore` 排除，只有 `.env.example` 允许提交。

该结果是代码与历史的规则扫描，不替代 GitHub Secret Scanning。公开发布时仍建议开启 GitHub 仓库的 Secret Scanning / Push Protection。

## 5. 真实求职数据检查

### 已处理当前版本：个人简历样例已匿名化

`src/pages/resume/mocks/resumeDraft.ts` 当前已替换为完全虚构的候选人、公司与项目；`src/pages/opportunity/mocks/jobDraft.ts` 也已改为虚构岗位。历史提交仍可能包含修改前的内容，因此仅修改当前文件不能从 GitHub 历史中彻底移除。

公开发布前建议：

1. 如果仓库尚未公开，发布前评估是否使用 `git filter-repo` 或 BFG 清理历史。
2. 如果仓库已经公开，清理历史并强制推送会影响现有克隆与分支，需要单独确认后执行。
3. 清理后轮换任何曾经一同暴露的联系方式或私密链接。

### 已处理当前版本：默认岗位样例已匿名化

默认岗位 Mock 已改为“示例科技 / AI 前端工程师”。部分测试仍使用公司名验证多机会匹配和作用域隔离，这些是固定测试数据，不包含个人求职记录。

### 未发现进入 Git 的数据库业务记录

本地数据库中存在真实简历、机会、面试和聊天内容，但本次未发现数据库导出文件、Chat Run 报告或 RAG 生成报告被 Git 跟踪。`server/reports/*.json` 已被忽略。

数据库内容与 Git 仓库是两条数据路径：只要不提交数据库转储、日志、截图和生成报告，本地真实记录不会因为正常运行应用自动进入 GitHub。

## 6. 发布前剩余人工检查

- 用无数据的新账号走一次：首页 → 创建简历 → 导入 JD → 查看详情 → 模拟面试 → 能力画像。
- 断开 API 后检查：首页、简历、机会、策略与两个调试台的失败态和重试。
- 在 iOS Safari 和 Android Chrome 检查抽屉、模态框、日期时间选择、AI 助手输入和软键盘。
- 如果需要彻底清除历史版本中的个人简历 Mock，单独评估是否改写 Git 历史。
