export type MockJobDraft = {
  company: string
  jobTitle: string
  address: string[]
  introduction: string
  description: string
}

export const defaultMockJobDraft: MockJobDraft = {
  company: 'Bilibili',
  jobTitle: 'AI Native开发工程师（前端方向）',
  address: ['上海'],
  introduction:
    '- 负责猫耳音频直播、虚拟开播和广播剧点播相关产品的前端开发与持续迭代。\n- 使用 AI 工具参与需求分析、方案设计、编码、测试和调试，提升研发效率与交付质量。\n- 设计和搭建 AI Workflow，将大模型、业务规则、工具调用和人工处理流程进行组合，解决实际业务问题。\n- 参与业务知识库建设，包括内容整理、文档切分、检索召回、效果评估和持续优化。\n- 参与 Agent、RAG、对话交互、流式输出及音频相关 AI 能力的产品落地。\n- 与产品、设计、后端和算法团队协作，推动需求从想法、开发到上线形成完整闭环。\n- 持续优化前端架构、组件体系和研发流程，保障产品体验、代码质量和线上稳定性。',
  description:
    '- 前端基础扎实，熟练掌握 JavaScript、TypeScript、HTML 和 CSS。\n- 熟练使用 React、Vue 等主流前端框架，具备良好的组件化和工程化能力。\n- 熟练使用 AI 编程工具，能够独立完成需求拆解、开发、调试和交付。\n- 有 AI Workflow、Agent、RAG 或知识库应用的实际搭建经验。\n- 了解模型调用、Prompt、上下文管理、工具调用，以及知识库常见实现方式。\n- 熟悉 SSE、WebSocket、API 调用等实时交互方案。\n- 具备较强的问题拆解能力和独立交付能力，重视代码质量、数据安全和线上稳定性。',
}
