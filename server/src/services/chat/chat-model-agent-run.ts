import crypto from 'node:crypto'
import type { AgentRunError } from '@/types/opportunity'
import type {
  CompleteChatModelCallRunRecord,
  FailChatModelCallRunRecord,
  StartChatModelCallRunRecord,
} from '../../repositories/agent-run.repository'
import type { AgentModelCallObserver } from './agent-runtime'

export type ChatModelCallPersistence = {
  startChatModelCall: (run: StartChatModelCallRunRecord) => Promise<unknown>
  completeChatModelCall: (record: CompleteChatModelCallRunRecord) => Promise<unknown>
  failChatModelCall: (record: FailChatModelCallRunRecord) => Promise<unknown>
}

export type CreateChatModelAgentRunObserverInput = {
  chatRunId: string
  modelName: string
  promptVersion: string
}

type CreateChatModelAgentRunObserverDependencies = {
  persistence: ChatModelCallPersistence
  createId?: () => string
  now?: () => string
  onError?: (error: unknown, input: { callNumber: number; stage: 'started' | 'completed' | 'failed' }) => void
}

function operationKey(chatRunId: string, callNumber: number) {
  return `chat:${chatRunId}:model-call:${callNumber}`
}

function toAgentRunError(error: unknown, cancelled: boolean): AgentRunError {
  if (cancelled) return { code: 'cancelled', message: '模型调用已由用户停止', retryable: false }

  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown } | null
  const supportedCodes = new Set<AgentRunError['code']>([
    'model_request_failed',
    'model_quota_exhausted',
    'model_authentication_failed',
    'model_configuration_invalid',
    'timeout',
    'rate_limited',
    'cancelled',
    'unknown',
  ])
  const code =
    typeof candidate?.code === 'string' && supportedCodes.has(candidate.code as AgentRunError['code'])
      ? (candidate.code as AgentRunError['code'])
      : 'unknown'

  return {
    code,
    message: typeof candidate?.message === 'string' ? candidate.message : '聊天模型调用失败',
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : true,
  }
}

/**
 * 把一次 ChatRun 内部的每次主流程模型调用记录成关联 AgentRun。
 * 这里只保存输入规模和工具名单，不复制完整历史消息，也永远不会接触 API Key。
 */
export function createChatModelAgentRunObserver(
  input: CreateChatModelAgentRunObserverInput,
  dependencies: CreateChatModelAgentRunObserverDependencies,
): AgentModelCallObserver {
  const persistence = dependencies.persistence
  const createId = dependencies.createId ?? (() => crypto.randomUUID())
  const now = dependencies.now ?? (() => new Date().toISOString())

  return {
    async onStarted(call) {
      const messageCharacters = call.messages.reduce((total, message) => total + message.content.length, 0)
      await persistence.startChatModelCall({
        id: createId(),
        workflowType: 'chat_turn',
        analysisId: null,
        interviewSessionId: null,
        interviewTurnId: null,
        chatRunId: input.chatRunId,
        reviewDocumentId: null,
        actionStrategySnapshotId: null,
        operationKey: operationKey(input.chatRunId, call.callNumber),
        attemptNumber: 1,
        status: 'processing',
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        input: {
          callNumber: call.callNumber,
          messageCount: call.messages.length,
          messageRoles: call.messages.map((message) => message.role),
          messageCharacters,
          toolNames: call.tools.map((tool) => tool.name),
        },
        rawOutput: null,
        parsedOutput: null,
        error: null,
        durationMs: null,
        tokenUsage: null,
        startedAt: now(),
        finishedAt: null,
      })
    },
    async onCompleted(call) {
      await persistence.completeChatModelCall({
        operationKey: operationKey(input.chatRunId, call.callNumber),
        rawOutput: call.text,
        parsedOutput: {
          finishReason: call.completed.finishReason,
          toolCalls: call.toolCalls.map((toolCall) => ({
            callId: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
          ...(call.completed.reasoningContent ? { reasoningContent: call.completed.reasoningContent } : {}),
        },
        tokenUsage: call.completed.tokenUsage,
        durationMs: call.durationMs,
        finishedAt: now(),
      })
    },
    async onFailed(call) {
      await persistence.failChatModelCall({
        operationKey: operationKey(input.chatRunId, call.callNumber),
        error: toAgentRunError(call.error, call.cancelled),
        durationMs: call.durationMs,
        finishedAt: now(),
        cancelled: call.cancelled,
      })
    },
    onObserverError(error, context) {
      dependencies.onError?.(error, context)
    },
  }
}
