import type { RetrievalDocumentScope, RetrievalScope } from './retrieval-types'

export type RagEvaluationDocument = {
  id: string
  userId: string
  conversationId: string
  runId: string
  content: string
  scope: RetrievalDocumentScope
}

export type RagEvaluationFixtureCase = {
  id: string
  queryText: string
  scope: RetrievalScope
  expectedDocumentIds: string[]
  forbiddenDocumentIds?: string[]
}

const USER_ID = 'eval-user'
const OTHER_USER_ID = 'other-user'
// 公司、岗位、候选人偏好和时间均为虚构数据，避免公开仓库泄露真实求职信息。
const ALPHA_ID = 'opportunity-alpha'
const BETA_ID = 'opportunity-beta'
const GAMMA_ID = 'opportunity-gamma'
const DELTA_ID = 'opportunity-delta'
const EPSILON_ID = 'opportunity-epsilon'

function globalDocument(id: string, content: string, runId = `run-${id}`): RagEvaluationDocument {
  return { id, userId: USER_ID, conversationId: `conversation-${id}`, runId, content, scope: { type: 'global' } }
}

function opportunityDocument(
  id: string,
  opportunityId: string,
  content: string,
  runId = `run-${id}`,
): RagEvaluationDocument {
  return {
    id,
    userId: USER_ID,
    conversationId: `conversation-${id}`,
    runId,
    content,
    scope: { type: 'opportunity', opportunityIds: [opportunityId] },
  }
}

export const RAG_EVALUATION_DOCUMENTS: RagEvaluationDocument[] = [
  globalDocument(
    'global-vue-strength',
    '候选人的稳定优势是 Vue 3 组件化、组合式 API 和复杂状态管理，能够清晰拆分大型前端模块。',
  ),
  globalDocument(
    'global-sse-weakness',
    '历史模拟面试显示候选人对 SSE 断线重连、事件游标和服务端心跳机制理解不够完整，需要继续补强。',
  ),
  globalDocument(
    'global-engineering-weakness',
    '前端工程化是当前薄弱项，Webpack 与 Vite 构建配置、分包策略和部署缓存还缺少系统实践。',
  ),
  globalDocument(
    'global-agent-tool-weakness',
    'AI Agent 工具调用方面，候选人对工具参数校验、用户确认、幂等执行和失败恢复掌握不充分。',
    'run-global-ai',
  ),
  globalDocument(
    'global-rag-pipeline',
    '候选人已经理解 RAG 的文档切分、Embedding、Top-K 召回和上下文注入，但对 Rerank 与召回评估仍需加强。',
    'run-global-ai',
  ),
  globalDocument(
    'global-communication-strength',
    '多轮面试证据表明候选人表达结构清晰，能够先给结论，再解释方案和技术取舍。',
  ),
  globalDocument('global-city-preference', '求职偏好中，候选人优先考虑华东地区，也可以接受其他城市的高匹配度岗位。'),
  globalDocument('global-salary-preference', '候选人更重视团队成长空间、业务方向和薪资结构是否与岗位责任匹配。'),
  globalDocument(
    'global-ai-tool-strength',
    '简历与模拟面试均证明候选人熟练使用 Codex 和 ChatGPT 进行需求拆解、编码、调试和代码审查。',
  ),
  globalDocument(
    'global-state-management',
    '候选人在实际项目中使用 Pinia 管理跨页面状态，并能区分服务端数据、全局状态和局部 UI 状态。',
  ),
  globalDocument('global-testing-weakness', '自动化测试覆盖不足，尤其缺少端到端测试、异步竞态测试和失败恢复场景。'),
  globalDocument(
    'global-performance-strength',
    '候选人具备前端性能优化经验，包括懒加载、资源压缩、缓存策略、首屏优化和 DevTools 定位。',
  ),
  opportunityDocument(
    'alpha-match',
    ALPHA_ID,
    'Alpha 科技前端岗位匹配度较高，优势是 Vue、复杂业务交付和性能优化，主要缺口是大型工程化体系经验。',
  ),
  opportunityDocument(
    'alpha-schedule',
    ALPHA_ID,
    'Alpha 科技业务面安排在下周三晚上 7 点，面试类型为业务二面，备注为线上会议。',
  ),
  opportunityDocument(
    'alpha-system-weakness',
    ALPHA_ID,
    '针对 Alpha 科技岗位，候选人需要重点补强前端监控、灰度发布、微前端和大型系统稳定性建设。',
  ),
  opportunityDocument(
    'alpha-priority-note',
    ALPHA_ID,
    'Alpha 科技机会当前意向等级为 S，备注是优先跟进，公司平台和技术成长性是主要吸引力。',
  ),
  opportunityDocument(
    'beta-match',
    BETA_ID,
    'Beta 互动海外业务前端岗位匹配度很高，候选人的 H5、Vue 3 和 AI 实时对话经验与 JD 高度相关。',
  ),
  opportunityDocument(
    'beta-sse-project',
    BETA_ID,
    'Beta 互动岗位准备中可重点讲智能工牌项目：前端通过 SSE 接入私有化大模型，并处理流式状态和异常恢复。',
  ),
  opportunityDocument(
    'beta-oc-stage',
    BETA_ID,
    'Beta 互动机会已经进入 OC 阶段，下一步应准备薪资沟通和 Offer 条款确认。',
  ),
  opportunityDocument(
    'beta-hr-review',
    BETA_ID,
    'Beta 互动 HR 面复盘显示回答整体完整，但期望薪资和离职原因可以表达得更简洁坚定。',
  ),
  opportunityDocument(
    'gamma-match',
    GAMMA_ID,
    'Gamma 视频 AI Native 前端岗位与候选人的 Agent 项目经验相关，但岗位对 AI 工程深度要求更高。',
  ),
  opportunityDocument(
    'gamma-rag-weakness',
    GAMMA_ID,
    '针对 Gamma 视频岗位，RAG 评估、向量检索质量和知识库效果验证是最需要补强的能力。',
  ),
  opportunityDocument('gamma-followup', GAMMA_ID, 'Gamma 视频机会已经五个工作日没有新进展，当前建议礼貌跟进招聘方。'),
  opportunityDocument(
    'gamma-agent-requirement',
    GAMMA_ID,
    'Gamma 视频岗位重点考察 Agent 工作流、工具调用、上下文管理和前端 AI 交互产品化。',
  ),
  opportunityDocument(
    'delta-python-weakness',
    DELTA_ID,
    'Delta 内容 AI Agent 岗位要求较强 Python 工程能力，这是候选人当前最明显的岗位缺口。',
  ),
  opportunityDocument(
    'delta-agent-match',
    DELTA_ID,
    'Delta 内容岗位与候选人的 Agent Runtime、工具调用和 RAG 项目经历有一定匹配度。',
  ),
  opportunityDocument(
    'delta-status',
    DELTA_ID,
    'Delta 内容机会目前处于待投递阶段，建议先补充简历中的 AI Agent 项目成果再投递。',
  ),
  opportunityDocument(
    'epsilon-electron-weakness',
    EPSILON_ID,
    'Epsilon 云端前端岗位偏好 Electron 桌面端经验，候选人目前缺少 Electron 实际项目。',
  ),
  opportunityDocument(
    'epsilon-performance-match',
    EPSILON_ID,
    'Epsilon 科技岗位需要企业级 Web 性能优化，候选人的首屏优化、缓存和 DevTools 排障经验可以形成优势。',
  ),
  opportunityDocument(
    'epsilon-match',
    EPSILON_ID,
    'Epsilon 科技前端岗位整体匹配度中等，Vue 和工程交付符合要求，但桌面端与 SaaS 经验不足。',
  ),
  {
    id: 'other-user-private-memory',
    userId: OTHER_USER_ID,
    conversationId: 'other-conversation',
    runId: 'other-run',
    content: '另一个用户的 Alpha 科技面试安排在明天上午十点，这条内容绝对不能被当前用户检索。',
    scope: { type: 'global' },
  },
]

function globalScope(): RetrievalScope {
  return { userId: USER_ID, conversationScopeType: 'global', boundOpportunityId: null, referencedOpportunityIds: [] }
}

function opportunityScope(boundOpportunityId: string, referencedOpportunityIds: string[] = []): RetrievalScope {
  return { userId: USER_ID, conversationScopeType: 'opportunity', boundOpportunityId, referencedOpportunityIds }
}

export const RAG_EVALUATION_CASES: RagEvaluationFixtureCase[] = [
  {
    id: 'global-vue',
    queryText: '我的 Vue 组件化和状态管理能力怎么样？',
    scope: globalScope(),
    expectedDocumentIds: ['global-vue-strength', 'global-state-management'],
  },
  {
    id: 'global-sse',
    queryText: '我在 SSE 实时通信方面还有什么薄弱点？',
    scope: globalScope(),
    expectedDocumentIds: ['global-sse-weakness'],
  },
  {
    id: 'global-engineering',
    queryText: '前端工程化方面我最需要补什么？',
    scope: globalScope(),
    expectedDocumentIds: ['global-engineering-weakness'],
  },
  {
    id: 'global-agent-tools',
    queryText: '我对 Agent 工具调用的掌握有哪些不足？',
    scope: globalScope(),
    expectedDocumentIds: ['global-agent-tool-weakness'],
  },
  {
    id: 'global-rag',
    queryText: '我目前对 RAG 流程掌握到什么程度？',
    scope: globalScope(),
    expectedDocumentIds: ['global-rag-pipeline'],
  },
  {
    id: 'global-communication',
    queryText: '我的面试表达和沟通能力怎么样？',
    scope: globalScope(),
    expectedDocumentIds: ['global-communication-strength'],
  },
  {
    id: 'global-city',
    queryText: '我求职时优先考虑哪些城市？',
    scope: globalScope(),
    expectedDocumentIds: ['global-city-preference'],
  },
  {
    id: 'global-salary',
    queryText: '我选择岗位时对薪资和成长空间有什么偏好？',
    scope: globalScope(),
    expectedDocumentIds: ['global-salary-preference'],
  },
  {
    id: 'global-ai-tools',
    queryText: '我使用 Codex 和 ChatGPT 辅助开发的能力如何？',
    scope: globalScope(),
    expectedDocumentIds: ['global-ai-tool-strength'],
  },
  {
    id: 'global-performance',
    queryText: '我有哪些前端性能优化经验？',
    scope: globalScope(),
    expectedDocumentIds: ['global-performance-strength'],
  },
  {
    id: 'global-testing',
    queryText: '我的自动化测试能力还缺少什么？',
    scope: globalScope(),
    expectedDocumentIds: ['global-testing-weakness'],
  },
  {
    id: 'alpha-match',
    queryText: '我和 Alpha 科技前端岗位的匹配优势与缺口是什么？',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['alpha-match', 'alpha-system-weakness'],
  },
  {
    id: 'alpha-schedule',
    queryText: 'Alpha 科技下一次面试安排在什么时候？',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['alpha-schedule'],
  },
  {
    id: 'alpha-system',
    queryText: '准备 Alpha 科技面试时，大型系统建设要补哪些内容？',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['alpha-system-weakness'],
  },
  {
    id: 'alpha-priority',
    queryText: 'Alpha 科技现在的意向等级和跟进备注是什么？',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['alpha-priority-note'],
  },
  {
    id: 'beta-match',
    queryText: '为什么 Beta 互动海外业务岗位适合我？',
    scope: opportunityScope(BETA_ID),
    expectedDocumentIds: ['beta-match'],
  },
  {
    id: 'beta-sse',
    queryText: '准备 Beta 互动面试时可以讲哪个 SSE 项目？',
    scope: opportunityScope(BETA_ID),
    expectedDocumentIds: ['beta-sse-project'],
  },
  {
    id: 'beta-stage',
    queryText: 'Beta 互动目前到了什么招聘阶段，下一步做什么？',
    scope: opportunityScope(BETA_ID),
    expectedDocumentIds: ['beta-oc-stage'],
  },
  {
    id: 'beta-hr',
    queryText: 'Beta 互动 HR 面复盘暴露了哪些表达问题？',
    scope: opportunityScope(BETA_ID),
    expectedDocumentIds: ['beta-hr-review'],
  },
  {
    id: 'gamma-match',
    queryText: 'Gamma 视频 AI Native 前端岗位和我匹配吗？',
    scope: opportunityScope(GAMMA_ID),
    expectedDocumentIds: ['gamma-match'],
  },
  {
    id: 'gamma-rag',
    queryText: 'Gamma 视频岗位准备中最需要补强的 RAG 能力是什么？',
    scope: opportunityScope(GAMMA_ID),
    expectedDocumentIds: ['gamma-rag-weakness'],
  },
  {
    id: 'gamma-followup',
    queryText: 'Gamma 视频机会最近需要跟进吗？',
    scope: opportunityScope(GAMMA_ID),
    expectedDocumentIds: ['gamma-followup'],
  },
  {
    id: 'gamma-agent',
    queryText: 'Gamma 视频岗位重点考察哪些 Agent 能力？',
    scope: opportunityScope(GAMMA_ID),
    expectedDocumentIds: ['gamma-agent-requirement'],
  },
  {
    id: 'delta-python',
    queryText: 'Delta 内容 AI Agent 岗位最大的技术缺口是什么？',
    scope: opportunityScope(DELTA_ID),
    expectedDocumentIds: ['delta-python-weakness'],
  },
  {
    id: 'delta-status',
    queryText: 'Delta 内容机会现在是什么状态，投递前做什么？',
    scope: opportunityScope(DELTA_ID),
    expectedDocumentIds: ['delta-status'],
  },
  {
    id: 'epsilon-electron',
    queryText: 'Epsilon 云端岗位我最缺少哪类桌面端经验？',
    scope: opportunityScope(EPSILON_ID),
    expectedDocumentIds: ['epsilon-electron-weakness'],
  },
  {
    id: 'epsilon-performance',
    queryText: '我针对 Epsilon 科技岗位有哪些性能优化优势？',
    scope: opportunityScope(EPSILON_ID),
    expectedDocumentIds: ['epsilon-performance-match'],
  },
  {
    id: 'opportunity-can-read-global',
    queryText: '在 Alpha 科技机会对话里查看我的 Vue 通用优势',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['global-vue-strength', 'global-state-management'],
  },
  {
    id: 'opportunity-blocks-other',
    queryText: 'Gamma 视频岗位的 RAG 薄弱项是什么？',
    scope: opportunityScope(ALPHA_ID),
    expectedDocumentIds: ['global-rag-pipeline'],
    forbiddenDocumentIds: ['gamma-rag-weakness'],
  },
  {
    id: 'opportunity-reference',
    queryText: '我引用了 Gamma 视频，告诉我它的 RAG 薄弱项',
    scope: opportunityScope(ALPHA_ID, [GAMMA_ID]),
    expectedDocumentIds: ['gamma-rag-weakness'],
  },
  {
    id: 'global-compare',
    queryText: '对比 Alpha 科技和 Beta 互动两个前端机会的岗位匹配情况',
    scope: globalScope(),
    expectedDocumentIds: ['alpha-match', 'beta-match'],
  },
]

export const RAG_EVALUATION_OTHER_USER_DOCUMENT_ID = 'other-user-private-memory'
