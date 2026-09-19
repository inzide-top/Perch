import type { ResumeDraft } from '@/types/resume'

/**
 * 仅用于本地演示的虚构简历。不要在源码中放入真实姓名、公司或求职记录。
 */
export const mockResumeDraft: ResumeDraft = {
  title: '示例候选人-前端开发',
  targetDirection: '前端开发工程师',
  name: '示例候选人',
  address: ['杭州', '上海'],
  educationLevel: 'bachelor',
  school: '示例大学',
  major: '计算机科学与技术',
  graduationYear: '2022',
  currentStatus: 'employed',
  jobSearchIdentity: 'experienced',
  portfolioLinks: [],
  languages: [],
  workExperiences: [
    {
      id: '96cb1cc6-42c1-42ac-993e-00ba2ee73e33',
      companyName: '远舟科技',
      industry: '企业服务',
      department: '产品研发部',
      jobTitle: '前端开发工程师',
      period: {
        start: '2022-07',
        end: '2025-06',
      },
    },
  ],
  comment:
    '关注用户体验与工程质量，能够独立完成需求拆解、前端实现、联调和上线验证。习惯通过数据与复盘定位问题，并与产品、设计和后端协作推进交付。',
  skills:
    '熟悉 JavaScript、TypeScript、HTML 与 CSS，能够使用 Vue 3、Vue Router 和 Pinia 开发中大型业务页面。\n熟悉 Vite、Git、前端性能优化和常见测试工具，了解 Node.js、HTTP、SSE 与 AI 应用开发。',
  projects: [
    {
      id: 'e61b4939-8e02-4462-b708-613636ceec6b',
      name: '企业数据协作平台',
      role: '前端开发',
      techStack: 'Vue 3、TypeScript、Vite、Pinia、ECharts',
      description: '为业务团队提供数据查询、任务协作和可视化分析能力的内部平台。',
      content:
        '1. 负责核心工作台和数据看板的组件设计与交互实现。\n2. 优化列表请求、图表渲染和页面缓存，改善大数据量场景下的使用体验。\n3. 建立统一错误反馈和页面状态规范，降低重复开发成本。',
      outcomes: '核心页面首屏时间缩短，常用业务流程的操作步骤得到简化。',
    },
    {
      id: '556c4b68-976e-42c1-81d2-c3dc1f7b9af3',
      name: 'AI 研发助手',
      role: '全栈开发',
      techStack: 'Vue 3、Fastify、PostgreSQL、OpenAI-compatible API',
      description: '面向研发团队的对话式知识查询与任务辅助工具。',
      content:
        '1. 实现流式对话、工具调用确认和运行状态展示。\n2. 使用结构化输出校验模型结果，并记录可观测的执行事件。\n3. 设计基于向量检索的历史知识召回，隔离不同业务作用域。',
      outcomes: '完成从问题输入、工具执行到结果回显的可追踪业务闭环。',
    },
  ],
}
