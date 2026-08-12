import crypto from 'node:crypto'
import type { ChatJsonObject, ChatRunEventType } from '@/shared/chat/schemas'
import type { AgentRunError } from '../ai/types'
import type {
  AppendAssistantMessageRecord,
  AppendChatRunEventRecord,
  PersistWaitingInputRecord,
  PersistWaitingConfirmationRecord,
  UpdateChatToolActionExecutionRecord,
  UpdateChatRunRecord,
} from '../../repositories/chat.repository'
import { toChatMessageParts } from './chat-message-mapper'
import {
  AgentRuntime,
  serializeAgentRuntimeCheckpoint,
  type AgentRuntimeConfirmationCheckpoint,
  type AgentRuntimeInputCheckpoint,
  type AgentRuntimeInput,
  type AgentModelCallObserver,
  type AgentRuntimeResult,
} from './agent-runtime'
import type { AgentToolRegistry } from './agent-tool'
import type { ModelProviderAdapter, ModelProviderMessage, ModelProviderStreamEvent } from './model-provider-adapter'
import type { ModelConnection } from '../../schemas/model.schema'

export type ChatRunPersistence = {
  updateRun(record: UpdateChatRunRecord): Promise<{ revision: number }>
  appendRunEvent(record: AppendChatRunEventRecord): Promise<{ run: { revision: number }; event: unknown }>
  appendAssistantMessage(record: AppendAssistantMessageRecord): Promise<{ id: string }>
  persistWaitingInput(
    record: PersistWaitingInputRecord,
  ): Promise<{ run: { revision: number }; toolAction: unknown; event?: unknown; duplicate: boolean }>
  persistWaitingConfirmation(
    record: PersistWaitingConfirmationRecord,
  ): Promise<{ run: { revision: number }; toolAction: unknown; event?: unknown; duplicate: boolean }>
  updateToolActionExecution?(record: UpdateChatToolActionExecutionRecord): Promise<unknown>
}

export type ChatRunContinuation =
  | {
      type: 'input'
      checkpoint: AgentRuntimeInputCheckpoint
      value: unknown
    }
  | {
      type: 'confirmation'
      checkpoint: AgentRuntimeConfirmationCheckpoint
      decision: 'approved' | 'rejected'
    }

export type ChatRunExecutionInput = {
  userId: string
  conversationId: string
  runId: string
  expectedRevision: number
  modelConnection: ModelConnection
  messages: ModelProviderMessage[]
  toolRegistry: AgentToolRegistry
  signal: AbortSignal
  maxModelCalls?: number
  maxToolCalls?: number
  getCancellationVisibleTextLength?: () => number | null
  continuation?: ChatRunContinuation
  modelCallObserver?: AgentModelCallObserver
}

export type ChatRunExecutorDependencies = {
  adapter: ModelProviderAdapter
  persistence: ChatRunPersistence
  now?: () => string
  createId?: () => string
}

class ChatRunCancelledError extends Error {
  code = 'cancelled' as const
  retryable = false

  constructor() {
    super('聊天任务已由用户停止')
    this.name = 'ChatRunCancelledError'
  }
}

function toError(error: unknown): AgentRunError {
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown } | null
  const knownCodes = new Set<AgentRunError['code']>([
    'structured_output_validation_failed',
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
    typeof candidate?.code === 'string' && knownCodes.has(candidate.code as AgentRunError['code'])
      ? (candidate.code as AgentRunError['code'])
      : 'unknown'

  return {
    code,
    message: typeof candidate?.message === 'string' ? candidate.message : '聊天任务执行失败',
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : code !== 'cancelled',
  }
}

function toEventPayload(event: ModelProviderStreamEvent): ChatJsonObject {
  if (event.type === 'text_delta') return { text: event.text }
  if (event.type === 'tool_call') {
    return {
      callId: event.callId,
      name: event.name,
      arguments: event.arguments,
    }
  }

  return {
    finishReason: event.finishReason,
    tokenUsage: event.tokenUsage,
  }
}

function toRunEventType(event: ModelProviderStreamEvent): ChatRunEventType {
  if (event.type === 'text_delta') return 'message_delta'
  if (event.type === 'tool_call') return 'tool_call_requested'
  return 'message_completed'
}

const textDeltaEventBatchChars = 48
const textDeltaEventBatchMs = 60

function prependTextSectionBreak(existingText: string, nextText: string) {
  if (!existingText.trim() || !nextText) return nextText

  const trailingNewlines = existingText.match(/\n*$/)?.[0].length ?? 0
  const leadingNewlines = nextText.match(/^\n*/)?.[0].length ?? 0
  const missingNewlines = Math.max(0, 2 - trailingNewlines - leadingNewlines)
  return `${'\n'.repeat(missingNewlines)}${nextText}`
}

function readContinuationLeadingText(continuation?: ChatRunContinuation) {
  const pendingAssistantMessage = continuation?.checkpoint.messages.at(-1)
  return pendingAssistantMessage?.role === 'assistant' ? pendingAssistantMessage.content : ''
}

/**
 * 连续的模型文本 delta 先在内存中短暂合并，再按顺序持久化。
 * 工具、完成、失败等边界事件会先等待文本写完，保证断线恢复时事件顺序不变。
 */
function createBufferedRunEventWriter(
  appendEvent: (eventType: ChatRunEventType, payload: ChatJsonObject) => Promise<unknown>,
) {
  let textBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let writeFailure: unknown = null
  let activeTextWrite: Promise<void> | null = null

  const clearFlushTimer = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
  }

  const startTextWrite = () => {
    clearFlushTimer()
    if (activeTextWrite || !textBuffer || writeFailure) return activeTextWrite

    activeTextWrite = (async () => {
      // 保持单飞：远程数据库写入尚未完成时，新 delta 继续合并进 textBuffer，
      // 而不是排成长队逐条等待。这样事件仍按顺序持久化，但慢数据库不会反向拖慢整次模型输出。
      while (textBuffer && !writeFailure) {
        const text = textBuffer
        textBuffer = ''
        try {
          await appendEvent('message_delta', { text })
        } catch (error) {
          writeFailure = error
          textBuffer = ''
        }
      }
    })().finally(() => {
      activeTextWrite = null
    })

    return activeTextWrite
  }

  const scheduleTextFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void startTextWrite()
    }, textDeltaEventBatchMs)
  }

  const drainText = async () => {
    clearFlushTimer()
    while (textBuffer || activeTextWrite) {
      if (writeFailure) throw writeFailure
      if (!activeTextWrite) startTextWrite()
      if (activeTextWrite) await activeTextWrite
    }
    if (writeFailure) throw writeFailure
  }

  return {
    async write(event: ModelProviderStreamEvent) {
      if (writeFailure) throw writeFailure

      if (event.type === 'text_delta') {
        textBuffer += event.text
        if (textBuffer.length >= textDeltaEventBatchChars) void startTextWrite()
        else scheduleTextFlush()
        return
      }

      // 工具调用和模型完成属于顺序边界：先把边界之前的文本写完，再写边界事件。
      await drainText()
      await appendEvent(toRunEventType(event), toEventPayload(event))
    },
    async flush() {
      await drainText()
    },
  }
}

function toToolActionRecord(
  input: ChatRunExecutionInput,
  result: Extract<AgentRuntimeResult, { status: 'waiting_confirmation' }>,
  expectedRevision: number,
  now: string,
): PersistWaitingConfirmationRecord {
  const { checkpoint } = result

  return {
    userId: input.userId,
    runId: input.runId,
    expectedRevision,
    updatedAt: now,
    checkpoint: serializeAgentRuntimeCheckpoint(checkpoint),
    toolAction: {
      id: checkpoint.toolActionId,
      toolName: checkpoint.pendingCall.name,
      toolVersion: checkpoint.toolVersion,
      input: checkpoint.confirmationPresentation
        ? {
            ...checkpoint.pendingCall.arguments,
            confirmationPresentation: checkpoint.confirmationPresentation,
          }
        : checkpoint.pendingCall.arguments,
      idempotencyKey: checkpoint.pendingCall.callId,
      createdAt: now,
      ...(checkpoint.confirmationPresentation ? { confirmationPresentation: checkpoint.confirmationPresentation } : {}),
    },
  }
}

function toToolInputRecord(
  input: ChatRunExecutionInput,
  result: Extract<AgentRuntimeResult, { status: 'waiting_input' }>,
  expectedRevision: number,
  now: string,
): PersistWaitingInputRecord {
  const { checkpoint } = result
  const definition = input.toolRegistry.get(checkpoint.pendingCall.name)
  if (!definition) throw new Error(`等待补充信息的工具已不存在：${checkpoint.pendingCall.name}`)

  return {
    userId: input.userId,
    runId: input.runId,
    expectedRevision,
    updatedAt: now,
    checkpoint: serializeAgentRuntimeCheckpoint(checkpoint),
    inputRequest: {
      toolActionId: checkpoint.toolActionId,
      requestId: checkpoint.requestId,
      toolName: checkpoint.pendingCall.name,
      toolVersion: checkpoint.toolVersion,
      input: checkpoint.pendingCall.arguments,
      missingArguments: checkpoint.missingArguments,
      presentation: checkpoint.inputPresentation,
      idempotencyKey: checkpoint.pendingCall.callId,
      requiresConfirmation: definition.requiresConfirmation,
      createdAt: now,
    },
  }
}

/**
 * 运行一次 ChatRun，并把 Runtime 结果转换成数据库状态、消息和事件。
 * 具体的模型 Adapter、工具注册表和模型连接由调用方注入。
 */
export async function executeChatRun(
  input: ChatRunExecutionInput,
  dependencies: ChatRunExecutorDependencies,
): Promise<AgentRuntimeResult> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? (() => crypto.randomUUID())
  const runtime = new AgentRuntime(dependencies.adapter)
  let revision = input.expectedRevision

  const updateRun = async (patch: UpdateChatRunRecord['patch']) => {
    const result = await dependencies.persistence.updateRun({
      userId: input.userId,
      runId: input.runId,
      expectedRevision: revision,
      updatedAt: now(),
      patch,
    })
    revision = result.revision
    return result
  }

  const appendEvent = async (
    eventType: ChatRunEventType,
    payload: ChatJsonObject,
    patch?: UpdateChatRunRecord['patch'],
  ) => {
    const result = await dependencies.persistence.appendRunEvent({
      userId: input.userId,
      runId: input.runId,
      expectedRevision: revision,
      updatedAt: now(),
      patch,
      event: {
        id: createId(),
        eventType,
        payload,
        createdAt: now(),
      },
    })
    revision = result.run.revision
    return result
  }
  const bufferedEventWriter = createBufferedRunEventWriter(appendEvent)
  // 等待确认前模型可能已经输出过引导语；续跑时必须带回最终消息，但不能重复写入 delta 事件。
  let streamedText = readContinuationLeadingText(input.continuation)
  let shouldSeparateNextText = Boolean(streamedText.trim())
  const continuationToolActionId = input.continuation?.checkpoint.toolActionId ?? null

  const runtimeInput: AgentRuntimeInput = {
    modelConnection: input.modelConnection,
    messages: input.messages,
    toolRegistry: input.toolRegistry,
    signal: input.signal,
    maxModelCalls: input.maxModelCalls,
    maxToolCalls: input.maxToolCalls,
    modelCallObserver: input.modelCallObserver,
    onEvent: async (event) => {
      if (event.type === 'text_delta') {
        const text = shouldSeparateNextText ? prependTextSectionBreak(streamedText, event.text) : event.text
        shouldSeparateNextText = false
        streamedText += text
        await bufferedEventWriter.write(text === event.text ? event : { type: 'text_delta', text })
        return
      }

      await bufferedEventWriter.write(event)
    },
    onToolStarted: async (call) => {
      if (continuationToolActionId && call.callId === input.continuation?.checkpoint.pendingCall.callId) {
        await dependencies.persistence.updateToolActionExecution?.({
          userId: input.userId,
          runId: input.runId,
          toolActionId: continuationToolActionId,
          expectedStatuses: ['pending'],
          updatedAt: now(),
          patch: { status: 'running', startedAt: now() },
        })
      }
      await appendEvent(
        'tool_call_started',
        {
          callId: call.callId,
          name: call.name,
        },
        { phase: 'executing_tool' },
      )
    },
    onToolResult: async (result) => {
      if (continuationToolActionId && result.call.callId === input.continuation?.checkpoint.pendingCall.callId) {
        await dependencies.persistence.updateToolActionExecution?.({
          userId: input.userId,
          runId: input.runId,
          toolActionId: continuationToolActionId,
          expectedStatuses: ['running'],
          updatedAt: now(),
          patch: { status: 'completed', output: result.output, completedAt: now() },
        })
      }
      await appendEvent(
        'tool_call_completed',
        {
          callId: result.call.callId,
          name: result.call.name,
          output: result.output,
        },
        { phase: 'calling_model' },
      )
      // 工具前若已经向用户输出过文字，下一次模型正文必须另起一段。
      // 分隔符写入持久化 delta，确保实时展示、取消截断和刷新恢复使用同一份文本。
      shouldSeparateNextText = Boolean(streamedText.trim())
    },
    onToolFailed: async ({ call, error, recoverable }) => {
      if (continuationToolActionId && call.callId === input.continuation?.checkpoint.pendingCall.callId) {
        await dependencies.persistence.updateToolActionExecution?.({
          userId: input.userId,
          runId: input.runId,
          toolActionId: continuationToolActionId,
          expectedStatuses: ['pending', 'running'],
          updatedAt: now(),
          patch: { status: 'failed', error: toError(error), completedAt: now() },
        })
      }
      await appendEvent(
        'tool_call_failed',
        {
          callId: call.callId,
          name: call.name,
          error: toError(error),
          recoverable,
        },
        recoverable ? { phase: 'calling_model' } : undefined,
      )
      if (recoverable) shouldSeparateNextText = Boolean(streamedText.trim())
    },
  }

  try {
    if (input.signal.aborted) throw new ChatRunCancelledError()
    await updateRun({ status: 'running', phase: 'initializing', startedAt: now() })
    await appendEvent('run_started', { continuation: Boolean(input.continuation) })

    const result = !input.continuation
      ? await runtime.run(runtimeInput)
      : input.continuation.type === 'input'
        ? await runtime.resumeInput(runtimeInput, input.continuation.checkpoint, input.continuation.value)
        : await runtime.resume(runtimeInput, input.continuation.checkpoint, input.continuation.decision)

    if (input.signal.aborted) throw new ChatRunCancelledError()

    if (result.status === 'waiting_input') {
      await dependencies.persistence.persistWaitingInput(toToolInputRecord(input, result, revision, now()))
      return result
    }

    if (result.status === 'waiting_confirmation') {
      const waitingRecord = toToolActionRecord(input, result, revision, now())
      await dependencies.persistence.persistWaitingConfirmation(waitingRecord)
      return result
    }

    if (!result.text.trim()) {
      throw new Error('模型完成了调用，但没有返回可展示的文字')
    }

    const createdAt = now()
    const finalText = streamedText || result.text
    const messageParts = toChatMessageParts(
      finalText,
      result.toolResults,
      continuationToolActionId
        ? { toolActionId: continuationToolActionId, leadingText: readContinuationLeadingText(input.continuation) }
        : undefined,
    )

    const outputMessage = await dependencies.persistence.appendAssistantMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      runId: input.runId,
      message: {
        id: createId(),
        role: 'assistant',
        status: 'completed',
        replacesMessageId: null,
        parts: messageParts,
        references: [],
        createdAt,
        completedAt: createdAt,
        updatedAt: createdAt,
      },
      updatedAt: createdAt,
    } satisfies AppendAssistantMessageRecord)

    await updateRun({
      status: 'completed',
      phase: null,
      outputMessageId: outputMessage.id,
      tokenUsage: result.completed.tokenUsage,
      runtimeState: null,
      finishedAt: createdAt,
    })
    await appendEvent('run_completed', { outputMessageId: outputMessage.id })

    return { ...result, text: finalText }
  } catch (error) {
    try {
      // 模型异常或取消前，把已经收到的部分文本按原顺序写完，避免并发修改 revision。
      await bufferedEventWriter.flush()
    } catch {
      // 原始执行错误优先；后续状态写入仍会按现有冲突保护决定是否成功。
    }
    const wasCancelled = input.signal.aborted || (error as { code?: unknown } | null)?.code === 'cancelled'
    const failure = wasCancelled ? toError(new ChatRunCancelledError()) : toError(error)
    const finishedAt = now()

    try {
      if (wasCancelled) {
        const visibleTextLength = input.getCancellationVisibleTextLength?.()
        const persistedText =
          typeof visibleTextLength === 'number'
            ? streamedText.slice(0, Math.min(visibleTextLength, streamedText.length))
            : streamedText
        const cancelledMessageText = persistedText.trim() ? persistedText : '用户已结束当前对话'
        const cancelledMessageParts = toChatMessageParts(
          cancelledMessageText,
          [],
          continuationToolActionId
            ? { toolActionId: continuationToolActionId, leadingText: readContinuationLeadingText(input.continuation) }
            : undefined,
        )
        const partialMessage = await dependencies.persistence.appendAssistantMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          runId: input.runId,
          message: {
            id: createId(),
            role: 'assistant',
            status: 'cancelled',
            replacesMessageId: null,
            parts: cancelledMessageParts,
            references: [],
            createdAt: finishedAt,
            completedAt: finishedAt,
            updatedAt: finishedAt,
          },
          updatedAt: finishedAt,
        } satisfies AppendAssistantMessageRecord)
        const outputMessageId = partialMessage.id

        await updateRun({
          status: 'cancelled',
          phase: null,
          outputMessageId,
          error: failure,
          finishedAt,
        })
        await appendEvent('run_cancelled', failure)
      } else {
        const failureNotice = '当前任务执行失败，请稍后再试'
        const failureMessageText = streamedText.trim() ? `${streamedText.trimEnd()}\n\n${failureNotice}` : failureNotice
        const failureMessage = await dependencies.persistence.appendAssistantMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          runId: input.runId,
          message: {
            id: createId(),
            role: 'assistant',
            status: 'failed',
            replacesMessageId: null,
            parts: toChatMessageParts(
              failureMessageText,
              [],
              continuationToolActionId
                ? {
                    toolActionId: continuationToolActionId,
                    leadingText: readContinuationLeadingText(input.continuation),
                  }
                : undefined,
            ),
            references: [],
            createdAt: finishedAt,
            completedAt: finishedAt,
            updatedAt: finishedAt,
          },
          updatedAt: finishedAt,
        } satisfies AppendAssistantMessageRecord)

        await updateRun({
          status: 'failed',
          phase: null,
          outputMessageId: failureMessage.id,
          error: failure,
          finishedAt,
        })
        await appendEvent('run_failed', failure)
      }
    } catch {
      // 原始错误优先返回；如果数据库也不可用，不能覆盖模型失败原因。
    }

    if (wasCancelled) throw new ChatRunCancelledError()
    throw error
  }
}
