import crypto from 'node:crypto'
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, max, or, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { chatCommands, chatConversations, chatMessages, chatRunEvents, chatRuns, chatToolActions } from '../db/schema'
import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'
import type {
  ChatJsonObject,
  ChatMessageRole,
  ChatRunPhase,
  ChatRunStatus,
  ChatToolActionStatus,
  ChatToolUserDecision,
} from '@/shared/chat/schemas'
import { chatCommandReplayMatches } from './chat-command'

type ChatConversationInsert = typeof chatConversations.$inferInsert
type ChatMessageInsert = typeof chatMessages.$inferInsert
type ChatRunInsert = typeof chatRuns.$inferInsert
type ChatRunEventInsert = typeof chatRunEvents.$inferInsert
type ChatCommandInsert = typeof chatCommands.$inferInsert
type ChatToolActionInsert = typeof chatToolActions.$inferInsert

export type ChatMessageInput = Omit<ChatMessageInsert, 'conversationId' | 'chatRunId' | 'sequenceNumber'> & {
  role: ChatMessageRole
}

export type CreateChatTurnRecord = {
  userId: string
  conversationId: string
  message: Omit<ChatMessageInput, 'role'> & { role: 'user' }
  run: Omit<ChatRunInsert, 'conversationId' | 'inputMessageId'>
  command: Omit<ChatCommandInsert, 'conversationId' | 'runId'> & {
    type: 'send_message'
    expectedRevision: null
  }
}

export type UpdateChatConversationRecord = {
  id: string
  userId: string
  updatedAt: string
  title?: string
  archivedAt?: string | null
}

export type UpdateChatConversationTitleIfUnchangedRecord = {
  id: string
  userId: string
  expectedTitle: string
  title: string
  updatedAt: string
}

export type ListChatConversationsRecord = {
  userId: string
  limit: number
  search?: string
  scopeType?: 'global' | 'opportunity'
  opportunityId?: string
  archived: 'active' | 'archived' | 'all'
  cursor?: {
    updatedAt: string
    id: string
  }
}

export type AppendAssistantMessageRecord = {
  userId: string
  conversationId: string
  runId: string
  message: Omit<ChatMessageInput, 'role'> & { role: 'assistant' }
  updatedAt: string
}

export type ChatRunStatePatch = {
  status?: ChatRunStatus
  phase?: ChatRunPhase | null
  outputMessageId?: string | null
  tokenUsage?: AgentTokenUsage | null
  runtimeState?: ChatJsonObject | null
  error?: AgentRunError | null
  startedAt?: string | null
  finishedAt?: string | null
}

export type UpdateChatRunRecord = {
  userId: string
  runId: string
  expectedRevision: number
  updatedAt: string
  patch: ChatRunStatePatch
}

export type AppendChatRunEventRecord = {
  userId: string
  runId: string
  expectedRevision: number
  updatedAt: string
  patch?: ChatRunStatePatch
  event: Omit<ChatRunEventInsert, 'runId' | 'sequence' | 'stateRevision'>
}

export type CancelDetachedChatRunRecord = {
  userId: string
  runId: string
  visibleTextLength?: number
  cancelledMessage?: string
  commandRecordId: string
  updatedAt: string
}

export type PersistWaitingConfirmationRecord = {
  userId: string
  runId: string
  expectedRevision: number
  updatedAt: string
  checkpoint: ChatJsonObject
  toolAction: {
    id: string
    toolName: string
    toolVersion: string
    input: ChatJsonObject
    idempotencyKey: string
    createdAt: string
    confirmationPresentation?: ChatJsonObject
  }
}

export type PersistWaitingInputRecord = {
  userId: string
  runId: string
  expectedRevision: number
  updatedAt: string
  checkpoint: ChatJsonObject
  inputRequest: {
    toolActionId: string
    requestId: string
    toolName: string
    toolVersion: string
    input: ChatJsonObject
    missingArguments: string[]
    presentation: ChatJsonObject
    idempotencyKey: string
    requiresConfirmation: boolean
    createdAt: string
  }
}

export type UpdateChatToolActionExecutionRecord = {
  userId: string
  runId: string
  toolActionId: string
  expectedStatuses: ChatToolActionStatus[]
  updatedAt: string
  patch: Pick<ChatToolActionInsert, 'status'> &
    Partial<Pick<ChatToolActionInsert, 'output' | 'error' | 'startedAt' | 'completedAt'>>
}

export type CreateChatCommandRecord = {
  userId: string
  conversationId: string
  runId?: string | null
  command: Omit<ChatCommandInsert, 'conversationId' | 'runId' | 'expectedRevision'> & {
    expectedRevision: number
  }
}

export class ChatRepositoryNotFoundError extends Error {
  statusCode = 404

  constructor(message: string) {
    super(message)
    this.name = 'ChatRepositoryNotFoundError'
  }
}

export class ChatRepositoryConflictError extends Error {
  statusCode = 409

  constructor(message: string) {
    super(message)
    this.name = 'ChatRepositoryConflictError'
  }
}

function applyRunPatch(updates: Partial<ChatRunInsert>, patch: ChatRunStatePatch) {
  if (patch.status !== undefined) updates.status = patch.status
  if (patch.phase !== undefined) updates.phase = patch.phase
  if (patch.outputMessageId !== undefined) updates.outputMessageId = patch.outputMessageId
  if (patch.tokenUsage !== undefined) updates.tokenUsage = patch.tokenUsage
  if (patch.runtimeState !== undefined) updates.runtimeState = patch.runtimeState
  if (patch.error !== undefined) updates.error = patch.error
  if (patch.startedAt !== undefined) updates.startedAt = patch.startedAt
  if (patch.finishedAt !== undefined) updates.finishedAt = patch.finishedAt
}

function readConfirmationPayload(payload: ChatJsonObject) {
  if (
    typeof payload.toolActionId !== 'string' ||
    (payload.decision !== 'approved' && payload.decision !== 'rejected')
  ) {
    throw new ChatRepositoryConflictError('确认工具 Command 的参数不完整')
  }

  return {
    toolActionId: payload.toolActionId,
    decision: payload.decision as Extract<ChatToolUserDecision, 'approved' | 'rejected'>,
  }
}

function readInputPayload(payload: ChatJsonObject) {
  if (typeof payload.requestId !== 'string' || !('value' in payload)) {
    throw new ChatRepositoryConflictError('补充信息 Command 的参数不完整')
  }
  return { requestId: payload.requestId, value: payload.value }
}

function readInputCheckpointIdentity(runtimeState: ChatJsonObject | null) {
  if (
    !runtimeState ||
    runtimeState.kind !== 'agent_runtime_input_checkpoint' ||
    typeof runtimeState.requestId !== 'string' ||
    typeof runtimeState.toolActionId !== 'string'
  ) {
    throw new ChatRepositoryConflictError('聊天运行缺少等待输入断点')
  }
  return { requestId: runtimeState.requestId, toolActionId: runtimeState.toolActionId }
}

export class DrizzleChatRepository {
  async createConversation(record: ChatConversationInsert) {
    const [conversation] = await db.insert(chatConversations).values(record).returning()
    return conversation
  }

  async findConversationById(conversationId: string, userId: string) {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, userId)))
      .limit(1)
    return conversation ?? null
  }

  async listConversationsByUserId(record: ListChatConversationsRecord) {
    const filters: SQL[] = [eq(chatConversations.userId, record.userId)]
    if (record.search) filters.push(ilike(chatConversations.title, `%${record.search}%`))
    if (record.scopeType) filters.push(eq(chatConversations.scopeType, record.scopeType))
    if (record.opportunityId) filters.push(eq(chatConversations.opportunityId, record.opportunityId))
    if (record.archived === 'active') filters.push(isNull(chatConversations.archivedAt))
    if (record.archived === 'archived') filters.push(isNotNull(chatConversations.archivedAt))

    const cursorFilter = record.cursor
      ? or(
          lt(chatConversations.updatedAt, record.cursor.updatedAt),
          and(eq(chatConversations.updatedAt, record.cursor.updatedAt), lt(chatConversations.id, record.cursor.id)),
        )
      : undefined

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(chatConversations)
        .where(and(...filters, cursorFilter))
        .orderBy(desc(chatConversations.updatedAt), desc(chatConversations.id))
        .limit(record.limit + 1),
      db
        .select({ value: count() })
        .from(chatConversations)
        .where(and(...filters)),
    ])

    return {
      rows,
      total: totalRow?.value ?? 0,
    }
  }

  async updateConversation(record: UpdateChatConversationRecord) {
    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(chatConversations)
        .where(and(eq(chatConversations.id, record.id), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!conversation) {
        throw new ChatRepositoryNotFoundError('聊天会话不存在')
      }

      const isArchiving = record.archivedAt !== undefined && record.archivedAt !== null
      if (isArchiving) {
        const [activeRun] = await tx
          .select({ id: chatRuns.id })
          .from(chatRuns)
          .where(
            and(
              eq(chatRuns.conversationId, record.id),
              inArray(chatRuns.status, ['queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling']),
            ),
          )
          .limit(1)

        if (activeRun) {
          throw new ChatRepositoryConflictError('执行中的会话不能归档，请先停止当前任务')
        }
      }

      const updates: Partial<ChatConversationInsert> = { updatedAt: record.updatedAt }
      if (record.title !== undefined) updates.title = record.title
      if (record.archivedAt !== undefined) updates.archivedAt = record.archivedAt

      const [updated] = await tx
        .update(chatConversations)
        .set(updates)
        .where(eq(chatConversations.id, record.id))
        .returning()

      if (!updated) {
        throw new ChatRepositoryConflictError('聊天会话更新失败')
      }

      return updated
    })
  }

  /** AI 自动命名只能覆盖它开始生成时看到的占位标题，不能覆盖用户稍后手动修改的标题。 */
  async updateConversationTitleIfUnchanged(record: UpdateChatConversationTitleIfUnchangedRecord) {
    const [updated] = await db
      .update(chatConversations)
      .set({ title: record.title, updatedAt: record.updatedAt })
      .where(
        and(
          eq(chatConversations.id, record.id),
          eq(chatConversations.userId, record.userId),
          eq(chatConversations.title, record.expectedTitle),
        ),
      )
      .returning()

    return updated ?? null
  }

  async deleteConversation(conversationId: string, userId: string) {
    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, userId)))
        .limit(1)
        .for('update')

      if (!conversation) {
        throw new ChatRepositoryNotFoundError('聊天会话不存在')
      }

      const [activeRun] = await tx
        .select({ id: chatRuns.id })
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.conversationId, conversationId),
            inArray(chatRuns.status, ['queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling']),
          ),
        )
        .limit(1)

      if (activeRun) {
        throw new ChatRepositoryConflictError('执行中的会话不能删除，请先停止当前任务')
      }

      const [deleted] = await tx
        .delete(chatConversations)
        .where(eq(chatConversations.id, conversationId))
        .returning({ id: chatConversations.id })

      if (!deleted) {
        throw new ChatRepositoryConflictError('聊天会话删除失败')
      }

      return deleted
    })
  }

  async listMessagesByConversationId(conversationId: string, userId: string) {
    const rows = await db
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
      .where(and(eq(chatMessages.conversationId, conversationId), eq(chatConversations.userId, userId)))
      .orderBy(asc(chatMessages.sequenceNumber))

    return rows.map(({ message }) => message)
  }

  async createUserMessageAndRun(record: CreateChatTurnRecord) {
    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(chatConversations)
        .where(and(eq(chatConversations.id, record.conversationId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!conversation) {
        throw new ChatRepositoryNotFoundError('聊天会话不存在')
      }
      if (conversation.archivedAt) {
        throw new ChatRepositoryConflictError('聊天会话已归档')
      }

      const [createdCommand] = await tx
        .insert(chatCommands)
        .values({
          ...record.command,
          conversationId: record.conversationId,
          runId: null,
        })
        .onConflictDoNothing({ target: chatCommands.commandId })
        .returning()

      if (!createdCommand) {
        const [existingRow] = await tx
          .select({ command: chatCommands })
          .from(chatCommands)
          .innerJoin(chatConversations, eq(chatCommands.conversationId, chatConversations.id))
          .where(
            and(
              eq(chatCommands.commandId, record.command.commandId),
              eq(chatCommands.conversationId, record.conversationId),
              eq(chatConversations.userId, record.userId),
            ),
          )
          .limit(1)

        if (!existingRow) {
          throw new ChatRepositoryConflictError('Command ID 已被其他请求占用')
        }

        const existing = existingRow.command
        const replayMatches = chatCommandReplayMatches(
          {
            conversationId: existing.conversationId,
            runId: null,
            type: existing.type,
            expectedRevision: existing.expectedRevision,
            payloadHash: existing.payloadHash,
          },
          {
            conversationId: record.conversationId,
            runId: null,
            type: record.command.type,
            expectedRevision: record.command.expectedRevision,
            payloadHash: record.command.payloadHash,
          },
        )
        if (!replayMatches || !existing.runId) {
          throw new ChatRepositoryConflictError('重复 Command 的请求内容不一致')
        }

        const [existingRun] = await tx
          .select()
          .from(chatRuns)
          .where(and(eq(chatRuns.id, existing.runId), eq(chatRuns.conversationId, record.conversationId)))
          .limit(1)
        if (!existingRun) {
          throw new ChatRepositoryConflictError('重复 Command 对应的聊天运行不存在')
        }

        const [existingMessage] = await tx
          .select()
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.id, existingRun.inputMessageId),
              eq(chatMessages.conversationId, record.conversationId),
            ),
          )
          .limit(1)
        if (!existingMessage) {
          throw new ChatRepositoryConflictError('重复 Command 对应的用户消息不存在')
        }

        return { message: existingMessage, run: existingRun, duplicate: true }
      }

      const [activeRun] = await tx
        .select({ id: chatRuns.id })
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.conversationId, record.conversationId),
            inArray(chatRuns.status, ['queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling']),
          ),
        )
        .limit(1)

      if (activeRun) {
        throw new ChatRepositoryConflictError('当前会话已有正在执行的任务')
      }

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatMessages.sequenceNumber) })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, record.conversationId))

      const [message] = await tx
        .insert(chatMessages)
        .values({
          ...record.message,
          conversationId: record.conversationId,
          chatRunId: null,
          sequenceNumber: (maxSequence ?? 0) + 1,
        })
        .returning()
      const [run] = await tx
        .insert(chatRuns)
        .values({ ...record.run, conversationId: record.conversationId, inputMessageId: message.id })
        .returning()
      const [linkedMessage] = await tx
        .update(chatMessages)
        .set({ chatRunId: run.id, updatedAt: record.message.updatedAt })
        .where(eq(chatMessages.id, message.id))
        .returning()

      await tx
        .update(chatConversations)
        .set({ lastMessageAt: record.message.createdAt, updatedAt: record.message.updatedAt })
        .where(eq(chatConversations.id, record.conversationId))

      await tx
        .update(chatCommands)
        .set({
          runId: run.id,
          result: { messageId: linkedMessage.id, runId: run.id },
          handledAt: record.command.handledAt,
        })
        .where(eq(chatCommands.id, createdCommand.id))

      return { message: linkedMessage, run, duplicate: false }
    })
  }

  async appendAssistantMessage(record: AppendAssistantMessageRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns, conversation: chatConversations })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(
          and(
            eq(chatRuns.id, record.runId),
            eq(chatRuns.conversationId, record.conversationId),
            eq(chatConversations.userId, record.userId),
          ),
        )
        .limit(1)
        .for('update')

      if (!runRow) {
        throw new ChatRepositoryNotFoundError('聊天运行不存在')
      }
      if (['completed', 'failed', 'cancelled'].includes(runRow.run.status)) {
        throw new ChatRepositoryConflictError('已结束的聊天运行不能再追加助手消息')
      }

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatMessages.sequenceNumber) })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, record.conversationId))

      const [message] = await tx
        .insert(chatMessages)
        .values({
          ...record.message,
          conversationId: record.conversationId,
          chatRunId: record.runId,
          sequenceNumber: (maxSequence ?? 0) + 1,
        })
        .returning()

      await tx
        .update(chatConversations)
        .set({ lastMessageAt: record.message.createdAt, updatedAt: record.updatedAt })
        .where(eq(chatConversations.id, record.conversationId))

      return message
    })
  }

  async findRunById(runId: string, userId: string) {
    const [row] = await db
      .select({ run: chatRuns })
      .from(chatRuns)
      .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
      .where(and(eq(chatRuns.id, runId), eq(chatConversations.userId, userId)))
      .limit(1)
    return row?.run ?? null
  }

  async listToolActionsByConversationId(conversationId: string, userId: string) {
    const rows = await db
      .select({ toolAction: chatToolActions })
      .from(chatToolActions)
      .innerJoin(chatRuns, eq(chatToolActions.runId, chatRuns.id))
      .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
      .where(and(eq(chatRuns.conversationId, conversationId), eq(chatConversations.userId, userId)))
      .orderBy(asc(chatToolActions.createdAt))

    return rows.map(({ toolAction }) => toolAction)
  }

  /** 工具真正开始、完成或失败时更新 ToolAction；不推进 Run revision，避免和流式事件争抢版本。 */
  async updateToolActionExecution(record: UpdateChatToolActionExecutionRecord) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ toolAction: chatToolActions })
        .from(chatToolActions)
        .innerJoin(chatRuns, eq(chatToolActions.runId, chatRuns.id))
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(
          and(
            eq(chatToolActions.id, record.toolActionId),
            eq(chatToolActions.runId, record.runId),
            eq(chatConversations.userId, record.userId),
          ),
        )
        .limit(1)
        .for('update')

      if (!row) throw new ChatRepositoryNotFoundError('工具动作不存在')
      if (!record.expectedStatuses.includes(row.toolAction.status)) {
        throw new ChatRepositoryConflictError('工具动作状态已变化')
      }

      const [updated] = await tx
        .update(chatToolActions)
        .set({ ...record.patch, updatedAt: record.updatedAt })
        .where(eq(chatToolActions.id, record.toolActionId))
        .returning()

      if (!updated) throw new ChatRepositoryConflictError('工具动作状态更新失败')
      return updated
    })
  }

  async listRunEventsAfter(input: { runId: string; userId: string; afterSequence?: number; limit?: number }) {
    const rows = await db
      .select({ event: chatRunEvents })
      .from(chatRunEvents)
      .innerJoin(chatRuns, eq(chatRunEvents.runId, chatRuns.id))
      .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
      .where(
        and(
          eq(chatRunEvents.runId, input.runId),
          eq(chatConversations.userId, input.userId),
          gt(chatRunEvents.sequence, input.afterSequence ?? 0),
        ),
      )
      .orderBy(asc(chatRunEvents.sequence))
      .limit(input.limit ?? 200)

    return rows.map(({ event }) => event)
  }

  async updateRun(record: UpdateChatRunRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(and(eq(chatRuns.id, record.runId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!runRow) {
        throw new ChatRepositoryNotFoundError('聊天运行不存在')
      }
      if (runRow.run.revision !== record.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }

      const updates: Partial<ChatRunInsert> = {
        revision: record.expectedRevision + 1,
        updatedAt: record.updatedAt,
      }
      applyRunPatch(updates, record.patch)

      const [run] = await tx.update(chatRuns).set(updates).where(eq(chatRuns.id, record.runId)).returning()
      if (!run) {
        throw new ChatRepositoryConflictError('聊天运行版本更新失败')
      }
      return run
    })
  }

  async persistWaitingInput(record: PersistWaitingInputRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(and(eq(chatRuns.id, record.runId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!runRow) throw new ChatRepositoryNotFoundError('聊天运行不存在')
      if (runRow.run.revision !== record.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }
      if (runRow.run.status !== 'running') {
        throw new ChatRepositoryConflictError('只有运行中的聊天任务可以等待补充信息')
      }

      const [existingAction] = await tx
        .select()
        .from(chatToolActions)
        .where(
          and(
            eq(chatToolActions.runId, record.runId),
            eq(chatToolActions.idempotencyKey, record.inputRequest.idempotencyKey),
          ),
        )
        .limit(1)
        .for('update')

      let toolAction: typeof existingAction
      if (existingAction) {
        if (existingAction.id !== record.inputRequest.toolActionId) {
          throw new ChatRepositoryConflictError('重复工具动作的身份不一致')
        }
        if (existingAction.status !== 'pending') {
          throw new ChatRepositoryConflictError('工具动作已不处于可继续补充信息的状态')
        }
        ;[toolAction] = await tx
          .update(chatToolActions)
          .set({
            input: {
              ...record.inputRequest.input,
              inputRequestPresentation: record.inputRequest.presentation,
            },
            status: 'waiting_input',
            missingArguments: record.inputRequest.missingArguments,
            requiresConfirmation: record.inputRequest.requiresConfirmation,
            updatedAt: record.updatedAt,
          })
          .where(eq(chatToolActions.id, existingAction.id))
          .returning()
      } else {
        ;[toolAction] = await tx
          .insert(chatToolActions)
          .values({
            id: record.inputRequest.toolActionId,
            runId: record.runId,
            toolName: record.inputRequest.toolName,
            toolVersion: record.inputRequest.toolVersion,
            input: {
              ...record.inputRequest.input,
              inputRequestPresentation: record.inputRequest.presentation,
            },
            status: 'waiting_input',
            missingArguments: record.inputRequest.missingArguments,
            requiresConfirmation: record.inputRequest.requiresConfirmation,
            userDecision: null,
            output: null,
            error: null,
            idempotencyKey: record.inputRequest.idempotencyKey,
            createdAt: record.inputRequest.createdAt,
            startedAt: null,
            completedAt: null,
            updatedAt: record.updatedAt,
          })
          .returning()
      }
      if (!toolAction) throw new ChatRepositoryConflictError('等待补充信息的工具动作保存失败')

      const nextRevision = record.expectedRevision + 1
      const [run] = await tx
        .update(chatRuns)
        .set({
          status: 'waiting_input',
          phase: null,
          runtimeState: record.checkpoint,
          revision: nextRevision,
          updatedAt: record.updatedAt,
        })
        .where(eq(chatRuns.id, record.runId))
        .returning()
      if (!run) throw new ChatRepositoryConflictError('聊天运行等待输入状态保存失败')

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, record.runId))
      const [event] = await tx
        .insert(chatRunEvents)
        .values({
          id: crypto.randomUUID(),
          runId: record.runId,
          sequence: (maxSequence ?? 0) + 1,
          eventType: 'input_requested',
          stateRevision: nextRevision,
          payload: {
            requestId: record.inputRequest.requestId,
            toolActionId: toolAction.id,
            callId: toolAction.idempotencyKey,
            toolName: toolAction.toolName,
            missingArguments: record.inputRequest.missingArguments,
            presentation: record.inputRequest.presentation,
          },
          createdAt: record.updatedAt,
        })
        .returning()

      return { run, toolAction, event, duplicate: false }
    })
  }

  async persistWaitingConfirmation(record: PersistWaitingConfirmationRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(and(eq(chatRuns.id, record.runId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!runRow) throw new ChatRepositoryNotFoundError('聊天运行不存在')
      if (runRow.run.revision !== record.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }
      const [existingAction] = await tx
        .select()
        .from(chatToolActions)
        .where(
          and(
            eq(chatToolActions.runId, record.runId),
            eq(chatToolActions.idempotencyKey, record.toolAction.idempotencyKey),
          ),
        )
        .limit(1)
        .for('update')

      if (existingAction) {
        if (existingAction.id !== record.toolAction.id) {
          throw new ChatRepositoryConflictError('重复工具动作的身份不一致')
        }
        if (existingAction.status === 'waiting_confirmation') {
          return { run: runRow.run, toolAction: existingAction, duplicate: true }
        }
        if (existingAction.status !== 'pending') {
          throw new ChatRepositoryConflictError('工具动作已不处于可进入确认的状态')
        }
      }

      if (runRow.run.status !== 'running') {
        throw new ChatRepositoryConflictError('只有运行中的聊天任务可以等待确认')
      }

      const [toolAction] = existingAction
        ? await tx
            .update(chatToolActions)
            .set({
              input: record.toolAction.input,
              status: 'waiting_confirmation',
              missingArguments: null,
              requiresConfirmation: true,
              updatedAt: record.updatedAt,
            })
            .where(eq(chatToolActions.id, existingAction.id))
            .returning()
        : await tx
            .insert(chatToolActions)
            .values({
              id: record.toolAction.id,
              runId: record.runId,
              toolName: record.toolAction.toolName,
              toolVersion: record.toolAction.toolVersion,
              input: record.toolAction.input,
              status: 'waiting_confirmation',
              missingArguments: null,
              requiresConfirmation: true,
              userDecision: null,
              output: null,
              error: null,
              idempotencyKey: record.toolAction.idempotencyKey,
              createdAt: record.toolAction.createdAt,
              startedAt: null,
              completedAt: null,
              updatedAt: record.updatedAt,
            })
            .returning()

      const nextRevision = record.expectedRevision + 1
      const [run] = await tx
        .update(chatRuns)
        .set({
          status: 'waiting_confirmation',
          phase: null,
          runtimeState: record.checkpoint,
          revision: nextRevision,
          updatedAt: record.updatedAt,
        })
        .where(eq(chatRuns.id, record.runId))
        .returning()

      if (!run) throw new ChatRepositoryConflictError('聊天运行状态保存失败')

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, record.runId))

      const [event] = await tx
        .insert(chatRunEvents)
        .values({
          id: crypto.randomUUID(),
          runId: record.runId,
          sequence: (maxSequence ?? 0) + 1,
          eventType: 'confirmation_requested',
          stateRevision: nextRevision,
          payload: {
            toolActionId: toolAction.id,
            callId: toolAction.idempotencyKey,
            toolName: toolAction.toolName,
            input: toolAction.input,
            ...(record.toolAction.confirmationPresentation
              ? { presentation: record.toolAction.confirmationPresentation }
              : {}),
          },
          createdAt: record.updatedAt,
        })
        .returning()

      return { run, toolAction, event, duplicate: false }
    })
  }

  async recordConfirmationCommand(record: CreateChatCommandRecord) {
    const runId = record.runId
    if (record.command.type !== 'confirm_tool' || !runId) {
      throw new ChatRepositoryConflictError('确认工具 Command 缺少聊天运行')
    }

    const confirmation = readConfirmationPayload(record.command.payload)

    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(and(eq(chatConversations.id, record.conversationId), eq(chatConversations.userId, record.userId)))
        .limit(1)

      if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')

      const [createdCommand] = await tx
        .insert(chatCommands)
        .values({ ...record.command, conversationId: record.conversationId, runId })
        .onConflictDoNothing({ target: chatCommands.commandId })
        .returning()

      if (!createdCommand) {
        const [existingRow] = await tx
          .select({ command: chatCommands })
          .from(chatCommands)
          .innerJoin(chatConversations, eq(chatCommands.conversationId, chatConversations.id))
          .where(
            and(
              eq(chatCommands.commandId, record.command.commandId),
              eq(chatCommands.conversationId, record.conversationId),
              eq(chatConversations.userId, record.userId),
            ),
          )
          .limit(1)

        if (!existingRow) throw new ChatRepositoryConflictError('Command ID 已被其他请求占用')
        if (
          !chatCommandReplayMatches(
            {
              conversationId: existingRow.command.conversationId,
              runId: existingRow.command.runId,
              type: existingRow.command.type,
              expectedRevision: existingRow.command.expectedRevision,
              payloadHash: existingRow.command.payloadHash,
            },
            {
              conversationId: record.conversationId,
              runId,
              type: record.command.type,
              expectedRevision: record.command.expectedRevision,
              payloadHash: record.command.payloadHash,
            },
          )
        ) {
          throw new ChatRepositoryConflictError('重复确认 Command 的请求内容不一致')
        }

        return { command: existingRow.command, duplicate: true }
      }

      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(
          and(
            eq(chatRuns.id, runId),
            eq(chatRuns.conversationId, record.conversationId),
            eq(chatConversations.userId, record.userId),
          ),
        )
        .limit(1)
        .for('update')

      if (!runRow) throw new ChatRepositoryNotFoundError('聊天运行不存在')
      if (runRow.run.revision !== record.command.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }
      if (runRow.run.status !== 'waiting_confirmation') {
        throw new ChatRepositoryConflictError('当前聊天运行不处于等待确认状态')
      }

      const [toolAction] = await tx
        .select()
        .from(chatToolActions)
        .where(and(eq(chatToolActions.id, confirmation.toolActionId), eq(chatToolActions.runId, runId)))
        .limit(1)
        .for('update')

      if (!toolAction || toolAction.status !== 'waiting_confirmation') {
        throw new ChatRepositoryConflictError('工具动作不存在或已经处理')
      }

      const now = new Date().toISOString()
      const nextActionStatus: ChatToolActionStatus = confirmation.decision === 'approved' ? 'pending' : 'cancelled'
      const [updatedAction] = await tx
        .update(chatToolActions)
        .set({
          status: nextActionStatus,
          userDecision: confirmation.decision,
          completedAt: confirmation.decision === 'rejected' ? now : null,
          updatedAt: now,
        })
        .where(eq(chatToolActions.id, toolAction.id))
        .returning()

      const nextRevision = record.command.expectedRevision + 1
      const [run] = await tx
        .update(chatRuns)
        .set({ status: 'queued', phase: null, revision: nextRevision, updatedAt: now })
        .where(eq(chatRuns.id, runId))
        .returning()

      if (!run || !updatedAction) throw new ChatRepositoryConflictError('确认结果保存失败')

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, runId))

      const [event] = await tx
        .insert(chatRunEvents)
        .values({
          id: crypto.randomUUID(),
          runId,
          sequence: (maxSequence ?? 0) + 1,
          eventType: 'confirmation_resolved',
          stateRevision: nextRevision,
          payload: {
            toolActionId: updatedAction.id,
            decision: confirmation.decision,
          },
          createdAt: now,
        })
        .returning()

      await tx
        .update(chatCommands)
        .set({
          result: { runId, toolActionId: updatedAction.id, decision: confirmation.decision },
          handledAt: now,
        })
        .where(eq(chatCommands.id, createdCommand.id))

      return { command: createdCommand, run, toolAction: updatedAction, event, duplicate: false }
    })
  }

  async recordInputCommand(record: CreateChatCommandRecord) {
    const runId = record.runId
    if (record.command.type !== 'provide_input' || !runId) {
      throw new ChatRepositoryConflictError('补充信息 Command 缺少聊天运行')
    }
    const providedInput = readInputPayload(record.command.payload)

    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(and(eq(chatConversations.id, record.conversationId), eq(chatConversations.userId, record.userId)))
        .limit(1)
      if (!conversation) throw new ChatRepositoryNotFoundError('聊天会话不存在')

      const [createdCommand] = await tx
        .insert(chatCommands)
        .values({ ...record.command, conversationId: record.conversationId, runId })
        .onConflictDoNothing({ target: chatCommands.commandId })
        .returning()
      if (!createdCommand) {
        const [existingRow] = await tx
          .select({ command: chatCommands })
          .from(chatCommands)
          .innerJoin(chatConversations, eq(chatCommands.conversationId, chatConversations.id))
          .where(
            and(
              eq(chatCommands.commandId, record.command.commandId),
              eq(chatCommands.conversationId, record.conversationId),
              eq(chatConversations.userId, record.userId),
            ),
          )
          .limit(1)
        if (!existingRow) throw new ChatRepositoryConflictError('Command ID 已被其他请求占用')
        if (
          !chatCommandReplayMatches(
            {
              conversationId: existingRow.command.conversationId,
              runId: existingRow.command.runId,
              type: existingRow.command.type,
              expectedRevision: existingRow.command.expectedRevision,
              payloadHash: existingRow.command.payloadHash,
            },
            {
              conversationId: record.conversationId,
              runId,
              type: record.command.type,
              expectedRevision: record.command.expectedRevision,
              payloadHash: record.command.payloadHash,
            },
          )
        ) {
          throw new ChatRepositoryConflictError('重复补充信息 Command 的请求内容不一致')
        }
        return { command: existingRow.command, duplicate: true }
      }

      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(
          and(
            eq(chatRuns.id, runId),
            eq(chatRuns.conversationId, record.conversationId),
            eq(chatConversations.userId, record.userId),
          ),
        )
        .limit(1)
        .for('update')
      if (!runRow) throw new ChatRepositoryNotFoundError('聊天运行不存在')
      if (runRow.run.revision !== record.command.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }
      if (runRow.run.status !== 'waiting_input') {
        throw new ChatRepositoryConflictError('当前聊天运行不处于等待补充信息状态')
      }

      const checkpointIdentity = readInputCheckpointIdentity(runRow.run.runtimeState)
      if (checkpointIdentity.requestId !== providedInput.requestId) {
        throw new ChatRepositoryConflictError('补充信息请求已变化，请重新读取')
      }
      const [toolAction] = await tx
        .select()
        .from(chatToolActions)
        .where(and(eq(chatToolActions.id, checkpointIdentity.toolActionId), eq(chatToolActions.runId, runId)))
        .limit(1)
        .for('update')
      if (!toolAction || toolAction.status !== 'waiting_input') {
        throw new ChatRepositoryConflictError('工具动作不存在或已经处理')
      }

      const now = new Date().toISOString()
      const [updatedAction] = await tx
        .update(chatToolActions)
        .set({ status: 'pending', updatedAt: now })
        .where(eq(chatToolActions.id, toolAction.id))
        .returning()
      const nextRevision = record.command.expectedRevision + 1
      const [run] = await tx
        .update(chatRuns)
        .set({ status: 'queued', phase: null, revision: nextRevision, updatedAt: now })
        .where(eq(chatRuns.id, runId))
        .returning()
      if (!run || !updatedAction) throw new ChatRepositoryConflictError('补充信息保存失败')

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, runId))
      const [event] = await tx
        .insert(chatRunEvents)
        .values({
          id: crypto.randomUUID(),
          runId,
          sequence: (maxSequence ?? 0) + 1,
          eventType: 'input_received',
          stateRevision: nextRevision,
          payload: {
            requestId: providedInput.requestId,
            toolActionId: updatedAction.id,
          },
          createdAt: now,
        })
        .returning()
      await tx
        .update(chatCommands)
        .set({ result: { runId, requestId: providedInput.requestId }, handledAt: now })
        .where(eq(chatCommands.id, createdCommand.id))

      return { command: createdCommand, run, toolAction: updatedAction, event, duplicate: false }
    })
  }

  async appendRunEvent(record: AppendChatRunEventRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(and(eq(chatRuns.id, record.runId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!runRow) {
        throw new ChatRepositoryNotFoundError('聊天运行不存在')
      }
      if (runRow.run.revision !== record.expectedRevision) {
        throw new ChatRepositoryConflictError('聊天运行版本已变化')
      }

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, record.runId))

      let run = runRow.run
      if (record.patch) {
        const updates: Partial<ChatRunInsert> = {
          revision: record.expectedRevision + 1,
          updatedAt: record.updatedAt,
        }
        applyRunPatch(updates, record.patch)

        const [updatedRun] = await tx.update(chatRuns).set(updates).where(eq(chatRuns.id, record.runId)).returning()
        if (!updatedRun) {
          throw new ChatRepositoryConflictError('聊天运行版本更新失败')
        }
        run = updatedRun
      }

      const [event] = await tx
        .insert(chatRunEvents)
        .values({
          ...record.event,
          runId: record.runId,
          sequence: (maxSequence ?? 0) + 1,
          stateRevision: run.revision,
        })
        .returning()

      return { run, event }
    })
  }

  /**
   * API 进程已经找不到对应 Worker 时，将数据库中遗留的非终态 Run 原子收口。
   * 这主要处理开发期热更新、服务重启，以及 waiting_confirmation 等没有常驻 Worker 的状态。
   */
  async cancelDetachedRun(record: CancelDetachedChatRunRecord) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select({ run: chatRuns })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .where(and(eq(chatRuns.id, record.runId), eq(chatConversations.userId, record.userId)))
        .limit(1)
        .for('update')

      if (!runRow) throw new ChatRepositoryNotFoundError('聊天运行不存在')

      if (['completed', 'failed', 'cancelled'].includes(runRow.run.status)) {
        return { run: runRow.run, duplicate: true }
      }

      const [existingAssistantMessage] = await tx
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.chatRunId, record.runId), eq(chatMessages.role, 'assistant')))
        .orderBy(desc(chatMessages.sequenceNumber))
        .limit(1)

      const deltaEvents = await tx
        .select({ payload: chatRunEvents.payload })
        .from(chatRunEvents)
        .where(and(eq(chatRunEvents.runId, record.runId), eq(chatRunEvents.eventType, 'message_delta')))
        .orderBy(asc(chatRunEvents.sequence))

      const streamedText = deltaEvents
        .map(({ payload }) => (typeof payload.text === 'string' ? payload.text : ''))
        .join('')
      const visibleText =
        typeof record.visibleTextLength === 'number'
          ? streamedText.slice(0, Math.min(record.visibleTextLength, streamedText.length))
          : streamedText
      const cancelledText = visibleText.trim()
        ? record.cancelledMessage
          ? `${visibleText.trimEnd()}\n\n${record.cancelledMessage}`
          : visibleText
        : (record.cancelledMessage ?? '用户已结束当前对话')

      let outputMessageId = existingAssistantMessage?.id ?? null
      if (existingAssistantMessage) {
        await tx
          .update(chatMessages)
          .set({ status: 'cancelled', completedAt: record.updatedAt, updatedAt: record.updatedAt })
          .where(eq(chatMessages.id, existingAssistantMessage.id))
      } else {
        const [{ maxSequence }] = await tx
          .select({ maxSequence: max(chatMessages.sequenceNumber) })
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, runRow.run.conversationId))

        const [message] = await tx
          .insert(chatMessages)
          .values({
            id: crypto.randomUUID(),
            conversationId: runRow.run.conversationId,
            chatRunId: record.runId,
            role: 'assistant',
            status: 'cancelled',
            sequenceNumber: (maxSequence ?? 0) + 1,
            replacesMessageId: null,
            parts: [{ type: 'text', text: cancelledText }],
            references: [],
            createdAt: record.updatedAt,
            completedAt: record.updatedAt,
            updatedAt: record.updatedAt,
          })
          .returning({ id: chatMessages.id })

        if (!message) throw new ChatRepositoryConflictError('停止消息保存失败')
        outputMessageId = message.id
      }

      const failure = {
        code: 'cancelled',
        message: '聊天任务已由用户停止',
        retryable: false,
      } satisfies AgentRunError
      const nextRevision = runRow.run.revision + 1
      const [run] = await tx
        .update(chatRuns)
        .set({
          status: 'cancelled',
          phase: null,
          revision: nextRevision,
          outputMessageId,
          runtimeState: null,
          error: failure,
          finishedAt: record.updatedAt,
          updatedAt: record.updatedAt,
        })
        .where(eq(chatRuns.id, record.runId))
        .returning()

      if (!run) throw new ChatRepositoryConflictError('聊天运行停止失败')

      await tx
        .update(chatToolActions)
        .set({ status: 'cancelled', error: failure, completedAt: record.updatedAt, updatedAt: record.updatedAt })
        .where(
          and(
            eq(chatToolActions.runId, record.runId),
            inArray(chatToolActions.status, ['pending', 'running', 'waiting_input', 'waiting_confirmation']),
          ),
        )

      const [{ maxSequence }] = await tx
        .select({ maxSequence: max(chatRunEvents.sequence) })
        .from(chatRunEvents)
        .where(eq(chatRunEvents.runId, record.runId))

      await tx.insert(chatRunEvents).values({
        id: crypto.randomUUID(),
        runId: record.runId,
        sequence: (maxSequence ?? 0) + 1,
        eventType: 'run_cancelled',
        stateRevision: nextRevision,
        payload: failure,
        createdAt: record.updatedAt,
      })

      await tx
        .update(chatCommands)
        .set({ result: { runId: record.runId, status: 'cancelled' }, handledAt: record.updatedAt })
        .where(eq(chatCommands.id, record.commandRecordId))

      await tx
        .update(chatConversations)
        .set({ lastMessageAt: record.updatedAt, updatedAt: record.updatedAt })
        .where(eq(chatConversations.id, runRow.run.conversationId))

      return { run, duplicate: false }
    })
  }

  async recordCommand(record: CreateChatCommandRecord) {
    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(and(eq(chatConversations.id, record.conversationId), eq(chatConversations.userId, record.userId)))
        .limit(1)

      if (!conversation) {
        throw new ChatRepositoryNotFoundError('聊天会话不存在')
      }

      const runId = record.runId ?? null
      const [createdCommand] = await tx
        .insert(chatCommands)
        .values({ ...record.command, conversationId: record.conversationId, runId })
        .onConflictDoNothing({ target: chatCommands.commandId })
        .returning()

      if (createdCommand) {
        if (runId) {
          const [runRow] = await tx
            .select({ run: chatRuns })
            .from(chatRuns)
            .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
            .where(
              and(
                eq(chatRuns.id, runId),
                eq(chatRuns.conversationId, record.conversationId),
                eq(chatConversations.userId, record.userId),
              ),
            )
            .limit(1)
            .for('update')

          if (!runRow) {
            throw new ChatRepositoryNotFoundError('聊天运行不存在')
          }
          // 流式事件会持续推进 revision；取消命令不应因刚到达的一条 delta 被误拒绝。
          // 需要恢复具体业务节点的命令仍必须严格校验 revision。
          if (record.command.type !== 'cancel_run' && runRow.run.revision !== record.command.expectedRevision) {
            throw new ChatRepositoryConflictError('聊天运行版本已变化')
          }
        }

        return { command: createdCommand, duplicate: false }
      }

      const [existingRow] = await tx
        .select({ command: chatCommands })
        .from(chatCommands)
        .innerJoin(chatConversations, eq(chatCommands.conversationId, chatConversations.id))
        .where(
          and(
            eq(chatCommands.commandId, record.command.commandId),
            eq(chatCommands.conversationId, record.conversationId),
            eq(chatConversations.userId, record.userId),
          ),
        )
        .limit(1)

      if (!existingRow) {
        throw new ChatRepositoryConflictError('Command ID 已被其他请求占用')
      }

      const existing = existingRow.command
      const replayMatches = chatCommandReplayMatches(
        {
          conversationId: existing.conversationId,
          runId: existing.runId,
          type: existing.type,
          expectedRevision: existing.expectedRevision,
          payloadHash: existing.payloadHash,
        },
        {
          conversationId: record.conversationId,
          runId,
          type: record.command.type,
          expectedRevision: record.command.expectedRevision,
          payloadHash: record.command.payloadHash,
        },
      )
      if (!replayMatches) {
        throw new ChatRepositoryConflictError('重复 Command 的请求内容不一致')
      }

      return { command: existing, duplicate: true }
    })
  }
}

export const chatRepository = new DrizzleChatRepository()
