import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'
import type { ChatJsonObject, ChatMessageReference, ChatMessageReferenceInput } from '@/shared/chat/schemas'
import type { ModelProviderMessage } from './model-provider-adapter'

export type ResolvedOpportunityMessageReference = {
  reference: ChatMessageReference
  opportunity: JobOpportunityRecord
  context: ChatJsonObject
}

type ResolveChatMessageReferencesInput = {
  userId: string
  conversationOpportunityId: string | null
  references: ChatMessageReferenceInput[]
  findOpportunityById: (opportunityId: string) => Promise<JobOpportunityRecord | null>
  getOpportunityContextForUser: (input: {
    userId: string
    opportunityId: string
    sections: ['profile', 'job_analysis']
  }) => Promise<ChatJsonObject>
}

export class ChatMessageReferenceNotFoundError extends Error {
  constructor() {
    super('引用的岗位机会不存在')
    this.name = 'ChatMessageReferenceNotFoundError'
  }
}

export class ChatMessageReferenceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatMessageReferenceConflictError'
  }
}

/**
 * 把浏览器提交的机会 ID 解析成服务端可信快照。
 * 这里同时校验归属关系，并且拒绝重复引用机会会话已经绑定的同一条机会。
 */
export async function resolveChatMessageReferences(
  input: ResolveChatMessageReferencesInput,
): Promise<ResolvedOpportunityMessageReference[]> {
  return Promise.all(
    input.references.map(async (reference) => {
      const opportunity = await input.findOpportunityById(reference.id)
      if (!opportunity || opportunity.userId !== input.userId) {
        throw new ChatMessageReferenceNotFoundError()
      }
      if (input.conversationOpportunityId === opportunity.id) {
        throw new ChatMessageReferenceConflictError('当前会话已经绑定该机会，无需重复引用')
      }

      const context = await input.getOpportunityContextForUser({
        userId: input.userId,
        opportunityId: opportunity.id,
        sections: ['profile', 'job_analysis'],
      })

      return {
        reference: {
          type: 'opportunity',
          id: opportunity.id,
          label: `${opportunity.company} · ${opportunity.jobTitle}`,
        },
        opportunity,
        context,
      }
    }),
  )
}

/**
 * 引用是当前消息的一次性补充上下文。调用方会把这段内容合并进本轮首条 System Prompt，
 * 不写进后续历史消息映射，也不会把全局会话永久变成机会会话。
 */
export function toReferenceContextMessage(
  references: ResolvedOpportunityMessageReference[],
): ModelProviderMessage | null {
  if (references.length === 0) return null

  const payload = references.map(({ reference, context }) => ({
    reference: {
      type: reference.type,
      id: reference.id,
      label: reference.label,
    },
    context,
  }))

  return {
    role: 'system',
    content: `以下是用户为当前这一条消息显式选择的一次性机会引用。数据由服务端按当前用户权限读取，优先级高于历史聊天中的旧描述。
这些引用只适用于紧随其后的用户消息，不会改变会话绑定关系，也不能在后续轮次中自动沿用。
可以直接依据快照回答；如果全局会话的问题需要快照之外的真实面试或模拟面试信息，调用 get_opportunity_context，并使用对应 reference.label 作为 opportunityReference。
不要向用户展示内部 ID，也不要声称引用中未提供的事实。

一次性机会引用：
${JSON.stringify(payload)}`,
  }
}
