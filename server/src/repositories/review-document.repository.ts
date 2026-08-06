import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { reviewDocuments } from '../db/schema'

export class ReviewDocumentConflictError extends Error {
  readonly statusCode = 409

  constructor(message: string) {
    super(message)
    this.name = 'ReviewDocumentConflictError'
  }
}

export type CreateReviewDocumentRecord = typeof reviewDocuments.$inferInsert
type ReviewDocumentRow = typeof reviewDocuments.$inferSelect

export type UpsertPendingReviewDocumentRecord = {
  id: string
  opportunityId: string
  sourceType: 'written_test' | 'interview'
  interviewRoundId: string | null
  rawText: string
  updatedAt: string
}

export type MarkReviewDocumentProcessingRecord = {
  id: string
  revision: number
  modelName: string
  promptVersion: string
  attemptNumber: number
  startedAt: string
}

export type CompleteReviewDocumentRecord = {
  id: string
  revision: number
  result: ReviewDocumentRow['result']
  finishedAt: string
}

export type FailReviewDocumentRecord = {
  id: string
  revision: number
  error: ReviewDocumentRow['error']
  finishedAt: string
}

export class DrizzleReviewDocumentRepository {
  async create(record: CreateReviewDocumentRecord) {
    const [document] = await db.insert(reviewDocuments).values(record).returning()
    return document
  }

  async findById(id: string) {
    const [document] = await db.select().from(reviewDocuments).where(eq(reviewDocuments.id, id)).limit(1)
    return document ?? null
  }

  async findWrittenTestByOpportunityId(opportunityId: string) {
    const [document] = await db
      .select()
      .from(reviewDocuments)
      .where(and(eq(reviewDocuments.opportunityId, opportunityId), eq(reviewDocuments.sourceType, 'written_test')))
      .orderBy(desc(reviewDocuments.updatedAt))
      .limit(1)

    return document ?? null
  }

  async findInterviewByRoundId(opportunityId: string, interviewRoundId: string) {
    const [document] = await db
      .select()
      .from(reviewDocuments)
      .where(
        and(
          eq(reviewDocuments.opportunityId, opportunityId),
          eq(reviewDocuments.interviewRoundId, interviewRoundId),
          eq(reviewDocuments.sourceType, 'interview'),
        ),
      )
      .orderBy(desc(reviewDocuments.updatedAt))
      .limit(1)

    return document ?? null
  }

  async findByOpportunityId(opportunityId: string) {
    return db
      .select({
        id: reviewDocuments.id,
        sourceType: reviewDocuments.sourceType,
        interviewRoundId: reviewDocuments.interviewRoundId,
        status: reviewDocuments.status,
        result: reviewDocuments.result,
        revision: reviewDocuments.revision,
        currentAttempt: reviewDocuments.currentAttempt,
        modelName: reviewDocuments.modelName,
        promptVersion: reviewDocuments.promptVersion,
        error: reviewDocuments.error,
        updatedAt: reviewDocuments.updatedAt,
        completedAt: reviewDocuments.completedAt,
      })
      .from(reviewDocuments)
      .where(eq(reviewDocuments.opportunityId, opportunityId))
      .orderBy(desc(reviewDocuments.updatedAt))
  }

  /**
   * 保存一份复盘文本的最新版本，并返回是否需要重新执行提取。
   * revision 在原文变化时递增，用来隔离旧的异步模型任务。
   */
  async upsertPending(record: UpsertPendingReviewDocumentRecord) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(reviewDocuments)
        .where(
          record.sourceType === 'written_test'
            ? and(
                eq(reviewDocuments.opportunityId, record.opportunityId),
                eq(reviewDocuments.sourceType, 'written_test'),
              )
            : and(
                eq(reviewDocuments.opportunityId, record.opportunityId),
                eq(reviewDocuments.interviewRoundId, record.interviewRoundId as string),
                eq(reviewDocuments.sourceType, 'interview'),
              ),
        )
        .limit(1)

      if (!existing) {
        const [created] = await tx
          .insert(reviewDocuments)
          .values({
            id: record.id,
            opportunityId: record.opportunityId,
            sourceType: record.sourceType,
            interviewRoundId: record.interviewRoundId,
            rawText: record.rawText,
            status: 'pending',
            result: null,
            revision: 1,
            currentAttempt: 0,
            modelName: null,
            promptVersion: null,
            error: null,
            createdAt: record.updatedAt,
            updatedAt: record.updatedAt,
            completedAt: null,
          })
          .returning()

        return { document: created, shouldQueue: true }
      }

      if (existing.rawText === record.rawText && existing.status !== 'failed') {
        return { document: existing, shouldQueue: existing.status === 'pending' }
      }

      const [updated] = await tx
        .update(reviewDocuments)
        .set({
          rawText: record.rawText,
          status: 'pending',
          result: null,
          error: null,
          revision: sql`${reviewDocuments.revision} + 1`,
          updatedAt: record.updatedAt,
          completedAt: null,
        })
        .where(eq(reviewDocuments.id, existing.id))
        .returning()

      return { document: updated, shouldQueue: true }
    })
  }

  async deleteBySource(opportunityId: string, sourceType: 'written_test' | 'interview', interviewRoundId?: string) {
    await db
      .delete(reviewDocuments)
      .where(
        sourceType === 'written_test'
          ? and(eq(reviewDocuments.opportunityId, opportunityId), eq(reviewDocuments.sourceType, sourceType))
          : and(
              eq(reviewDocuments.opportunityId, opportunityId),
              eq(reviewDocuments.sourceType, sourceType),
              eq(reviewDocuments.interviewRoundId, interviewRoundId as string),
            ),
      )
  }

  async markProcessing(record: MarkReviewDocumentProcessingRecord) {
    const [document] = await db
      .update(reviewDocuments)
      .set({
        status: 'processing',
        modelName: record.modelName,
        promptVersion: record.promptVersion,
        currentAttempt: record.attemptNumber,
        error: null,
        updatedAt: record.startedAt,
        completedAt: null,
      })
      .where(
        and(
          eq(reviewDocuments.id, record.id),
          eq(reviewDocuments.revision, record.revision),
          eq(reviewDocuments.status, 'pending'),
        ),
      )
      .returning()

    if (!document) throw new ReviewDocumentConflictError('复盘文档不存在或已不处于 pending 状态')
    return document
  }

  async complete(record: CompleteReviewDocumentRecord) {
    const [document] = await db
      .update(reviewDocuments)
      .set({
        status: 'completed',
        result: record.result,
        error: null,
        updatedAt: record.finishedAt,
        completedAt: record.finishedAt,
      })
      .where(
        and(
          eq(reviewDocuments.id, record.id),
          eq(reviewDocuments.revision, record.revision),
          eq(reviewDocuments.status, 'processing'),
        ),
      )
      .returning()

    if (!document) throw new ReviewDocumentConflictError('复盘文档不存在或已不处于 processing 状态')
    return document
  }

  async fail(record: FailReviewDocumentRecord) {
    const [document] = await db
      .update(reviewDocuments)
      .set({
        status: 'failed',
        error: record.error,
        updatedAt: record.finishedAt,
        completedAt: null,
      })
      .where(
        and(
          eq(reviewDocuments.id, record.id),
          eq(reviewDocuments.revision, record.revision),
          inArray(reviewDocuments.status, ['pending', 'processing']),
        ),
      )
      .returning()

    if (!document) throw new ReviewDocumentConflictError('复盘文档不存在或已不处于 pending/processing 状态')
    return document
  }

  async retry(id: string, updatedAt: string) {
    const [document] = await db
      .update(reviewDocuments)
      .set({
        status: 'pending',
        result: null,
        error: null,
        revision: sql`${reviewDocuments.revision} + 1`,
        updatedAt,
        completedAt: null,
      })
      .where(and(eq(reviewDocuments.id, id), eq(reviewDocuments.status, 'failed')))
      .returning()

    if (!document) throw new ReviewDocumentConflictError('复盘文档不存在或已不处于 failed 状态')
    return document
  }
}

export const reviewDocumentRepository = new DrizzleReviewDocumentRepository()
