import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  InterviewAssessmentPlan,
  InterviewEvidenceStatus,
  InterviewSessionEvaluation,
} from '@/shared/interview/schemas'
import { db } from '../db/client'
import { interviewRounds, interviewSessionEvaluations, interviewSessions, jobOpportunities } from '../db/schema'

export type DashboardInterviewEvidenceRecord = {
  sessionId: string
  opportunityId: string
  company: string
  jobTitle: string
  evaluation: InterviewSessionEvaluation
  assessmentPlan: InterviewAssessmentPlan | null
  observedAt: string
}

export type DashboardReviewSourceCounts = {
  writtenTestReviews: number
  interviewReviews: number
}

function resolveObservedAt(record: { endedAt: string | null; lastActiveAt: string; updatedAt: string }) {
  return record.endedAt ?? record.lastActiveAt ?? record.updatedAt
}

function hasText(value: string | null) {
  return Boolean(value?.trim())
}

export class DrizzleDashboardRepository {
  async findInterviewEvidenceByUserId(userId: string): Promise<DashboardInterviewEvidenceRecord[]> {
    const rows = await db
      .select({
        sessionId: interviewSessions.id,
        opportunityId: interviewSessions.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
        evaluation: interviewSessionEvaluations.result,
        assessmentPlan: interviewSessions.assessmentPlan,
        endedAt: interviewSessions.endedAt,
        lastActiveAt: interviewSessions.lastActiveAt,
        updatedAt: interviewSessions.updatedAt,
      })
      .from(interviewSessions)
      .innerJoin(jobOpportunities, eq(interviewSessions.opportunityId, jobOpportunities.id))
      .innerJoin(interviewSessionEvaluations, eq(interviewSessions.id, interviewSessionEvaluations.sessionId))
      .where(
        and(
          eq(jobOpportunities.userId, userId),
          inArray(interviewSessions.status, ['completed', 'ended_early']),
          inArray(interviewSessions.evidenceStatus, ['partial', 'sufficient'] satisfies InterviewEvidenceStatus[]),
        ),
      )
      .orderBy(desc(interviewSessions.lastActiveAt))

    return rows.map((row) => ({
      sessionId: row.sessionId,
      opportunityId: row.opportunityId,
      company: row.company,
      jobTitle: row.jobTitle,
      evaluation: row.evaluation,
      assessmentPlan: row.assessmentPlan,
      observedAt: resolveObservedAt(row),
    }))
  }

  async findReviewSourceCountsByUserId(userId: string): Promise<DashboardReviewSourceCounts> {
    const rows = await db
      .select({
        opportunityId: jobOpportunities.id,
        writtenTestReviewNote: jobOpportunities.writtenTestReviewNote,
        interviewRoundId: interviewRounds.id,
        interviewRoundReviewNote: interviewRounds.reviewNote,
        interviewRoundKeyTakeaways: interviewRounds.keyTakeaways,
      })
      .from(jobOpportunities)
      .leftJoin(interviewRounds, eq(interviewRounds.opportunityId, jobOpportunities.id))
      .where(eq(jobOpportunities.userId, userId))

    const writtenTestOpportunityIds = new Set(
      rows.filter((row) => hasText(row.writtenTestReviewNote)).map((row) => row.opportunityId),
    )
    const interviewRoundIds = new Set(
      rows
        .filter(
          (row) =>
            row.interviewRoundId !== null &&
            (hasText(row.interviewRoundReviewNote) || (row.interviewRoundKeyTakeaways?.length ?? 0) > 0),
        )
        .map((row) => row.interviewRoundId),
    )

    return {
      writtenTestReviews: writtenTestOpportunityIds.size,
      interviewReviews: interviewRoundIds.size,
    }
  }
}

export const dashboardRepository = new DrizzleDashboardRepository()
