import { chatRepository } from '../../repositories/chat.repository'
import type { ModelConnection } from '../../schemas/model.schema'
import {
  chatContextSummaryPromptVersion,
  chatConversationSummaryContentSchema,
  createChatSummaryTranscript,
  planChatContextCompaction,
  toSummaryJson,
  type ChatContextMessageRecord,
} from './chat-context-window'
import { generateChatConversationSummary } from './chat-conversation-summary'
import type { ModelProviderAdapter } from './model-provider-adapter'

export type ChatContextCompactionPersistence = Pick<
  typeof chatRepository,
  | 'findConversationSummary'
  | 'listMessagesByConversationId'
  | 'listToolActionsByConversationId'
  | 'saveConversationSummaryIfCurrent'
>

export async function compactCompletedChatConversation(
  input: {
    userId: string
    conversationId: string
    modelConnection: ModelConnection
    signal?: AbortSignal
  },
  dependencies: {
    persistence?: ChatContextCompactionPersistence
    adapter: ModelProviderAdapter
  },
) {
  const persistence = dependencies.persistence ?? chatRepository
  const [messages, toolActions, currentSummary] = await Promise.all([
    persistence.listMessagesByConversationId(input.conversationId, input.userId),
    persistence.listToolActionsByConversationId(input.conversationId, input.userId),
    persistence.findConversationSummary(input.conversationId, input.userId),
  ])
  const parsedCurrentSummary = currentSummary
    ? chatConversationSummaryContentSchema.safeParse(currentSummary.summary)
    : null

  // 摘要数据损坏时不继续推进游标；下一次仍会使用原始消息，避免静默丢上下文。
  if (parsedCurrentSummary && !parsedCurrentSummary.success) {
    throw new Error('当前会话摘要结构无效，已停止推进摘要游标')
  }

  const plan = planChatContextCompaction({
    messages: messages as ChatContextMessageRecord[],
    summarizedThroughSequence: currentSummary?.summarizedThroughSequence ?? 0,
  })
  if (!plan) return { compacted: false as const }

  const nextSummary = await generateChatConversationSummary(
    {
      modelConnection: input.modelConnection,
      previousSummary: parsedCurrentSummary?.success ? parsedCurrentSummary.data : null,
      transcript: createChatSummaryTranscript(plan.messagesToSummarize, toolActions),
      signal: input.signal,
    },
    dependencies.adapter,
  )
  const now = new Date().toISOString()
  const saved = await persistence.saveConversationSummaryIfCurrent({
    userId: input.userId,
    conversationId: input.conversationId,
    summary: toSummaryJson(nextSummary),
    summarizedThroughSequence: plan.summarizedThroughSequence,
    expectedRevision: currentSummary?.revision ?? null,
    expectedSummarizedThroughSequence: currentSummary?.summarizedThroughSequence ?? 0,
    modelName: input.modelConnection.modelName,
    promptVersion: chatContextSummaryPromptVersion,
    createdAt: currentSummary?.createdAt ?? now,
    updatedAt: now,
  })

  return saved
    ? {
        compacted: true as const,
        summarizedThroughSequence: saved.summarizedThroughSequence,
        revision: saved.revision,
      }
    : { compacted: false as const, stale: true as const }
}
