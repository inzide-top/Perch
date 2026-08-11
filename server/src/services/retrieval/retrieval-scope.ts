import type { RetrievalDocumentScope, RetrievalScope } from './retrieval-types'

function uniqueOpportunityIds(opportunityIds: Array<string | null | undefined>) {
  return [...new Set(opportunityIds.filter((id): id is string => Boolean(id)))]
}

/**
 * 为已完成的一轮对话生成持久化记忆边界。
 * 只要内容关联了具体机会，就不能降级成可被所有机会对话读取的通用记忆。
 */
export function createRetrievalDocumentScope(input: {
  boundOpportunityId: string | null
  relatedOpportunityIds: string[]
}): RetrievalDocumentScope {
  const opportunityIds = uniqueOpportunityIds([input.boundOpportunityId, ...input.relatedOpportunityIds])

  if (opportunityIds.length === 0) {
    return { type: 'global' }
  }

  return {
    type: 'opportunity',
    opportunityIds,
  }
}

/**
 * 先执行确定性的用户与机会隔离，再进行向量相似度排序。
 * 这条规则不能交给模型判断，否则模型可能读取到本不该进入上下文的数据。
 */
export function canRetrieveDocument(
  queryScope: RetrievalScope,
  document: { userId: string; scope: RetrievalDocumentScope },
) {
  if (queryScope.userId !== document.userId) return false

  if (queryScope.conversationScopeType === 'global') return true
  if (document.scope.type === 'global') return true

  const allowedOpportunityIds = new Set(
    uniqueOpportunityIds([queryScope.boundOpportunityId, ...queryScope.referencedOpportunityIds]),
  )

  return document.scope.opportunityIds.some((opportunityId) => allowedOpportunityIds.has(opportunityId))
}
