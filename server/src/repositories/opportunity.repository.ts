import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  InterviewRound,
  JobOpportunity,
  OpportunityStatusChange,
  OpportunityTermination,
  WrittenTestReview,
} from '@/types/opportunity'
import { db } from '../db/client'
import { interviewRounds, jobOpportunities, opportunityStatusHistory, opportunityTerminations } from '../db/schema'

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
}

export type CreateJobOpportunityRecord = {
  opportunity: JobOpportunityRecord
  initialStatusHistory: OpportunityStatusChange & { opportunityId: string }
}

export type JobOpportunityDetail = JobOpportunity

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

  async deleteOpportunityForUser(opportunityId: string, userId: string): Promise<string | null> {
    const [deletedOpportunity] = await db
      .delete(jobOpportunities)
      .where(and(eq(jobOpportunities.id, opportunityId), eq(jobOpportunities.userId, userId)))
      .returning({ id: jobOpportunities.id })

    return deletedOpportunity?.id ?? null
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
    })
  }

  async findOpportunitiesByUserId(userId: string): Promise<JobOpportunityRecord[]> {
    const rows = await db
      .select()
      .from(jobOpportunities)
      .where(eq(jobOpportunities.userId, userId))
      .orderBy(desc(jobOpportunities.updatedAt))

    return rows.map(toJobOpportunityRecord)
  }

  async findOpportunityById(opportunityId: string): Promise<JobOpportunityRecord | null> {
    const [row] = await db.select().from(jobOpportunities).where(eq(jobOpportunities.id, opportunityId)).limit(1)

    return row ? toJobOpportunityRecord(row) : null
  }

  async findOpportunityByDedupeFingerprint(
    userId: string,
    dedupeFingerprint: string,
  ): Promise<JobOpportunityRecord | null> {
    const [row] = await db
      .select()
      .from(jobOpportunities)
      .where(and(eq(jobOpportunities.userId, userId), eq(jobOpportunities.dedupeFingerprint, dedupeFingerprint)))
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
