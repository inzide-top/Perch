import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type {
  InterviewAssessmentPlan,
  InterviewEvidenceStatus,
  InterviewSessionEvaluation,
  InterviewSessionStatus,
} from '@/shared/interview/schemas'
import type { JobAnalysisResult, JobAnalysisStatus, JobOpportunityStatus } from '@/types/opportunity'
import { db } from '../db/client'
import {
  interviewSessionEvaluations,
  interviewSessions,
  interviewTurns,
  jobAnalyses,
  jobOpportunities,
  resumeVersions,
} from '../db/schema'

export type CapabilityJobAnalysisRecord = {
  opportunityId: string
  company: string
  jobTitle: string
  opportunityStatus: JobOpportunityStatus
  resumeVersionId: string
  versionNumber: number
  status: JobAnalysisStatus
  updatedAt: string
  modelName: string | null
  result: JobAnalysisResult | null
}

export type CapabilityInterviewRecord = {
  sessionId: string
  opportunityId: string
  company: string
  jobTitle: string
  resumeVersionId: string
  versionNumber: number
  status: Extract<InterviewSessionStatus, 'completed' | 'ended_early'>
  evidenceStatus: Extract<InterviewEvidenceStatus, 'partial' | 'sufficient'>
  latestOverallScore: number | null
  evaluation: InterviewSessionEvaluation
  assessmentPlan: InterviewAssessmentPlan | null
  answeredQuestionCount: number
  validAnswerCount: number
  observedAt: string
}

function resolveObservedAt(record: { endedAt: string | null; lastActiveAt: string; updatedAt: string }) {
  return record.endedAt ?? record.lastActiveAt ?? record.updatedAt
}

export class DrizzleCapabilityProfileRepository {
  async findJobAnalysesByResumeId(userId: string, resumeId: string): Promise<CapabilityJobAnalysisRecord[]> {
    const rows = await db
      .select({
        opportunityId: jobAnalyses.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
        opportunityStatus: jobOpportunities.status,
        resumeVersionId: jobAnalyses.resumeVersionId,
        versionNumber: resumeVersions.versionNumber,
        status: jobAnalyses.status,
        updatedAt: jobAnalyses.updatedAt,
        modelName: jobAnalyses.modelName,
        result: jobAnalyses.result,
      })
      .from(jobAnalyses)
      .innerJoin(jobOpportunities, eq(jobAnalyses.opportunityId, jobOpportunities.id))
      .innerJoin(resumeVersions, eq(jobAnalyses.resumeVersionId, resumeVersions.id))
      .where(and(eq(jobOpportunities.userId, userId), eq(jobAnalyses.resumeId, resumeId)))
      .orderBy(desc(jobAnalyses.updatedAt))

    return rows
  }

  async findInterviewEvidenceByResumeId(userId: string, resumeId: string): Promise<CapabilityInterviewRecord[]> {
    const rows = await db
      .select({
        sessionId: interviewSessions.id,
        opportunityId: interviewSessions.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
        resumeVersionId: interviewSessions.resumeVersionId,
        versionNumber: resumeVersions.versionNumber,
        status: interviewSessions.status,
        evidenceStatus: interviewSessions.evidenceStatus,
        latestOverallScore: interviewSessions.latestOverallScore,
        evaluation: interviewSessionEvaluations.result,
        assessmentPlan: interviewSessions.assessmentPlan,
        endedAt: interviewSessions.endedAt,
        lastActiveAt: interviewSessions.lastActiveAt,
        updatedAt: interviewSessions.updatedAt,
      })
      .from(interviewSessions)
      .innerJoin(jobOpportunities, eq(interviewSessions.opportunityId, jobOpportunities.id))
      .innerJoin(resumeVersions, eq(interviewSessions.resumeVersionId, resumeVersions.id))
      .innerJoin(interviewSessionEvaluations, eq(interviewSessions.id, interviewSessionEvaluations.sessionId))
      .where(
        and(
          eq(jobOpportunities.userId, userId),
          eq(resumeVersions.resumeId, resumeId),
          inArray(interviewSessions.status, ['completed', 'ended_early']),
          inArray(interviewSessions.evidenceStatus, ['partial', 'sufficient']),
        ),
      )
      .orderBy(desc(interviewSessions.lastActiveAt))

    if (rows.length === 0) return []

    const sessionIds = rows.map((row) => row.sessionId)
    const turnCounts = await db
      .select({
        sessionId: interviewTurns.sessionId,
        status: interviewTurns.status,
        answeredQuestionCount: count(interviewTurns.id),
      })
      .from(interviewTurns)
      .where(
        and(inArray(interviewTurns.sessionId, sessionIds), inArray(interviewTurns.status, ['completed', 'skipped'])),
      )
      .groupBy(interviewTurns.sessionId, interviewTurns.status)

    const countsBySessionId = new Map<string, { answered: number; valid: number }>()
    for (const row of turnCounts) {
      const current = countsBySessionId.get(row.sessionId) ?? { answered: 0, valid: 0 }
      const amount = Number(row.answeredQuestionCount)
      current.answered += amount
      if (row.status === 'completed') current.valid += amount
      countsBySessionId.set(row.sessionId, current)
    }

    return rows.map((row) => {
      const counts = countsBySessionId.get(row.sessionId)
      return {
        sessionId: row.sessionId,
        opportunityId: row.opportunityId,
        company: row.company,
        jobTitle: row.jobTitle,
        resumeVersionId: row.resumeVersionId,
        versionNumber: row.versionNumber,
        status: row.status as Extract<InterviewSessionStatus, 'completed' | 'ended_early'>,
        evidenceStatus: row.evidenceStatus as Extract<InterviewEvidenceStatus, 'partial' | 'sufficient'>,
        latestOverallScore: row.latestOverallScore,
        evaluation: row.evaluation,
        assessmentPlan: row.assessmentPlan,
        answeredQuestionCount: counts?.answered ?? 0,
        validAnswerCount: counts?.valid ?? 0,
        observedAt: resolveObservedAt(row),
      }
    })
  }
}

export const capabilityProfileRepository = new DrizzleCapabilityProfileRepository()
