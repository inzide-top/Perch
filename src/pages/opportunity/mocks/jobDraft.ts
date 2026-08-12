export type MockJobDraft = {
  company: string
  jobTitle: string
  address: string[]
  introduction: string
  description: string
}

export const defaultMockJobDraft: MockJobDraft = {
  company: '示例科技',
  jobTitle: 'AI 前端工程师',
  address: ['杭州'],
  introduction:
    '- 负责 AI 工作台与数据产品的前端开发和持续迭代。\n- 参与需求分析、技术方案、编码、测试和上线验证。\n- 与产品、设计、后端和算法团队协作，推动 Agent 与知识检索能力落地。\n- 持续优化前端架构、组件体系和研发流程。',
  description:
    '- 熟悉 JavaScript、TypeScript、HTML 和 CSS。\n- 熟练使用 Vue 或 React，具备组件化和工程化能力。\n- 了解模型调用、Prompt、上下文管理与工具调用。\n- 熟悉 SSE、Fetch Stream 和常见性能优化方法。\n- 具备独立交付能力，重视代码质量、数据安全和线上稳定性。',
}
