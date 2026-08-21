import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type {
  InterviewRound,
  JobOpportunity,
  OpportunityStatusChange,
  OpportunityTermination,
  WrittenTestReview,
} from '@/types/opportunity'
import { db } from '../db/client'
import { measureDb } from '../utils/request-metrics'
import {
  interviewRounds,
  interviewSessions,
  jobOpportunities,
  opportunityStatusHistory,
  opportunityTerminations,
  reviewDocuments,
} from '../db/schema'

type JobOpportunityRow = typeof jobOpportunities.$inferSelect

export type JobOpportunityRecord = Omit<
  JobOpportunity,
  'writtenTestReview' | 'interviewRounds' | 'statusHistory' | 'termination'
> & {
  userId: string
  dedupeFingerprint: string | null
  writtenTestScheduledAt: string | null
  writtenTestReviewNote: string | null
  writtenTestReviewedAt: string | null
  deletedAt?: string | null
}

export type CreateJobOpportunityRecord = {
  opportunity: JobOpportunityRecord
  initialStatusHistory: OpportunityStatusChange & { opportunityId: string }
}

export type JobOpportunityDetail = JobOpportunity

export type OpportunityProfilePatch = Partial<
  Pick<
    JobOpportunityRecord,
    'intentionLevel' | 'industry' | 'address' | 'note' | 'includeWrittenTest' | 'dedupeFingerprint'
  >
>

export type UpdateOpportunityProfileForUserRecord = {
  opportunityId: string
  userId: string
  expectedUpdatedAt: string
  patch: OpportunityProfilePatch
  updatedAt: string
}

export type UpdateWrittenTestReviewForUserRecord = {
  opportunityId: string
  userId: string
  expectedUpdatedAt: string
  scheduledAt: string | null
  reviewNote: string
  updatedAt: string
}

export type UpdateInterviewReviewForUserRecord = {
  opportunityId: string
  roundId: string
  userId: string
  expectedRoundUpdatedAt: string
  scheduledAt: string | null
  result: Exclude<InterviewRound['result'], 'pending'>
  reviewNote: string
  updatedAt: string
}

export type UpdateOpportunityProfileWithStatusHistoryForUserRecord = UpdateOpportunityProfileForUserRecord & {
  nextStatus: JobOpportunityRecord['status']
  statusHistory: OpportunityStatusChange & { opportunityId: string }
}

export type BatchUpdateOpportunityProfileForUserRecord = UpdateOpportunityProfileForUserRecord &
  (
    | {
        nextStatus: JobOpportunityRecord['status']
        statusHistory: OpportunityStatusChange & { opportunityId: string }
      }
    | { nextStatus?: never; statusHistory?: never }
  )

export class OpportunityRepositoryConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpportunityRepositoryConflictError'
  }
}

type OpportunityStatusHistoryRecord = OpportunityStatusChange & { opportunityId: string }
type InterviewRoundRecord = InterviewRound & { opportunityId: string }
type TerminationRecord = OpportunityTermination

function toJobOpportunityInsertValues(opportunity: JobOpportunityRecord) {
  return {
    id: opportunity.id,
    userId: opportunity.userId,
    company: opportunity.company,
    jobTitle: opportunity.jobTitle,
    dedupeFingerprint: opportunity.dedupeFingerprint,
    address: opportunity.address ?? [],
    introduction: opportunity.introduction,
    description: opportunity.description,
    status: opportunity.status,
    includeWrittenTest: opportunity.includeWrittenTest,
    intentionLevel: opportunity.intentionLevel,
    industry: opportunity.industry,
    note: opportunity.note,
    writtenTestScheduledAt: opportunity.writtenTestScheduledAt,
    writtenTestReviewNote: opportunity.writtenTestReviewNote,
    writtenTestReviewedAt: opportunity.writtenTestReviewedAt,
    deletedAt: opportunity.deletedAt ?? null,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
  }
}

function toJobOpportunityUpdateValues(opportunity: JobOpportunityRecord) {
  return {
    company: opportunity.company,
    jobTitle: opportunity.jobTitle,
    dedupeFingerprint: opportunity.dedupeFingerprint,
    address: opportunity.address ?? [],
    introduction: opportunity.introduction,
    description: opportunity.description,
    status: opportunity.status,
    includeWrittenTest: opportunity.includeWrittenTest,
    intentionLevel: opportunity.intentionLevel,
    industry: opportunity.industry,
    note: opportunity.note,
    writtenTestScheduledAt: opportunity.writtenTestScheduledAt,
    writtenTestReviewNote: opportunity.writtenTestReviewNote,
    writtenTestReviewedAt: opportunity.writtenTestReviewedAt,
    updatedAt: opportunity.updatedAt,
  }
}

function toIsoTimestamp(value: string) {
  return new Date(value).toISOString()
}

function toJobOpportunityRecord(row: JobOpportunityRow): JobOpportunityRecord {
  return {
    id: row.id,
    userId: row.userId,
    company: row.company,
    jobTitle: row.jobTitle,
    dedupeFingerprint: row.dedupeFingerprint,
    address: row.address,
    introduction: row.introduction,
    description: row.description,
    status: row.status,
    includeWrittenTest: row.includeWrittenTest,
    intentionLevel: row.intentionLevel,
    industry: row.industry,
    note: row.note,
    writtenTestScheduledAt: row.writtenTestScheduledAt ? toIsoTimestamp(row.writtenTestScheduledAt) : null,
    writtenTestReviewNote: row.writtenTestReviewNote,
    writtenTestReviewedAt: row.writtenTestReviewedAt ? toIsoTimestamp(row.writtenTestReviewedAt) : null,
    deletedAt: row.deletedAt ? toIsoTimestamp(row.deletedAt) : null,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

function toInterviewRound(row: typeof interviewRounds.$inferSelect): InterviewRound {
  return {
    id: row.id,
    type: row.type,
    sequence: row.sequence,
    title: row.title,
    scheduledAt: row.scheduledAt ? toIsoTimestamp(row.scheduledAt) : '',
    status: row.status,
    result: row.result,
    note: row.note,
    reviewNote: row.reviewNote,
    keyTakeaways: row.keyTakeaways,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

function toStatusHistory(row: typeof opportunityStatusHistory.$inferSelect): OpportunityStatusChange {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    trigger: row.trigger,
    note: row.note ?? undefined,
    createdAt: toIsoTimestamp(row.createdAt),
  }
}

function toTermination(row: typeof opportunityTerminations.$inferSelect): OpportunityTermination {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    fromStatus: row.fromStatus,
    relatedInterviewRoundId: row.relatedInterviewRoundId ?? undefined,
    relatedInterviewRoundTitle: row.relatedInterviewRoundTitle ?? undefined,
    reasonCode: row.reasonCode,
    reasonNote: row.reasonNote,
    createdAt: toIsoTimestamp(row.createdAt),
  }
}

function toWrittenTestReview(opportunity: JobOpportunityRecord): WrittenTestReview {
  return {
    scheduledAt: opportunity.writtenTestScheduledAt ?? '',
    reviewNote: opportunity.writtenTestReviewNote ?? '',
    updatedAt: opportunity.writtenTestReviewedAt ?? opportunity.updatedAt,
  }
}

export class DrizzleOpportunityRepository {
  async createOpportunityWithInitialStatus(record: CreateJobOpportunityRecord) {
    await db.transaction(async (tx) => {
      await tx.insert(jobOpportunities).values(toJobOpportunityInsertValues(record.opportunity))
      await tx.insert(opportunityStatusHistory).values(record.initialStatusHistory)
    })
  }

  async updateOpportunity(opportunity: JobOpportunityRecord) {
    await db
      .update(jobOpportunities)
      .set(toJobOpportunityUpdateValues(opportunity))
      .where(eq(jobOpportunities.id, opportunity.id))
  }

  /** AI 工具专用写入边界：只有确认时看到的机会版本仍然有效时才应用资料 patch。 */
  async updateOpportunityProfileForUser(record: UpdateOpportunityProfileForUserRecord) {
    const [updated] = await db
      .update(jobOpportunities)
      .set({ ...record.patch, updatedAt: record.updatedAt })
      .where(
        and(
          eq(jobOpportunities.id, record.opportunityId),
          eq(jobOpportunities.userId, record.userId),
          eq(jobOpportunities.updatedAt, record.expectedUpdatedAt),
        ),
      )
      .returning()

    return updated ? toJobOpportunityRecord(updated) : null
  }

  /** AI 工具专用写入边界：只更新笔试复盘字段，并拒绝覆盖确认后已经变化的机会。 */
  async updateWrittenTestReviewForUser(record: UpdateWrittenTestReviewForUserRecord) {
    const [updated] = await db
      .update(jobOpportunities)
      .set({
        writtenTestScheduledAt: record.scheduledAt,
        writtenTestReviewNote: record.reviewNote,
        writtenTestReviewedAt: record.updatedAt,
        updatedAt: record.updatedAt,
      })
      .where(
        and(
          eq(jobOpportunities.id, record.opportunityId),
          eq(jobOpportunities.userId, record.userId),
          eq(jobOpportunities.updatedAt, record.expectedUpdatedAt),
        ),
      )
      .returning()

    return updated ? toJobOpportunityRecord(updated) : null
  }

  /** 关闭笔试流程并回退阶段必须原子提交，不能出现开关已关但阶段仍是“笔试中”的中间状态。 */
  async updateOpportunityProfileWithStatusHistoryForUser(
    record: UpdateOpportunityProfileWithStatusHistoryForUserRecord,
  ) {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(jobOpportunities)
        .set({ ...record.patch, status: record.nextStatus, updatedAt: record.updatedAt })
        .where(
          and(
            eq(jobOpportunities.id, record.opportunityId),
            eq(jobOpportunities.userId, record.userId),
            eq(jobOpportunities.updatedAt, record.expectedUpdatedAt),
          ),
        )
        .returning()

      if (!updated) return null
      await tx.insert(opportunityStatusHistory).values(record.statusHistory)
      return toJobOpportunityRecord(updated)
    })
  }

  /** 批量资料修改必须原子提交：任意一条版本失效时，整批更新全部回滚。 */
  async batchUpdateOpportunityProfilesForUser(records: BatchUpdateOpportunityProfileForUserRecord[]) {
    return db.transaction(async (tx) => {
      const updatedOpportunities: JobOpportunityRecord[] = []

      for (const record of records) {
        const [updated] = await tx
          .update(jobOpportunities)
          .set({
            ...record.patch,
            ...(record.nextStatus ? { status: record.nextStatus } : {}),
            updatedAt: record.updatedAt,
          })
          .where(
            and(
              eq(jobOpportunities.id, record.opportunityId),
              eq(jobOpportunities.userId, record.userId),
              eq(jobOpportunities.updatedAt, record.expectedUpdatedAt),
            ),
          )
          .returning()

        if (!updated) {
          throw new OpportunityRepositoryConflictError('批量修改期间机会信息已发生变化')
        }
        if (record.statusHistory) await tx.insert(opportunityStatusHistory).values(record.statusHistory)
        updatedOpportunities.push(toJobOpportunityRecord(updated))
      }

      return updatedOpportunities
    })
  }

  async softDeleteOpportunityForUser(opportunityId: string, userId: string, deletedAt: string): Promise<string | null> {
    const [deletedOpportunity] = await db
      .update(jobOpportunities)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(
        and(
          eq(jobOpportunities.id, opportunityId),
          eq(jobOpportunities.userId, userId),
          isNull(jobOpportunities.deletedAt),
        ),
      )
      .returning({ id: jobOpportunities.id })

    return deletedOpportunity?.id ?? null
  }

  /**
   * 删除确认中的“归档并删除”必须原子完成：只要发现仍在运行的模拟面试，
   * 就既不归档任何记录，也不软删除机会。
   */
  async archiveInterviewsAndSoftDeleteOpportunityForUser(
    opportunityId: string,
    userId: string,
    deletedAt: string,
  ): Promise<
    | { status: 'deleted'; id: string; archivedSessionCount: number }
    | { status: 'blocked'; blockingStatuses: string[] }
    | { status: 'not_found' }
  > {
    return db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select({ id: jobOpportunities.id })
        .from(jobOpportunities)
        .where(
          and(
            eq(jobOpportunities.id, opportunityId),
            eq(jobOpportunities.userId, userId),
            isNull(jobOpportunities.deletedAt),
          ),
        )
        .limit(1)

      if (!opportunity) return { status: 'not_found' as const }

      const unarchivedSessions = await tx
        .select({ id: interviewSessions.id, status: interviewSessions.status })
        .from(interviewSessions)
        .where(and(eq(interviewSessions.opportunityId, opportunityId), isNull(interviewSessions.archivedAt)))

      const archiveableStatuses = new Set(['completed', 'ended_early', 'cancelled', 'preparation_failed'])
      const blockingStatuses = unarchivedSessions
        .filter((session) => !archiveableStatuses.has(session.status))
        .map((session) => session.status)

      if (blockingStatuses.length > 0) return { status: 'blocked' as const, blockingStatuses }

      const archivedSessions = unarchivedSessions.length
        ? await tx
            .update(interviewSessions)
            .set({ archivedAt: deletedAt, updatedAt: deletedAt })
            .where(
              and(
                eq(interviewSessions.opportunityId, opportunityId),
                isNull(interviewSessions.archivedAt),
                inArray(interviewSessions.status, ['completed', 'ended_early', 'cancelled', 'preparation_failed']),
              ),
            )
            .returning({ id: interviewSessions.id })
        : []

      const [deletedOpportunity] = await tx
        .update(jobOpportunities)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(jobOpportunities.id, opportunityId),
            eq(jobOpportunities.userId, userId),
            isNull(jobOpportunities.deletedAt),
          ),
        )
        .returning({ id: jobOpportunities.id })

      if (!deletedOpportunity) return { status: 'not_found' as const }
      return {
        status: 'deleted' as const,
        id: deletedOpportunity.id,
        archivedSessionCount: archivedSessions.length,
      }
    })
  }

  async updateOpportunityWithStatusHistory(
    opportunity: JobOpportunityRecord,
    statusHistory: OpportunityStatusHistoryRecord,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))
      await tx.insert(opportunityStatusHistory).values(statusHistory)
    })
  }

  async updateOpportunityWithStatusHistoryIfCurrentStatus(
    opportunity: JobOpportunityRecord,
    expectedStatus: JobOpportunityRecord['status'],
    statusHistory: OpportunityStatusHistoryRecord,
  ) {
    return db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(and(eq(jobOpportunities.id, opportunity.id), eq(jobOpportunities.status, expectedStatus)))
        .returning({ id: jobOpportunities.id })

      if (updatedRows.length === 0) return false

      await tx.insert(opportunityStatusHistory).values(statusHistory)

      return true
    })
  }

  async terminateOpportunity(
    opportunity: JobOpportunityRecord,
    statusHistory: OpportunityStatusHistoryRecord,
    termination: TerminationRecord,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))
      await tx.insert(opportunityStatusHistory).values(statusHistory)
      await tx.insert(opportunityTerminations).values({
        id: termination.id,
        opportunityId: termination.opportunityId,
        fromStatus: termination.fromStatus,
        relatedInterviewRoundId: termination.relatedInterviewRoundId,
        relatedInterviewRoundTitle: termination.relatedInterviewRoundTitle,
        reasonCode: termination.reasonCode,
        reasonNote: termination.reasonNote,
        createdAt: termination.createdAt,
      })
      await tx
        .update(interviewRounds)
        .set({
          status: 'canceled',
          result: 'unknown',
          updatedAt: opportunity.updatedAt,
        })
        .where(and(eq(interviewRounds.opportunityId, opportunity.id), eq(interviewRounds.status, 'planned')))
    })
  }

  /**
   * AI 助手使用显式 userId 和确认时的状态快照终止机会。
   * 条件更新保证用户确认后若机会状态已变，旧卡片不会覆盖新数据。
   */
  async terminateOpportunityForUser(
    opportunity: JobOpportunityRecord,
    expectedStatus: JobOpportunityRecord['status'],
    statusHistory: OpportunityStatusHistoryRecord,
    termination: TerminationRecord,
  ) {
    return db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(
          and(
            eq(jobOpportunities.id, opportunity.id),
            eq(jobOpportunities.userId, opportunity.userId),
            eq(jobOpportunities.status, expectedStatus),
            isNull(jobOpportunities.deletedAt),
          ),
        )
        .returning({ id: jobOpportunities.id })

      if (updatedRows.length === 0) return false

      await tx.insert(opportunityStatusHistory).values(statusHistory)
      await tx.insert(opportunityTerminations).values({
        id: termination.id,
        opportunityId: termination.opportunityId,
        fromStatus: termination.fromStatus,
        relatedInterviewRoundId: termination.relatedInterviewRoundId,
        relatedInterviewRoundTitle: termination.relatedInterviewRoundTitle,
        reasonCode: termination.reasonCode,
        reasonNote: termination.reasonNote,
        createdAt: termination.createdAt,
      })
      await tx
        .update(interviewRounds)
        .set({
          status: 'canceled',
          result: 'unknown',
          updatedAt: opportunity.updatedAt,
        })
        .where(and(eq(interviewRounds.opportunityId, opportunity.id), eq(interviewRounds.status, 'planned')))

      return true
    })
  }

  async findOpportunitiesByUserId(userId: string): Promise<JobOpportunityRecord[]> {
    const rows = await db
      .select()
      .from(jobOpportunities)
      .where(and(eq(jobOpportunities.userId, userId), isNull(jobOpportunities.deletedAt)))
      .orderBy(desc(jobOpportunities.updatedAt))

    return rows.map(toJobOpportunityRecord)
  }

  async findOpportunityById(opportunityId: string): Promise<JobOpportunityRecord | null> {
    const [row] = await db.select().from(jobOpportunities).where(eq(jobOpportunities.id, opportunityId)).limit(1)

    return row ? toJobOpportunityRecord(row) : null
  }

  /** 权限校验只需要归属关系，不读取 JD 正文、备注和复盘字段。 */
  async findOpportunityOwnership(opportunityId: string): Promise<{ id: string; userId: string } | null> {
    const [row] = await measureDb(() =>
      db
        .select({ id: jobOpportunities.id, userId: jobOpportunities.userId })
        .from(jobOpportunities)
        .where(eq(jobOpportunities.id, opportunityId))
        .limit(1),
    )

    return row ?? null
  }

  async findOwnedOpportunityIds(opportunityIds: string[], userId: string): Promise<string[]> {
    if (opportunityIds.length === 0) return []

    const rows = await measureDb(() =>
      db
        .select({ id: jobOpportunities.id })
        .from(jobOpportunities)
        .where(
          and(
            eq(jobOpportunities.userId, userId),
            inArray(jobOpportunities.id, opportunityIds),
            isNull(jobOpportunities.deletedAt),
          ),
        ),
    )

    return rows.map((row) => row.id)
  }

  async findOpportunityByDedupeFingerprint(
    userId: string,
    dedupeFingerprint: string,
  ): Promise<JobOpportunityRecord | null> {
    const [row] = await db
      .select()
      .from(jobOpportunities)
      .where(
        and(
          eq(jobOpportunities.userId, userId),
          eq(jobOpportunities.dedupeFingerprint, dedupeFingerprint),
          isNull(jobOpportunities.deletedAt),
        ),
      )
      .limit(1)

    return row ? toJobOpportunityRecord(row) : null
  }

  async findNextInterviewRoundSequence(opportunityId: string): Promise<number> {
    const [latestRound] = await db
      .select({ sequence: interviewRounds.sequence })
      .from(interviewRounds)
      .where(eq(interviewRounds.opportunityId, opportunityId))
      .orderBy(desc(interviewRounds.sequence))
      .limit(1)

    return (latestRound?.sequence ?? 0) + 1
  }

  async findInterviewRoundById(opportunityId: string, roundId: string): Promise<InterviewRound | null> {
    const [row] = await db
      .select()
      .from(interviewRounds)
      .where(and(eq(interviewRounds.opportunityId, opportunityId), eq(interviewRounds.id, roundId)))
      .limit(1)

    return row ? toInterviewRound(row) : null
  }

  async findInterviewRoundsByOpportunityId(opportunityId: string): Promise<InterviewRound[]> {
    const rows = await db
      .select()
      .from(interviewRounds)
      .where(eq(interviewRounds.opportunityId, opportunityId))
      .orderBy(desc(interviewRounds.updatedAt), desc(interviewRounds.sequence))

    return rows.map(toInterviewRound)
  }

  /** 读取真实笔试复盘和面试轮次复盘，供模拟面试计划生成使用。 */
  async findInterviewHistoryByOpportunityId(opportunityId: string, existingOpportunity?: JobOpportunityRecord) {
    const [opportunity, roundRows, reviewDocumentRows] = await Promise.all([
      existingOpportunity ? Promise.resolve(existingOpportunity) : this.findOpportunityById(opportunityId),
      db
        .select()
        .from(interviewRounds)
        .where(eq(interviewRounds.opportunityId, opportunityId))
        .orderBy(desc(interviewRounds.updatedAt), desc(interviewRounds.sequence)),
      db
        .select({
          sourceType: reviewDocuments.sourceType,
          interviewRoundId: reviewDocuments.interviewRoundId,
          status: reviewDocuments.status,
          result: reviewDocuments.result,
          updatedAt: reviewDocuments.updatedAt,
        })
        .from(reviewDocuments)
        .where(eq(reviewDocuments.opportunityId, opportunityId))
        .orderBy(desc(reviewDocuments.updatedAt)),
    ])

    if (!opportunity) return null

    return {
      writtenTestReview: toWrittenTestReview(opportunity),
      interviewRounds: roundRows.map(toInterviewRound),
      reviewDocuments: reviewDocumentRows,
    }
  }

  async createInterviewRound(round: InterviewRoundRecord, opportunity: JobOpportunityRecord) {
    await db.transaction(async (tx) => {
      await tx.insert(interviewRounds).values({
        id: round.id,
        opportunityId: round.opportunityId,
        sequence: round.sequence,
        type: round.type,
        title: round.title,
        scheduledAt: round.scheduledAt || null,
        status: round.status,
        result: round.result,
        note: round.note,
        reviewNote: round.reviewNote,
        keyTakeaways: round.keyTakeaways,
        createdAt: round.createdAt,
        updatedAt: round.updatedAt,
      })
      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))
    })
  }

  async updateInterviewRound(round: InterviewRoundRecord, opportunity: JobOpportunityRecord) {
    await db.transaction(async (tx) => {
      await tx
        .update(interviewRounds)
        .set({
          type: round.type,
          title: round.title,
          scheduledAt: round.scheduledAt || null,
          status: round.status,
          result: round.result,
          note: round.note,
          reviewNote: round.reviewNote,
          keyTakeaways: round.keyTakeaways,
          updatedAt: round.updatedAt,
        })
        .where(and(eq(interviewRounds.opportunityId, round.opportunityId), eq(interviewRounds.id, round.id)))
      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))
    })
  }

  /** AI 工具专用写入边界：复盘、轮次完成状态与机会更新时间在同一事务中提交。 */
  async updateInterviewReviewForUser(record: UpdateInterviewReviewForUserRecord) {
    return db.transaction(async (tx) => {
      const [updatedRound] = await tx
        .update(interviewRounds)
        .set({
          scheduledAt: record.scheduledAt,
          status: 'completed',
          result: record.result,
          reviewNote: record.reviewNote,
          updatedAt: record.updatedAt,
        })
        .where(
          and(
            eq(interviewRounds.id, record.roundId),
            eq(interviewRounds.opportunityId, record.opportunityId),
            eq(interviewRounds.updatedAt, record.expectedRoundUpdatedAt),
          ),
        )
        .returning()

      if (!updatedRound) return null

      const [ownedOpportunity] = await tx
        .update(jobOpportunities)
        .set({ updatedAt: record.updatedAt })
        .where(and(eq(jobOpportunities.id, record.opportunityId), eq(jobOpportunities.userId, record.userId)))
        .returning({ id: jobOpportunities.id })

      if (!ownedOpportunity) throw new Error('岗位机会不存在或不属于当前用户')
      return toInterviewRound(updatedRound)
    })
  }

  async updateInterviewRoundIfCurrentStatus(
    round: InterviewRoundRecord,
    expectedStatus: InterviewRound['status'],
    opportunity: JobOpportunityRecord,
  ) {
    return db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(interviewRounds)
        .set({
          type: round.type,
          title: round.title,
          scheduledAt: round.scheduledAt || null,
          status: round.status,
          result: round.result,
          note: round.note,
          reviewNote: round.reviewNote,
          keyTakeaways: round.keyTakeaways,
          updatedAt: round.updatedAt,
        })
        .where(
          and(
            eq(interviewRounds.opportunityId, round.opportunityId),
            eq(interviewRounds.id, round.id),
            eq(interviewRounds.status, expectedStatus),
          ),
        )
        .returning({ id: interviewRounds.id })

      if (updatedRows.length === 0) return false

      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))

      return true
    })
  }

  async deleteInterviewRound(opportunityId: string, roundId: string, opportunity: JobOpportunityRecord) {
    await db.transaction(async (tx) => {
      await tx
        .delete(interviewRounds)
        .where(and(eq(interviewRounds.opportunityId, opportunityId), eq(interviewRounds.id, roundId)))
      await tx
        .update(jobOpportunities)
        .set(toJobOpportunityUpdateValues(opportunity))
        .where(eq(jobOpportunities.id, opportunity.id))
    })
  }

  async findOpportunityDetailById(opportunityId: string): Promise<JobOpportunityDetail | null> {
    const [opportunity, statusHistoryRows, interviewRoundRows, terminationRows] = await Promise.all([
      this.findOpportunityById(opportunityId),
      db
        .select()
        .from(opportunityStatusHistory)
        .where(eq(opportunityStatusHistory.opportunityId, opportunityId))
        .orderBy(desc(opportunityStatusHistory.createdAt)),
      db
        .select()
        .from(interviewRounds)
        .where(eq(interviewRounds.opportunityId, opportunityId))
        .orderBy(asc(interviewRounds.sequence)),
      db
        .select()
        .from(opportunityTerminations)
        .where(eq(opportunityTerminations.opportunityId, opportunityId))
        .limit(1),
    ])

    if (!opportunity) return null

    return {
      id: opportunity.id,
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      address: opportunity.address,
      introduction: opportunity.introduction,
      description: opportunity.description,
      status: opportunity.status,
      includeWrittenTest: opportunity.includeWrittenTest,
      intentionLevel: opportunity.intentionLevel,
      industry: opportunity.industry,
      note: opportunity.note,
      writtenTestReview: toWrittenTestReview(opportunity),
      interviewRounds: interviewRoundRows.map(toInterviewRound),
      termination: terminationRows[0] ? toTermination(terminationRows[0]) : undefined,
      statusHistory: statusHistoryRows.map(toStatusHistory),
      createdAt: opportunity.createdAt,
      updatedAt: opportunity.updatedAt,
    }
  }
}

export const opportunityRepository = new DrizzleOpportunityRepository()
