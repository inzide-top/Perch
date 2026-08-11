import type {
  ChatConversationScopeType,
  ChatJsonObject,
  ChatMessagePart,
  ChatMessageStatus,
  ChatModelSnapshot,
  ChatRunEventType,
  ChatRunPhase,
  ChatRunStatus,
  ChatToolActionStatus,
} from '@/shared/chat/schemas'
import type { AgentRunError, AgentRunStatus, AgentTokenUsage } from '@/types/opportunity'
import { request } from './http'

export type ChatRunDebugItem = {
  id: string
  conversationId: string
  conversationTitle: string
  scopeType: ChatConversationScopeType
  opportunityId: string | null
  company: string | null
  jobTitle: string | null
  status: ChatRunStatus
  phase: ChatRunPhase | null
  revision: number
  modelSnapshot: ChatModelSnapshot
  promptVersion: string
  tokenUsage: AgentTokenUsage | null
  inputText: string
  error: AgentRunError | null
  agentRunCount: number
  toolActionCount: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type ChatRunDebugMessage = {
  id: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  parts: ChatMessagePart[]
  createdAt: string
  completedAt: string | null
}

export type ChatRunDebugModelCall = {
  id: string
  attemptNumber: number
  status: AgentRunStatus
  modelName: string
  promptVersion: string
  input: Record<string, unknown>
  rawOutput: string | null
  parsedOutput: Record<string, unknown> | null
  error: AgentRunError | null
  durationMs: number | null
  tokenUsage: AgentTokenUsage | null
  startedAt: string
  finishedAt: string | null
}

export type ChatRunDebugToolAction = {
  id: string
  toolName: string
  status: ChatToolActionStatus
  input: ChatJsonObject
  output: ChatJsonObject | null
  error: AgentRunError | null
  userDecision: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type ChatRunDebugEvent = {
  id: string
  sequence: number
  eventType: ChatRunEventType
  stateRevision: number
  payload: ChatJsonObject
  createdAt: string
}

export type ChatRunDebugDetail = {
  run: Omit<
    ChatRunDebugItem,
    | 'conversationTitle'
    | 'scopeType'
    | 'opportunityId'
    | 'company'
    | 'jobTitle'
    | 'inputText'
    | 'agentRunCount'
    | 'toolActionCount'
  > & {
    input: ChatJsonObject
    budget: ChatJsonObject
    runtimeState: ChatJsonObject | null
    inputMessageId: string
    outputMessageId: string | null
  }
  conversation: {
    id: string
    title: string
    scopeType: ChatConversationScopeType
    opportunityId: string | null
    archivedAt: string | null
  }
  company: string | null
  jobTitle: string | null
  inputMessage: ChatRunDebugMessage | null
  outputMessage: ChatRunDebugMessage | null
  modelCalls: ChatRunDebugModelCall[]
  toolActions: ChatRunDebugToolAction[]
  events: ChatRunDebugEvent[]
  deltaSummary: { batchCount: number; characterCount: number }
  memoryDocumentCount: number
}

export type ChatRunDebugListResponse = {
  items: ChatRunDebugItem[]
  hasMore: boolean
  nextCursor: string | null
}

export const chatRunDebugApi = {
  getRuns(
    options: {
      limit?: number
      cursor?: string
      status?: ChatRunStatus
      scopeType?: ChatConversationScopeType
      modelName?: string
      search?: string
    } = {},
  ) {
    const searchParams = new URLSearchParams({ limit: String(options.limit ?? 30) })
    if (options.cursor) searchParams.set('cursor', options.cursor)
    if (options.status) searchParams.set('status', options.status)
    if (options.scopeType) searchParams.set('scopeType', options.scopeType)
    if (options.modelName) searchParams.set('modelName', options.modelName)
    if (options.search) searchParams.set('search', options.search)
    return request.get<ChatRunDebugListResponse>(`/developer/chat-runs?${searchParams.toString()}`)
  },

  getRun(runId: string) {
    return request.get<ChatRunDebugDetail>(`/developer/chat-runs/${encodeURIComponent(runId)}`)
  },
}
