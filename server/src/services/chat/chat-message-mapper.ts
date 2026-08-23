import {
  chatOpportunityImportResultPartSchema,
  chatOpportunitySearchResultPartSchema,
  type ChatMessagePart,
  type ChatToolActionStatus,
} from '@/shared/chat/schemas'
import type { AgentToolResult } from './agent-runtime'
import type { ModelProviderMessage } from './model-provider-adapter'
import { toUserVisibleChatText } from '@/shared/chat/user-visible-text'

export type ChatMessageRecord = {
  role: 'user' | 'assistant'
  status?: 'streaming' | 'completed' | 'cancelled' | 'failed'
  parts: ReadonlyArray<{ type: string; text?: unknown; [key: string]: unknown }>
}

export type ChatToolActionContextRecord = {
  id: string
  toolName: string
  status: ChatToolActionStatus
}

export type ChatConfirmationPartPlacement = {
  toolActionIds: string[]
  leadingText: string
}

function createHistoricalToolContext(
  record: ChatMessageRecord,
  toolActionsById: ReadonlyMap<string, ChatToolActionContextRecord>,
) {
  if (record.role !== 'assistant') return ''

  const relatedActions = record.parts.flatMap((part) => {
    if (part.type !== 'tool_action' || typeof part.toolActionId !== 'string') return []
    const action = toolActionsById.get(part.toolActionId)
    return action ? [action] : []
  })
  if (relatedActions.length === 0) return ''

  const toolNames = [...new Set(relatedActions.map((action) => action.toolName))].join('、')
  const allCompleted = relatedActions.every((action) => action.status === 'completed')

  const executionState = allCompleted
    ? `关联工具 ${toolNames} 已真实执行完成，相关修改可作为已发生事实。`
    : `关联工具 ${toolNames} 未全部执行完成，不能据此认定数据库已经修改。`

  return `内部历史工具状态：${executionState} 此控制信息仅供判断数据库事实，不得在面向用户的回答中引用、复述或解释。`
}

/**
 * 将数据库消息转换成模型上下文。
 * 工具卡片不会作为正文发送，但会依据持久化 ToolAction 状态补充可信执行标记，
 * 避免模型从“已修改完成”这类孤立历史文字中学到可以绕过工具。
 */
export function toProviderMessages(
  records: ReadonlyArray<ChatMessageRecord>,
  toolActions: ReadonlyArray<ChatToolActionContextRecord> = [],
): ModelProviderMessage[] {
  const toolActionsById = new Map(toolActions.map((action) => [action.id, action]))

  return records.flatMap((record) => {
    // 失败提示只属于产品 UI，不能作为助手事实再次喂给模型。
    if (record.role === 'assistant' && record.status === 'failed') return []

    const text = record.parts
      .filter((part): part is typeof part & { text: string } => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
    const visibleText = record.role === 'assistant' ? toUserVisibleChatText(text) : text
    const historicalToolContext = createHistoricalToolContext(record, toolActionsById)
    const visibleMessage = visibleText.trim()
      ? [{ role: record.role, content: visibleText } as ModelProviderMessage]
      : []
    const internalContext = historicalToolContext ? [{ role: 'system' as const, content: historicalToolContext }] : []

    return [...internalContext, ...visibleMessage]
  })
}

/**
 * 把 Runtime 的工具结果转成用户可恢复的消息 Part。
 * 模型只能生成文字；卡片由服务端根据真实工具结果构造并再次校验。
 */
export function toChatMessageParts(
  text: string,
  toolResults: ReadonlyArray<AgentToolResult>,
  confirmation?: ChatConfirmationPartPlacement,
): ChatMessagePart[] {
  const parts: ChatMessagePart[] = []

  if (confirmation) {
    const leadingTextLength = text.startsWith(confirmation.leadingText) ? confirmation.leadingText.length : 0
    const leadingText = text.slice(0, leadingTextLength)
    const trailingText = text.slice(leadingTextLength)

    if (leadingText.trim()) parts.push({ type: 'text', text: leadingText })
    for (const toolActionId of confirmation.toolActionIds) {
      parts.push({ type: 'tool_action', toolActionId })
    }
    if (trailingText.trim()) parts.push({ type: 'text', text: trailingText })
  } else if (text.trim()) {
    parts.push({ type: 'text', text })
  }

  for (const result of toolResults) {
    if (result.call.name === 'import_opportunities_from_urls' || result.call.name === 'import_opportunity_from_text') {
      const parsedImportResult = chatOpportunityImportResultPartSchema.safeParse({
        type: 'opportunity_import_result',
        mode: result.output.mode,
        items: result.output.items,
      })
      if (parsedImportResult.success) parts.push(parsedImportResult.data)
      continue
    }

    if (result.call.name !== 'search_opportunities') continue

    const output = result.output
    const candidate = {
      type: 'opportunity_search_result' as const,
      query: output.query,
      matchedCount: output.matchedCount,
      returnedCount: output.returnedCount,
      hasMore: output.hasMore,
      items: Array.isArray(output.opportunities)
        ? output.opportunities.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return []
            const record = item as Record<string, unknown>
            return [
              {
                opportunityId: record.id,
                company: record.company,
                jobTitle: record.jobTitle,
                status: record.status,
                statusLabel: record.statusLabel,
                intentionLevel: record.intentionLevel,
                industry: record.industry,
                address: record.address,
                matchScore: record.matchScore,
                updatedAt: record.updatedAt,
              },
            ]
          })
        : [],
    }

    const parsed = chatOpportunitySearchResultPartSchema.safeParse(candidate)
    if (parsed.success) parts.push(parsed.data)
  }

  return parts
}
