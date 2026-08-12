import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { ChatMessageRecord, ChatToolActionContextRecord } from './chat-message-mapper'
import { toProviderMessages } from './chat-message-mapper'

export const chatContextSummaryPromptVersion = 'chat.context-summary.v1'

export const chatConversationSummaryContentSchema = z
  .object({
    stableFacts: z.array(z.string().trim().min(1).max(500)).max(24),
    userPreferences: z.array(z.string().trim().min(1).max(500)).max(16),
    decisions: z.array(z.string().trim().min(1).max(500)).max(20),
    completedActions: z.array(z.string().trim().min(1).max(500)).max(20),
    unresolvedTopics: z.array(z.string().trim().min(1).max(500)).max(20),
    otherContext: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict()

export type ChatConversationSummaryContent = z.output<typeof chatConversationSummaryContentSchema>

export type ChatContextMessageRecord = ChatMessageRecord & {
  sequenceNumber: number
}

export type ChatConversationSummaryRecord = {
  summary: ChatJsonObject
  summarizedThroughSequence: number
  revision: number
}

export type ChatContextCompressionPolicy = {
  triggerTurnCount: number
  retainedTurnCount: number
  minimumRetainedTurnCount: number
  triggerEstimatedTokens: number
  targetRecentEstimatedTokens: number
  hardRecentEstimatedTokens: number
  maximumSummaryInputEstimatedTokens: number
}

export const defaultChatContextCompressionPolicy: ChatContextCompressionPolicy = {
  // 平时保留约 8 轮原文；积累到 12 轮才批量摘要，避免每一轮都额外调用模型。
  triggerTurnCount: 12,
  retainedTurnCount: 8,
  minimumRetainedTurnCount: 4,
  triggerEstimatedTokens: 12_000,
  targetRecentEstimatedTokens: 8_000,
  hardRecentEstimatedTokens: 16_000,
  maximumSummaryInputEstimatedTokens: 20_000,
}

type ContextTurn = {
  messages: ChatContextMessageRecord[]
  startSequence: number
  endSequence: number
  estimatedTokens: number
  settled: boolean
}

export type ChatContextCompactionPlan = {
  messagesToSummarize: ChatContextMessageRecord[]
  summarizedThroughSequence: number
  remainingTurnCount: number
  estimatedTokensToSummarize: number
}

/**
 * 不同模型没有统一 tokenizer，因此这里只做保守预算：中文/非 ASCII 字符约按 1 token，
 * ASCII 约按 4 字符 1 token，再为消息边界预留固定开销。
 */
export function estimateChatTextTokens(text: string) {
  let weighted = 0
  for (const character of text) weighted += character.charCodeAt(0) > 0x7f ? 1 : 0.25
  return Math.max(1, Math.ceil(weighted))
}

function readMessageText(message: ChatMessageRecord) {
  return message.parts
    .filter((part): part is typeof part & { text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function estimateMessageTokens(message: ChatMessageRecord) {
  return estimateChatTextTokens(readMessageText(message)) + 8
}

function groupMessagesIntoTurns(messages: ReadonlyArray<ChatContextMessageRecord>) {
  const turns: ContextTurn[] = []
  let current: ChatContextMessageRecord[] = []

  const flush = () => {
    if (current.length === 0) return
    const assistant = [...current].reverse().find((message) => message.role === 'assistant')
    turns.push({
      messages: current,
      startSequence: current[0]!.sequenceNumber,
      endSequence: current.at(-1)!.sequenceNumber,
      estimatedTokens: current.reduce((total, message) => total + estimateMessageTokens(message), 0),
      settled: assistant?.status === 'completed' || assistant?.status === 'cancelled',
    })
    current = []
  }

  for (const message of messages) {
    if (message.role === 'user' && current.length > 0) flush()
    current.push(message)
  }
  flush()
  return turns
}

export function planChatContextCompaction(input: {
  messages: ReadonlyArray<ChatContextMessageRecord>
  summarizedThroughSequence: number
  policy?: ChatContextCompressionPolicy
}): ChatContextCompactionPlan | null {
  const policy = input.policy ?? defaultChatContextCompressionPolicy
  const unsummarized = input.messages.filter(
    (message) => message.sequenceNumber > input.summarizedThroughSequence && message.status !== 'streaming',
  )
  const turns = groupMessagesIntoTurns(unsummarized)
  const settledTurns = turns.filter((turn) => turn.settled)
  const totalEstimatedTokens = settledTurns.reduce((total, turn) => total + turn.estimatedTokens, 0)

  if (settledTurns.length <= policy.triggerTurnCount && totalEstimatedTokens <= policy.triggerEstimatedTokens) {
    return null
  }

  let retainedCount = 0
  let retainedTokens = 0
  let keepFromSettledIndex = settledTurns.length

  for (let index = settledTurns.length - 1; index >= 0; index -= 1) {
    const turn = settledTurns[index]!
    const mustKeep = retainedCount < policy.minimumRetainedTurnCount
    const canKeep =
      retainedCount < policy.retainedTurnCount &&
      retainedTokens + turn.estimatedTokens <= policy.targetRecentEstimatedTokens

    if (!mustKeep && !canKeep) break
    keepFromSettledIndex = index
    retainedCount += 1
    retainedTokens += turn.estimatedTokens
  }

  const candidateTurns = settledTurns.slice(0, keepFromSettledIndex)
  const turnsToSummarize: ContextTurn[] = []
  let summaryInputTokens = 0
  for (const turn of candidateTurns) {
    if (
      turnsToSummarize.length > 0 &&
      summaryInputTokens + turn.estimatedTokens > policy.maximumSummaryInputEstimatedTokens
    ) {
      break
    }
    turnsToSummarize.push(turn)
    summaryInputTokens += turn.estimatedTokens
  }
  const lastTurn = turnsToSummarize.at(-1)
  if (!lastTurn) return null

  const messagesToSummarize = unsummarized.filter((message) => message.sequenceNumber <= lastTurn.endSequence)

  return {
    messagesToSummarize,
    summarizedThroughSequence: lastTurn.endSequence,
    remainingTurnCount: settledTurns.length - turnsToSummarize.length,
    estimatedTokensToSummarize: turnsToSummarize.reduce((total, turn) => total + turn.estimatedTokens, 0),
  }
}

function formatSummarySection(title: string, items: string[]) {
  return items.length > 0 ? `${title}\n${items.map((item) => `- ${item}`).join('\n')}` : ''
}

export function formatChatConversationSummary(summary: ChatConversationSummaryContent) {
  return [
    '以下是当前同一会话中较早消息的压缩摘要。它不是跨会话 RAG，也不能覆盖最新原文或数据库工具结果：',
    formatSummarySection('稳定事实', summary.stableFacts),
    formatSummarySection('用户偏好', summary.userPreferences),
    formatSummarySection('已确认决策', summary.decisions),
    formatSummarySection('已完成操作', summary.completedActions),
    formatSummarySection('待继续事项', summary.unresolvedTopics),
    formatSummarySection('其他必要上下文', summary.otherContext),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function takeRecentMessagesWithinHardBudget(messages: ChatContextMessageRecord[], hardTokenBudget: number) {
  const kept: ChatContextMessageRecord[] = []
  let estimatedTokens = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const nextTokens = estimateMessageTokens(message)
    if (kept.length >= 8 && estimatedTokens + nextTokens > hardTokenBudget) break
    kept.push(message)
    estimatedTokens += nextTokens
  }

  return kept.reverse()
}

/** 为下一次模型调用装配“旧摘要 + 近期原文”，数据库原始消息不会被删除。 */
export function buildChatContextWindow(input: {
  messages: ChatContextMessageRecord[]
  summaryRecord: ChatConversationSummaryRecord | null
  policy?: ChatContextCompressionPolicy
}) {
  const policy = input.policy ?? defaultChatContextCompressionPolicy
  const parsedSummary = input.summaryRecord
    ? chatConversationSummaryContentSchema.safeParse(input.summaryRecord.summary)
    : null
  const usableSummary = parsedSummary?.success ? parsedSummary.data : null
  const summarizedThroughSequence = usableSummary ? input.summaryRecord!.summarizedThroughSequence : 0
  const unsummarizedMessages = input.messages.filter((message) => message.sequenceNumber > summarizedThroughSequence)
  const recentMessages = takeRecentMessagesWithinHardBudget(unsummarizedMessages, policy.hardRecentEstimatedTokens)

  return {
    recentMessages,
    summaryText: usableSummary ? formatChatConversationSummary(usableSummary) : null,
    summarizedThroughSequence,
    omittedUnsummarizedMessageCount: unsummarizedMessages.length - recentMessages.length,
  }
}

export function createChatSummaryTranscript(
  messages: ChatContextMessageRecord[],
  toolActions: ReadonlyArray<ChatToolActionContextRecord>,
) {
  return messages
    .flatMap((record) =>
      toProviderMessages([record], toolActions).map((message) => {
        if (message.role === 'tool') return `[工具结果]\n${message.content}`
        if (message.role === 'system') return `[内部事实约束]\n${message.content}`
        if (message.role === 'user') return `[用户]\n${message.content}`
        const label =
          record.status === 'cancelled'
            ? '[助手（用户取消后的不完整输出，仅可作为讨论线索，不得当成已确认事实）]'
            : '[助手]'
        return `${label}\n${message.content}`
      }),
    )
    .join('\n\n')
}

export function appendChatConversationSummaryToSystemPrompt(input: {
  systemPrompt: string
  summaryText: string | null
  omittedUnsummarizedMessageCount: number
}) {
  const sections = [input.systemPrompt]
  if (input.summaryText) sections.push(input.summaryText)
  if (input.omittedUnsummarizedMessageCount > 0) {
    sections.push(
      `有 ${input.omittedUnsummarizedMessageCount} 条较早且尚未完成摘要的消息因硬性上下文预算未载入。不要假装记得这些内容；信息不足时应向用户澄清。`,
    )
  }
  return sections.join('\n\n')
}

export function toSummaryJson(summary: ChatConversationSummaryContent): ChatJsonObject {
  return summary
}
