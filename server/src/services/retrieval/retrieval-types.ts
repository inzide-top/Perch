import type { ChatConversationScopeType } from '@/shared/chat/schemas'

/** 一条可写入向量库的历史记忆草稿；向量和数据库主键由后续基础设施层补齐。 */
export type RetrievalDocumentDraft = {
  userId: string
  conversationId: string
  runId: string
  chunkIndex: number
  content: string
  scope: RetrievalDocumentScope
}

/**
 * global 表示可以被该用户的任意对话使用的通用记忆；
 * opportunity 表示内容涉及具体机会，只允许全局对话或相关机会对话使用。
 */
export type RetrievalDocumentScope =
  | {
      type: 'global'
    }
  | {
      type: 'opportunity'
      opportunityIds: string[]
    }

/** 当前问题允许访问的记忆边界，由后端会话信息和可信引用共同生成。 */
export type RetrievalScope = {
  userId: string
  /** 当前会话已有原始消息单独参与上下文装配，RAG 必须排除它以避免重复注入。 */
  currentConversationId: string
  conversationScopeType: ChatConversationScopeType
  boundOpportunityId: string | null
  referencedOpportunityIds: string[]
}

/** 向量检索返回给 AgentRuntime 的最小结果，不向模型暴露数据库内部结构。 */
export type RetrievalResult = {
  documentId: string
  conversationId: string
  runId: string
  content: string
  score: number
  scope: RetrievalDocumentScope
}
