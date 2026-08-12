import crypto from 'node:crypto'
import { opportunityRepository } from '../repositories/opportunity.repository'
import {
  chatRepository,
  ChatRepositoryConflictError,
  ChatRepositoryNotFoundError,
} from '../repositories/chat.repository'
import {
  createChatCommandInputSchema,
  createChatConversationInputSchema,
  completeOpportunityImportItemsInputSchema,
  sendChatMessageInputSchema,
  type ChatBootstrapQuery,
  type ListChatConversationsQuery,
  updateChatConversationInputSchema,
  type ChatRunEventsQuery,
  type CreateChatCommandInput,
} from '../schemas/chat.schema'
import { getCurrentUserId } from '../context/current-user'
import { hashChatCommandPayload } from '../repositories/chat-command'
import { toProviderMessages } from './chat/chat-message-mapper'
import { cancelChatRun, launchChatRunInBackground, type ChatMemoryIndexContext } from './chat/chat-worker'
import { chatModelSnapshotSchema, chatRunBudgetSchema, type ChatRunStatus } from '@/shared/chat/schemas'
import { buildChatSystemPrompt } from './chat/chat-system-prompt'
import { parseAgentRuntimeCheckpoint } from './chat/agent-runtime'
import { createChatConversationAutoTitleRequest } from './chat/chat-title'
import { getChatStreamBoundary } from './chat/chat-sse'
import { getOpportunityContextForUser } from './chat/opportunity-context'
import {
  ChatMessageReferenceConflictError,
  ChatMessageReferenceNotFoundError,
  resolveChatMessageReferences,
  toReferenceContextMessage,
} from './chat/chat-message-references'
import {
  appendChatConversationSummaryToSystemPrompt,
  buildChatContextWindow,
  type ChatContextMessageRecord,
} from './chat/chat-context-window'

const terminalChatRunStatuses = new Set<ChatRunStatus>(['completed', 'failed', 'cancelled'])
const chatStreamPollIntervalMs = 250
const chatStreamKeepAliveIntervalMs = 15_000

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeModelBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLocaleLowerCase('en-US')
}

function assertRunModelConnection(
  run: { modelSnapshot: unknown },
  modelConnection: { modelName: string; baseUrl: string },
) {
  const modelSnapshot = chatModelSnapshotSchema.parse(run.modelSnapshot)
  if (
    modelSnapshot.modelName.trim() !== modelConnection.modelName.trim() ||
    normalizeModelBaseUrl(modelSnapshot.baseUrl) !== normalizeModelBaseUrl(modelConnection.baseUrl)
  ) {
    throw new ChatRepositoryConflictError('本次任务绑定的模型配置已变化，请切回原模型后再继续')
  }
}

function readChatMemoryIndexContext(input: unknown): ChatMemoryIndexContext | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as { text?: unknown; references?: unknown }
  if (typeof record.text !== 'string' || !record.text.trim()) return null

  const relatedOpportunityIds = Array.isArray(record.references)
    ? record.references.flatMap((reference) => {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return []
        const candidate = reference as { type?: unknown; id?: unknown }
        return candidate.type === 'opportunity' && typeof candidate.id === 'string' ? [candidate.id] : []
      })
    : []

  return {
    userText: record.text,
    relatedOpportunityIds: [...new Set(relatedOpportunityIds)],
  }
}

function toChatRunSnapshot(run: NonNullable<Awaited<ReturnType<typeof chatRepository.findRunById>>>) {
  return {
    id: run.id,
    status: run.status,
    phase: run.phase,
    revision: run.revision,
    outputMessageId: run.outputMessageId,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  }
}

function toPublicConversation(conversation: Awaited<ReturnType<typeof chatRepository.findConversationById>>) {
  if (!conversation) return null
  const { userId: _userId, ...publicConversation } = conversation
  return publicConversation
}

async function assertOpportunityOwnership(opportunityId: string, userId: string) {
  const ownership = await opportunityRepository.findOpportunityOwnership(opportunityId)
  if (!ownership || ownership.userId !== userId) {
    throw new ChatRepositoryNotFoundError('岗位机会不存在')
  }
}

export async function createChatConversation(input: unknown) {
  const parsed = createChatConversationInputSchema.parse(input)
  const userId = await getCurrentUserId()

  if (parsed.scopeType === 'opportunity' && parsed.opportunityId) {
    await assertOpportunityOwnership(parsed.opportunityId, userId)
  }

  const now = new Date().toISOString()
  const conversation = await chatRepository.createConversation({
    id: crypto.randomUUID(),
    userId,
    title: parsed.title,
    scopeType: parsed.scopeType,
    opportunityId: parsed.opportunityId,
    archivedAt: null,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return toPublicConversation(conversation)
}

function encodeConversationCursor(conversation: { updatedAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ updatedAt: conversation.updatedAt, id: conversation.id }), 'utf8').toString(
    'base64url',
  )
}

export async function getChatConversations(query: ListChatConversationsQuery) {
  const userId = await getCurrentUserId()
  return getChatConversationPage(userId, query)
}

async function getChatConversationPage(userId: string, query: ListChatConversationsQuery) {
  const result = await chatRepository.listConversationsByUserId({ userId, ...query })
  const hasMore = result.rows.length > query.limit
  const pageRows = result.rows.slice(0, query.limit)
  const conversations = pageRows.map(({ userId: _userId, ...conversation }) => conversation)

  return {
    items: conversations,
    total: result.total,
    hasMore,
    nextCursor: hasMore && pageRows.length > 0 ? encodeConversationCursor(pageRows[pageRows.length - 1]!) : null,
  }
}

async function getChatConversationDetailForUser(conversationId: string, userId: string) {
  const conversation = await chatRepository.findConversationById(conversationId, userId)
  if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')

  const [messages, toolActions] = await Promise.all([
    chatRepository.listMessagesByConversationId(conversationId, userId),
    chatRepository.listToolActionsByConversationId(conversationId, userId),
  ])
  return {
    conversation: toPublicConversation(conversation),
    messages,
    toolActions,
  }
}

export async function getChatBootstrap(query: ChatBootstrapQuery) {
  const userId = await getCurrentUserId()
  const conversations = await getChatConversationPage(userId, {
    limit: query.limit,
    search: undefined,
    archived: 'active',
  })

  const requestedConversation = query.selectedConversationId
    ? await chatRepository.findConversationById(query.selectedConversationId, userId)
    : null
  const selectedConversationSummary =
    requestedConversation && !requestedConversation.archivedAt
      ? toPublicConversation(requestedConversation)
      : (conversations.items.find((item) => item.scopeType === 'global') ?? conversations.items[0] ?? null)

  if (!selectedConversationSummary) {
    return { conversations, selectedConversation: null, activeRun: null }
  }

  if (!conversations.items.some((item) => item.id === selectedConversationSummary.id)) {
    conversations.items.unshift(selectedConversationSummary)
  }

  const [selectedConversation, activeRun] = await Promise.all([
    getChatConversationDetailForUser(selectedConversationSummary.id, userId),
    chatRepository.findLatestActiveRunByConversationId(selectedConversationSummary.id, userId),
  ])

  return {
    conversations,
    selectedConversation,
    activeRun: activeRun ? { ...toChatRunSnapshot(activeRun), conversationId: activeRun.conversationId } : null,
  }
}

export async function updateChatConversation(conversationId: string, input: unknown) {
  const parsed = updateChatConversationInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const now = new Date().toISOString()
  const conversation = await chatRepository.updateConversation({
    id: conversationId,
    userId,
    updatedAt: now,
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.archived !== undefined ? { archivedAt: parsed.archived ? now : null } : {}),
  })

  return toPublicConversation(conversation)
}

export async function deleteChatConversation(conversationId: string) {
  const userId = await getCurrentUserId()
  const deleted = await chatRepository.deleteConversation(conversationId, userId)
  return { conversationId: deleted.id, deleted: true }
}

export async function getChatConversation(conversationId: string) {
  const userId = await getCurrentUserId()
  return getChatConversationDetailForUser(conversationId, userId)
}

export async function completeChatOpportunityImportItems(messageId: string, input: unknown) {
  const parsed = completeOpportunityImportItemsInputSchema.parse(input)
  const userId = await getCurrentUserId()

  for (const item of parsed.items) {
    await assertOpportunityOwnership(item.opportunityId, userId)
  }

  return chatRepository.completeOpportunityImportItems({
    messageId,
    userId,
    items: parsed.items,
    updatedAt: new Date().toISOString(),
  })
}

export async function createChatTurn(conversationId: string, input: unknown) {
  const parsed = sendChatMessageInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const conversation = await chatRepository.findConversationById(conversationId, userId)
  if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')

  const opportunity = conversation.opportunityId
    ? await opportunityRepository.findOpportunityById(conversation.opportunityId)
    : null
  if (opportunity && opportunity.userId !== userId) {
    throw new ChatRepositoryNotFoundError('岗位机会不存在')
  }

  let resolvedReferences: Awaited<ReturnType<typeof resolveChatMessageReferences>>
  try {
    resolvedReferences = await resolveChatMessageReferences({
      userId,
      conversationOpportunityId: conversation.opportunityId,
      references: parsed.references,
      findOpportunityById: opportunityRepository.findOpportunityById.bind(opportunityRepository),
      getOpportunityContextForUser,
    })
  } catch (error) {
    if (error instanceof ChatMessageReferenceNotFoundError) {
      throw new ChatRepositoryNotFoundError(error.message)
    }
    if (error instanceof ChatMessageReferenceConflictError) {
      throw new ChatRepositoryConflictError(error.message)
    }
    throw error
  }
  const trustedReferences = resolvedReferences.map((item) => item.reference)
  const referenceContextMessage = toReferenceContextMessage(resolvedReferences)

  const [previousMessages, previousToolActions, conversationSummary] = await Promise.all([
    chatRepository.listMessagesByConversationId(conversationId, userId),
    chatRepository.listToolActionsByConversationId(conversationId, userId),
    chatRepository.findConversationSummary(conversationId, userId),
  ])
  const autoTitle = createChatConversationAutoTitleRequest({
    conversation,
    opportunity,
    previousMessages,
    currentUserText: parsed.text,
  })
  const systemPrompt = buildChatSystemPrompt({ scopeType: conversation.scopeType, opportunity })
  const contextWindow = buildChatContextWindow({
    messages: previousMessages as ChatContextMessageRecord[],
    summaryRecord: conversationSummary,
  })
  const systemPromptWithReferences = referenceContextMessage
    ? `${systemPrompt}\n\n${referenceContextMessage.content}`
    : systemPrompt
  const modelMessages = [
    {
      role: 'system' as const,
      // 维持整次模型请求只有一条首位 System Message，兼容要求 system 必须位于开头的供应商。
      content: appendChatConversationSummaryToSystemPrompt({
        systemPrompt: systemPromptWithReferences,
        summaryText: contextWindow.summaryText,
        omittedUnsummarizedMessageCount: contextWindow.omittedUnsummarizedMessageCount,
      }),
    },
    ...toProviderMessages(contextWindow.recentMessages, previousToolActions),
    { role: 'user' as const, content: parsed.text },
  ]
  const now = new Date().toISOString()
  const messageId = crypto.randomUUID()
  const commandPayload = {
    text: parsed.text,
    references: parsed.references,
    modelSnapshot: {
      modelName: parsed.modelConnection.modelName,
      baseUrl: parsed.modelConnection.baseUrl,
    },
    promptVersion: parsed.promptVersion,
    budget: parsed.budget,
  }

  const result = await chatRepository.createUserMessageAndRun({
    userId,
    conversationId,
    message: {
      id: messageId,
      role: 'user',
      status: 'completed',
      replacesMessageId: null,
      parts: [{ type: 'text', text: parsed.text }],
      references: trustedReferences,
      createdAt: now,
      completedAt: now,
      updatedAt: now,
    },
    run: {
      id: crypto.randomUUID(),
      status: 'queued',
      phase: null,
      revision: 1,
      modelSnapshot: {
        modelName: parsed.modelConnection.modelName,
        baseUrl: parsed.modelConnection.baseUrl,
      },
      promptVersion: parsed.promptVersion,
      budget: parsed.budget,
      tokenUsage: null,
      input: {
        text: parsed.text,
        references: trustedReferences,
      },
      runtimeState: null,
      error: null,
      retryOfRunId: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    },
    command: {
      id: crypto.randomUUID(),
      commandId: parsed.commandId,
      type: 'send_message',
      expectedRevision: null,
      payloadHash: hashChatCommandPayload({
        type: 'send_message',
        expectedRevision: null,
        payload: commandPayload,
      }),
      payload: commandPayload,
      status: 'accepted',
      result: null,
      rejectionCode: null,
      createdAt: now,
      handledAt: now,
    },
  })

  if (!result.duplicate) {
    void launchChatRunInBackground({
      userId,
      conversationId,
      scopeType: conversation.scopeType,
      opportunity,
      runId: result.run.id,
      expectedRevision: result.run.revision,
      modelConnection: parsed.modelConnection,
      promptVersion: parsed.promptVersion,
      messages: modelMessages,
      maxModelCalls: parsed.budget.maxModelCalls,
      maxToolCalls: parsed.budget.maxToolCalls,
      memoryIndex: {
        userText: parsed.text,
        relatedOpportunityIds: trustedReferences
          .filter((reference) => reference.type === 'opportunity')
          .map((reference) => reference.id),
      },
      ...(autoTitle ? { autoTitle } : {}),
    })
  }

  return result
}

export async function getChatRun(runId: string) {
  const userId = await getCurrentUserId()
  const run = await chatRepository.findRunById(runId, userId)
  if (!run) throw new ChatRepositoryNotFoundError('聊天运行不存在')

  return run
}

export async function getChatRunEvents(runId: string, query: ChatRunEventsQuery) {
  const userId = await getCurrentUserId()
  const run = await chatRepository.findRunById(runId, userId)
  if (!run) throw new ChatRepositoryNotFoundError('聊天运行不存在')

  const events = await chatRepository.listRunEventsAfter({
    runId,
    userId,
    afterSequence: query.afterSequence,
    limit: query.limit,
  })

  return {
    runId,
    events,
    nextAfterSequence: events.at(-1)?.sequence ?? query.afterSequence,
    hasMore: events.length === query.limit,
  }
}

export async function streamChatRunEvents(
  runId: string,
  query: ChatRunEventsQuery,
  write: (eventName: string, payload: unknown) => void,
  signal: AbortSignal,
) {
  const userId = await getCurrentUserId()
  let run = await chatRepository.findRunById(runId, userId)
  if (!run) throw new ChatRepositoryNotFoundError('聊天运行不存在')

  let afterSequence = query.afterSequence
  let lastSentAt = Date.now()
  const emit = (eventName: string, payload: unknown) => {
    write(eventName, payload)
    lastSentAt = Date.now()
  }

  emit('chat.run_snapshot', toChatRunSnapshot(run))

  while (!signal.aborted) {
    const events = await chatRepository.listRunEventsAfter({
      runId,
      userId,
      afterSequence,
      limit: query.limit,
    })

    for (const event of events) {
      if (signal.aborted) return
      emit('chat.run_event', { runId, event })
      afterSequence = event.sequence
    }

    run = await chatRepository.findRunById(runId, userId)
    if (!run) throw new ChatRepositoryNotFoundError('聊天运行不存在')

    const streamBoundary = getChatStreamBoundary(run.status, events.length > 0)
    if (streamBoundary === 'suspended') {
      emit('chat.run_suspended', { runId, status: run.status })
      return
    }

    if (streamBoundary === 'completed') {
      emit('chat.run_complete', { runId, status: run.status })
      return
    }

    if (Date.now() - lastSentAt >= chatStreamKeepAliveIntervalMs) {
      emit('chat.keepalive', { runId })
    }

    await sleep(chatStreamPollIntervalMs)
  }
}

function toCommandRecord(input: CreateChatCommandInput, runId: string, conversationId: string, now: string) {
  return {
    conversationId,
    runId,
    command: {
      id: crypto.randomUUID(),
      commandId: input.commandId,
      type: input.type,
      expectedRevision: input.expectedRevision,
      payloadHash: hashChatCommandPayload({
        type: input.type,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      }),
      payload: input.payload,
      status: 'accepted' as const,
      result: null,
      rejectionCode: null,
      createdAt: now,
      handledAt: null,
    },
  }
}

export async function submitChatCommand(runId: string, input: unknown) {
  const parsed = createChatCommandInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const run = await chatRepository.findRunById(runId, userId)
  if (!run) throw new ChatRepositoryNotFoundError('聊天运行不存在')

  const commandRecord = toCommandRecord(parsed, runId, run.conversationId, new Date().toISOString())
  if (parsed.type === 'provide_input') {
    assertRunModelConnection(run, parsed.modelConnection)
    const result = await chatRepository.recordInputCommand({ ...commandRecord, userId })
    if (result.duplicate) return result
    if (!result.run || !result.toolAction) {
      throw new ChatRepositoryConflictError('补充信息结果缺少运行或工具动作信息')
    }

    const conversation = await chatRepository.findConversationById(run.conversationId, userId)
    if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')
    const opportunity = conversation.opportunityId
      ? await opportunityRepository.findOpportunityById(conversation.opportunityId)
      : null
    if (opportunity && opportunity.userId !== userId) throw new ChatRepositoryNotFoundError('岗位机会不存在')

    const checkpoint = parseAgentRuntimeCheckpoint(result.run.runtimeState)
    if (!('requestId' in checkpoint) || checkpoint.requestId !== parsed.payload.requestId) {
      throw new ChatRepositoryConflictError('补充信息请求与运行断点不一致')
    }
    if (checkpoint.toolActionId !== result.toolAction.id) {
      throw new ChatRepositoryConflictError('补充信息工具动作与运行断点不一致')
    }
    const budget = chatRunBudgetSchema.parse(result.run.budget)
    const memoryIndex = readChatMemoryIndexContext(result.run.input)

    void launchChatRunInBackground({
      userId,
      conversationId: conversation.id,
      scopeType: conversation.scopeType,
      opportunity,
      runId: result.run.id,
      expectedRevision: result.run.revision,
      modelConnection: parsed.modelConnection,
      promptVersion: result.run.promptVersion,
      messages: checkpoint.messages,
      maxModelCalls: budget.maxModelCalls,
      maxToolCalls: budget.maxToolCalls,
      continuation: { type: 'input', checkpoint, value: parsed.payload.value },
      ...(memoryIndex ? { memoryIndex } : {}),
    })
    return result
  }

  if (parsed.type === 'confirm_tool') {
    assertRunModelConnection(run, parsed.modelConnection)

    const result = await chatRepository.recordConfirmationCommand({ ...commandRecord, userId })
    if (result.duplicate) return result
    if (!result.run || !result.toolAction) {
      throw new ChatRepositoryConflictError('确认结果缺少运行或工具动作信息')
    }

    const conversation = await chatRepository.findConversationById(run.conversationId, userId)
    if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')
    const opportunity = conversation.opportunityId
      ? await opportunityRepository.findOpportunityById(conversation.opportunityId)
      : null
    if (opportunity && opportunity.userId !== userId) {
      throw new ChatRepositoryNotFoundError('岗位机会不存在')
    }

    const checkpoint = parseAgentRuntimeCheckpoint(result.run.runtimeState)
    if ('requestId' in checkpoint) {
      throw new ChatRepositoryConflictError('当前运行断点仍在等待补充信息')
    }
    if (checkpoint.toolActionId !== result.toolAction.id) {
      throw new ChatRepositoryConflictError('确认工具动作与运行断点不一致')
    }
    const budget = chatRunBudgetSchema.parse(result.run.budget)
    const memoryIndex = readChatMemoryIndexContext(result.run.input)
    const inputText = memoryIndex?.userText ?? ''
    const previousMessages = await chatRepository.listMessagesByConversationId(conversation.id, userId)
    const autoTitle = inputText
      ? createChatConversationAutoTitleRequest({
          conversation,
          opportunity,
          previousMessages,
          currentUserText: inputText,
        })
      : null

    void launchChatRunInBackground({
      userId,
      conversationId: conversation.id,
      scopeType: conversation.scopeType,
      opportunity,
      runId: result.run.id,
      expectedRevision: result.run.revision,
      modelConnection: parsed.modelConnection,
      promptVersion: result.run.promptVersion,
      // resume 直接读取 checkpoint.messages；这里保留同一份消息仅用于统一 Worker 输入契约。
      messages: checkpoint.messages,
      maxModelCalls: budget.maxModelCalls,
      maxToolCalls: budget.maxToolCalls,
      continuation: { type: 'confirmation', checkpoint, decision: parsed.payload.decision },
      ...(memoryIndex ? { memoryIndex } : {}),
      ...(autoTitle ? { autoTitle } : {}),
    })

    return result
  }

  const result = await chatRepository.recordCommand({ ...commandRecord, userId })
  if (parsed.type === 'cancel_run') {
    const cancellationSettled = cancelChatRun(runId, parsed.payload.visibleTextLength)
    if (cancellationSettled) {
      await cancellationSettled
    } else {
      await chatRepository.cancelDetachedRun({
        userId,
        runId,
        visibleTextLength: parsed.payload.visibleTextLength,
        ...(parsed.payload.reason === 'interview_schedule_input_cancelled'
          ? { cancelledMessage: '已取消创建面试安排。' }
          : parsed.payload.reason === 'mock_interview_input_cancelled'
            ? { cancelledMessage: '已取消创建模拟面试。' }
            : parsed.payload.reason === 'review_input_cancelled'
              ? { cancelledMessage: '已取消填写复盘。' }
              : parsed.payload.reason === 'opportunity_termination_input_cancelled'
                ? { cancelledMessage: '已取消终止机会流程。' }
                : parsed.payload.reason === 'opportunity_target_cancelled'
                  ? { cancelledMessage: '已取消选择机会。' }
                  : {}),
        commandRecordId: result.command.id,
        updatedAt: new Date().toISOString(),
      })
    }

    const settledRun = await chatRepository.findRunById(runId, userId)
    if (!settledRun) throw new ChatRepositoryNotFoundError('聊天运行不存在')
    if (!terminalChatRunStatuses.has(settledRun.status)) {
      throw new ChatRepositoryConflictError('停止操作尚未完成，请稍后重试')
    }
  }

  return result
}
