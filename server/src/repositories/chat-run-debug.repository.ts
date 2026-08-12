import { and, count, desc, eq, ilike, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import {
  agentRuns,
  chatConversations,
  chatMemoryDocuments,
  chatMessages,
  chatRunEvents,
  chatRuns,
  chatToolActions,
  jobOpportunities,
} from '../db/schema'
import type { ChatConversationScopeType, ChatRunStatus } from '@/shared/chat/schemas'
import { measureDb } from '../utils/request-metrics'

export type ChatRunDebugListFilters = {
  userId: string
  limit: number
  status?: ChatRunStatus
  scopeType?: ChatConversationScopeType
  modelName?: string
  search?: string
  cursor?: { createdAt: string; id: string }
}

export class DrizzleChatRunDebugRepository {
  async findList(filters: ChatRunDebugListFilters) {
    return measureDb(async () => {
      const conditions: SQL[] = [eq(chatConversations.userId, filters.userId)]
      if (filters.status) conditions.push(eq(chatRuns.status, filters.status))
      if (filters.scopeType) conditions.push(eq(chatConversations.scopeType, filters.scopeType))
      if (filters.modelName) {
        conditions.push(eq(sql<string>`${chatRuns.modelSnapshot}->>'modelName'`, filters.modelName))
      }
      if (filters.search) {
        const pattern = `%${filters.search}%`
        conditions.push(
          or(
            ilike(chatConversations.title, pattern),
            ilike(sql<string>`coalesce(${chatRuns.input}->>'text', '')`, pattern),
            ilike(sql<string>`coalesce(${jobOpportunities.company}, '')`, pattern),
            ilike(sql<string>`coalesce(${jobOpportunities.jobTitle}, '')`, pattern),
          )!,
        )
      }
      if (filters.cursor) {
        conditions.push(
          or(
            lt(chatRuns.createdAt, filters.cursor.createdAt),
            and(eq(chatRuns.createdAt, filters.cursor.createdAt), lt(chatRuns.id, filters.cursor.id)),
          )!,
        )
      }

      return db
        .select({
          id: chatRuns.id,
          conversationId: chatRuns.conversationId,
          conversationTitle: chatConversations.title,
          scopeType: chatConversations.scopeType,
          opportunityId: chatConversations.opportunityId,
          company: jobOpportunities.company,
          jobTitle: jobOpportunities.jobTitle,
          status: chatRuns.status,
          phase: chatRuns.phase,
          revision: chatRuns.revision,
          modelSnapshot: chatRuns.modelSnapshot,
          promptVersion: chatRuns.promptVersion,
          tokenUsage: chatRuns.tokenUsage,
          inputText: sql<string>`coalesce(${chatRuns.input}->>'text', '')`,
          error: chatRuns.error,
          agentRunCount: sql<number>`(
            select count(*)::int from ${agentRuns}
            where ${agentRuns.chatRunId} = ${chatRuns.id}
          )`,
          toolActionCount: sql<number>`(
            select count(*)::int from ${chatToolActions}
            where ${chatToolActions.runId} = ${chatRuns.id}
          )`,
          createdAt: chatRuns.createdAt,
          startedAt: chatRuns.startedAt,
          finishedAt: chatRuns.finishedAt,
          updatedAt: chatRuns.updatedAt,
        })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .leftJoin(jobOpportunities, eq(chatConversations.opportunityId, jobOpportunities.id))
        .where(and(...conditions))
        .orderBy(desc(chatRuns.createdAt), desc(chatRuns.id))
        .limit(filters.limit + 1)
    })
  }

  async findDetail(runId: string, userId: string) {
    const [entry] = await measureDb(() =>
      db
        .select({
          run: chatRuns,
          conversation: chatConversations,
          company: jobOpportunities.company,
          jobTitle: jobOpportunities.jobTitle,
        })
        .from(chatRuns)
        .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
        .leftJoin(jobOpportunities, eq(chatConversations.opportunityId, jobOpportunities.id))
        .where(and(eq(chatRuns.id, runId), eq(chatConversations.userId, userId)))
        .limit(1),
    )
    if (!entry) return null

    const messageIds = [entry.run.inputMessageId, entry.run.outputMessageId].filter(
      (id): id is string => typeof id === 'string',
    )
    const [messages, modelCalls, toolActions, events, [deltaSummary], [memorySummary]] = await Promise.all([
      messageIds.length
        ? measureDb(() => db.select().from(chatMessages).where(inArray(chatMessages.id, messageIds)))
        : Promise.resolve([]),
      measureDb(() =>
        db
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.chatRunId, runId), eq(agentRuns.workflowType, 'chat_turn')))
          .orderBy(agentRuns.startedAt, agentRuns.attemptNumber),
      ),
      measureDb(() =>
        db.select().from(chatToolActions).where(eq(chatToolActions.runId, runId)).orderBy(chatToolActions.createdAt),
      ),
      measureDb(() =>
        db
          .select()
          .from(chatRunEvents)
          .where(and(eq(chatRunEvents.runId, runId), ne(chatRunEvents.eventType, 'message_delta')))
          .orderBy(chatRunEvents.sequence),
      ),
      measureDb(() =>
        db
          .select({
            batchCount: count(),
            characterCount: sql<number>`coalesce(sum(length(${chatRunEvents.payload}->>'text')), 0)::int`,
          })
          .from(chatRunEvents)
          .where(and(eq(chatRunEvents.runId, runId), eq(chatRunEvents.eventType, 'message_delta'))),
      ),
      measureDb(() =>
        db.select({ documentCount: count() }).from(chatMemoryDocuments).where(eq(chatMemoryDocuments.runId, runId)),
      ),
    ])

    return {
      ...entry,
      inputMessage: messages.find((message) => message.id === entry.run.inputMessageId) ?? null,
      outputMessage: messages.find((message) => message.id === entry.run.outputMessageId) ?? null,
      modelCalls,
      toolActions,
      events,
      deltaSummary: deltaSummary ?? { batchCount: 0, characterCount: 0 },
      memoryDocumentCount: memorySummary?.documentCount ?? 0,
    }
  }
}

export const chatRunDebugRepository = new DrizzleChatRunDebugRepository()
