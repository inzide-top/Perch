import { and, asc, eq, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions/vector'
import { db } from '../db/client'
import { chatConversations, chatMemoryDocuments, chatMessages, chatRuns, chatToolActions } from '../db/schema'
import type { ChatJsonObject, ChatMessagePart } from '@/shared/chat/schemas'
import type { RetrievalResult, RetrievalScope } from '../services/retrieval/retrieval-types'

export type ChatMemoryDocumentRecord = typeof chatMemoryDocuments.$inferInsert

export type IndexedChatRun = {
  embeddingModel: string
}

export interface ChatMemoryPersistence {
  findIndexedRun(input: { userId: string; runId: string }): Promise<IndexedChatRun | null>
  insertDocumentsIfAbsent(documents: ChatMemoryDocumentRecord[]): Promise<number>
}

export type ChatMemoryCompensationCursor = {
  updatedAt: string
  runId: string
}

export type ChatMemoryCompensationCandidate = {
  userId: string
  conversationId: string
  runId: string
  runInput: ChatJsonObject
  assistantParts: ChatMessagePart[]
  boundOpportunityId: string | null
  toolInputs: ChatJsonObject[]
  cursor: ChatMemoryCompensationCursor
}

export interface ChatMemoryCompensationPersistence {
  listUnindexedCompletedRuns(input: {
    cursor: ChatMemoryCompensationCursor | null
    limit: number
  }): Promise<ChatMemoryCompensationCandidate[]>
}

export interface ChatMemoryRetrievalPersistence {
  searchSimilarDocuments(input: {
    queryEmbedding: number[]
    embeddingModel: string
    scope: RetrievalScope
    limit: number
    minScore: number
  }): Promise<RetrievalResult[]>
}

function createRetrievalScopeFilter(scope: RetrievalScope): SQL | undefined {
  if (scope.conversationScopeType === 'global') return undefined

  const allowedOpportunityIds = [scope.boundOpportunityId, ...scope.referencedOpportunityIds].filter(
    (id): id is string => Boolean(id),
  )
  const opportunityFilters = allowedOpportunityIds.map(
    (opportunityId) => sql`${chatMemoryDocuments.opportunityIds} @> ${JSON.stringify([opportunityId])}::jsonb`,
  )

  return or(eq(chatMemoryDocuments.scopeType, 'global'), ...opportunityFilters)
}

export class DrizzleChatMemoryRepository implements ChatMemoryPersistence {
  async findIndexedRun(input: { userId: string; runId: string }) {
    const [document] = await db
      .select({ embeddingModel: chatMemoryDocuments.embeddingModel })
      .from(chatMemoryDocuments)
      .where(and(eq(chatMemoryDocuments.userId, input.userId), eq(chatMemoryDocuments.runId, input.runId)))
      .limit(1)

    return document ?? null
  }

  async insertDocumentsIfAbsent(documents: ChatMemoryDocumentRecord[]) {
    if (documents.length === 0) return 0

    const inserted = await db
      .insert(chatMemoryDocuments)
      .values(documents)
      .onConflictDoNothing({
        target: [chatMemoryDocuments.runId, chatMemoryDocuments.chunkIndex],
      })
      .returning({ id: chatMemoryDocuments.id })

    return inserted.length
  }

  async listUnindexedCompletedRuns(input: {
    cursor: ChatMemoryCompensationCursor | null
    limit: number
  }): Promise<ChatMemoryCompensationCandidate[]> {
    const cursorFilter = input.cursor
      ? or(
          gt(chatRuns.updatedAt, input.cursor.updatedAt),
          and(eq(chatRuns.updatedAt, input.cursor.updatedAt), gt(chatRuns.id, input.cursor.runId)),
        )
      : undefined

    const rows = await db
      .select({
        userId: chatConversations.userId,
        conversationId: chatRuns.conversationId,
        runId: chatRuns.id,
        runInput: chatRuns.input,
        assistantParts: chatMessages.parts,
        boundOpportunityId: chatConversations.opportunityId,
        updatedAt: chatRuns.updatedAt,
      })
      .from(chatRuns)
      .innerJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
      .innerJoin(chatMessages, eq(chatRuns.outputMessageId, chatMessages.id))
      .leftJoin(chatMemoryDocuments, eq(chatRuns.id, chatMemoryDocuments.runId))
      .where(and(eq(chatRuns.status, 'completed'), isNull(chatMemoryDocuments.id), cursorFilter))
      .orderBy(asc(chatRuns.updatedAt), asc(chatRuns.id))
      .limit(input.limit)

    if (rows.length === 0) return []

    const toolRows = await db
      .select({ runId: chatToolActions.runId, input: chatToolActions.input })
      .from(chatToolActions)
      .where(
        inArray(
          chatToolActions.runId,
          rows.map((row) => row.runId),
        ),
      )
    const toolInputsByRunId = new Map<string, ChatJsonObject[]>()
    toolRows.forEach((row) => {
      const values = toolInputsByRunId.get(row.runId) ?? []
      values.push(row.input)
      toolInputsByRunId.set(row.runId, values)
    })

    return rows.map((row) => ({
      userId: row.userId,
      conversationId: row.conversationId,
      runId: row.runId,
      runInput: row.runInput,
      assistantParts: row.assistantParts,
      boundOpportunityId: row.boundOpportunityId,
      toolInputs: toolInputsByRunId.get(row.runId) ?? [],
      cursor: { updatedAt: row.updatedAt, runId: row.runId },
    }))
  }

  async searchSimilarDocuments(input: {
    queryEmbedding: number[]
    embeddingModel: string
    scope: RetrievalScope
    limit: number
    minScore: number
  }): Promise<RetrievalResult[]> {
    const distance = cosineDistance(chatMemoryDocuments.embedding, input.queryEmbedding)
    const score = sql<number>`1 - (${distance})`

    const rows = await db
      .select({
        documentId: chatMemoryDocuments.id,
        conversationId: chatMemoryDocuments.conversationId,
        runId: chatMemoryDocuments.runId,
        content: chatMemoryDocuments.content,
        score,
        scopeType: chatMemoryDocuments.scopeType,
        opportunityIds: chatMemoryDocuments.opportunityIds,
      })
      .from(chatMemoryDocuments)
      .where(
        and(
          eq(chatMemoryDocuments.userId, input.scope.userId),
          ne(chatMemoryDocuments.conversationId, input.scope.currentConversationId),
          eq(chatMemoryDocuments.embeddingModel, input.embeddingModel),
          createRetrievalScopeFilter(input.scope),
          sql`${score} >= ${input.minScore}`,
        ),
      )
      .orderBy(distance)
      .limit(input.limit)

    return rows.map((row) => ({
      documentId: row.documentId,
      conversationId: row.conversationId,
      runId: row.runId,
      content: row.content,
      score: Number(row.score),
      scope:
        row.scopeType === 'global'
          ? { type: 'global' as const }
          : { type: 'opportunity' as const, opportunityIds: row.opportunityIds },
    }))
  }
}

export const chatMemoryRepository = new DrizzleChatMemoryRepository()
