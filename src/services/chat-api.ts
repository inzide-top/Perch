import type { ChatRunEventRecord, ChatRunSnapshot } from './chat-stream'
import { request } from './http'
import type {
  ChatConversationScopeType,
  ChatMessageReference,
  ChatMessageRole,
  ChatMessagePart,
  ChatMessageStatus,
  ChatJsonObject,
  ChatToolActionStatus,
  ChatToolUserDecision,
  ChatRunBudget,
} from '@/shared/chat/schemas'
import type { LlmConnectionSettings } from '@/types/settings'

export type ChatConversationRecord = {
  id: string
  title: string
  scopeType: ChatConversationScopeType
  opportunityId: string | null
  archivedAt: string | null
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export type ChatMessageRecord = {
  id: string
  conversationId: string
  chatRunId: string | null
  role: ChatMessageRole
  status: ChatMessageStatus
  sequenceNumber: number
  replacesMessageId: string | null
  parts: ChatMessagePart[]
  references: ChatMessageReference[]
  createdAt: string
  completedAt: string | null
  updatedAt: string
}

export type ChatRunRecord = ChatRunSnapshot & {
  conversationId: string
  modelSnapshot: unknown
  promptVersion: string
  budget: unknown
  tokenUsage: unknown
  input: unknown
  runtimeState: unknown
  createdAt: string
}

export type ChatRunEventsPage = {
  runId: string
  events: ChatRunEventRecord[]
  nextAfterSequence: number
  hasMore: boolean
}

export type ChatConversationDetail = {
  conversation: ChatConversationRecord
  messages: ChatMessageRecord[]
  toolActions: ChatToolActionRecord[]
}

export type ChatToolActionRecord = {
  id: string
  runId: string
  toolName: string
  toolVersion: string
  input: ChatJsonObject
  status: ChatToolActionStatus
  missingArguments: string[] | null
  requiresConfirmation: boolean
  userDecision: ChatToolUserDecision | null
  output: ChatJsonObject | null
  error: unknown
  idempotencyKey: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export type ListChatConversationsOptions = {
  cursor?: string
  limit?: number
  search?: string
  scopeType?: 'global' | 'opportunity'
  opportunityId?: string
  archived?: 'active' | 'archived' | 'all'
}

export type ChatConversationPage = {
  items: ChatConversationRecord[]
  total: number
  hasMore: boolean
  nextCursor: string | null
}

export type ChatTurnResult = {
  message: ChatMessageRecord
  run: ChatRunRecord
  duplicate: boolean
}

export type SendChatMessageOptions = {
  text: string
  modelConnection: LlmConnectionSettings
  references?: ChatMessageReference[]
  promptVersion?: string
  budget?: ChatRunBudget
}

export type ChatCommandInput =
  | {
      type: 'cancel_run'
      expectedRevision: number
      payload: { reason?: string; visibleTextLength?: number }
    }
  | {
      type: 'provide_input'
      expectedRevision: number
      payload: { requestId: string; value: unknown }
      modelConnection: LlmConnectionSettings
    }
  | {
      type: 'confirm_tool'
      expectedRevision: number
      payload: { toolActionId: string; decision: 'approved' | 'rejected' }
      modelConnection: LlmConnectionSettings
    }

export const chatApi = {
  listConversations(options: ListChatConversationsOptions = {}) {
    const query = new URLSearchParams()
    if (options.cursor) query.set('cursor', options.cursor)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.search) query.set('search', options.search)
    if (options.scopeType) query.set('scopeType', options.scopeType)
    if (options.opportunityId) query.set('opportunityId', options.opportunityId)
    if (options.archived) query.set('archived', options.archived)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return request.get<ChatConversationPage>(`/chat/conversations${suffix}`)
  },

  createConversation(input: { title: string; scopeType: ChatConversationScopeType; opportunityId?: string | null }) {
    return request.post<ChatConversationRecord>('/chat/conversations', {
      title: input.title,
      scopeType: input.scopeType,
      opportunityId: input.opportunityId ?? null,
    })
  },

  updateConversation(conversationId: string, input: { title?: string; archived?: boolean }) {
    return request.patch<ChatConversationRecord>(`/chat/conversations/${encodeURIComponent(conversationId)}`, input)
  },

  deleteConversation(conversationId: string) {
    return request.delete<{ conversationId: string; deleted: boolean }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
    )
  },

  getConversation(conversationId: string) {
    return request.get<ChatConversationDetail>(`/chat/conversations/${encodeURIComponent(conversationId)}`)
  },

  sendMessage(conversationId: string, input: SendChatMessageOptions) {
    return request.post<ChatTurnResult>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      commandId: crypto.randomUUID(),
      text: input.text,
      // label 只是前端乐观展示数据；服务端只接收 ID，并重新生成可信标签。
      references: (input.references ?? []).map((reference) => ({ type: reference.type, id: reference.id })),
      modelConnection: input.modelConnection,
      promptVersion: input.promptVersion ?? 'chat.v1',
      budget: input.budget ?? { maxModelCalls: 4, maxToolCalls: 8 },
    })
  },

  getRun(runId: string) {
    return request.get<ChatRunRecord>(`/chat/runs/${encodeURIComponent(runId)}`)
  },

  getRunEvents(runId: string, options: { afterSequence?: number; limit?: number } = {}) {
    const query = new URLSearchParams({
      afterSequence: String(options.afterSequence ?? 0),
      limit: String(options.limit ?? 200),
    })
    return request.get<ChatRunEventsPage>(`/chat/runs/${encodeURIComponent(runId)}/events/history?${query.toString()}`)
  },

  submitCommand(runId: string, input: ChatCommandInput) {
    return request.post<{ command: unknown; duplicate: boolean }>(`/chat/runs/${encodeURIComponent(runId)}/commands`, {
      commandId: crypto.randomUUID(),
      type: input.type,
      expectedRevision: input.expectedRevision,
      payload: input.payload,
      ...('modelConnection' in input ? { modelConnection: input.modelConnection } : {}),
    })
  },
}

export async function getAllChatRunEvents(runId: string, options: { pageSize?: number; maxPages?: number } = {}) {
  const pageSize = options.pageSize ?? 200
  const maxPages = options.maxPages ?? 100
  const events: ChatRunEventRecord[] = []
  let afterSequence = 0

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await chatApi.getRunEvents(runId, { afterSequence, limit: pageSize })
    events.push(...page.events)

    if (!page.hasMore || page.events.length === 0 || page.nextAfterSequence <= afterSequence) return events
    afterSequence = page.nextAfterSequence
  }

  throw new Error('聊天历史事件超过单次恢复上限，请稍后重试')
}
