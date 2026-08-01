import { and, desc, eq, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  agentRuns,
  interviewSessions,
  interviewTurns,
  jobAnalyses,
  jobOpportunities,
  reviewDocuments,
} from '../db/schema'
import type { AgentWorkflowType } from '@/shared/interview/schemas'
import { measureDb } from '../utils/request-metrics'

export type AgentRunDebugListFilters = {
  limit: number
  workflowType?: AgentWorkflowType
}

type AgentRunRow = typeof agentRuns.$inferSelect

export type CompleteReviewExtractionRunRecord = {
  runId: string
  rawOutput: string
  parsedOutput: AgentRunRow['parsedOutput']
  tokenUsage: AgentRunRow['tokenUsage']
  durationMs: number
  finishedAt: string
}

export type FailReviewExtractionRunRecord = {
  runId: string
  error: AgentRunRow['error']
  rawOutput: string | null
  tokenUsage: AgentRunRow['tokenUsage']
  durationMs: number
  finishedAt: string
}

export class DrizzleAgentRunRepository {
  private debugRelations() {
    return {
      sourceAnalysisId: jobAnalyses.sourceAnalysisId,
      opportunityId: jobOpportunities.id,
      company: jobOpportunities.company,
      jobTitle: jobOpportunities.jobTitle,
      turnSequenceNumber: interviewTurns.sequenceNumber,
      mainQuestionNumber: interviewTurns.mainQuestionNumber,
      reviewDocumentId: reviewDocuments.id,
      reviewSourceType: reviewDocuments.sourceType,
      reviewDocumentStatus: reviewDocuments.status,
    }
  }

  private debugListQuery() {
    return db
      .select({
        run: {
          id: agentRuns.id,
          workflowType: agentRuns.workflowType,
          analysisId: agentRuns.analysisId,
          interviewSessionId: agentRuns.interviewSessionId,
          interviewTurnId: agentRuns.interviewTurnId,
          attemptNumber: agentRuns.attemptNumber,
          status: agentRuns.status,
          modelName: agentRuns.modelName,
          promptVersion: agentRuns.promptVersion,
          // 列表只保留错误摘要；validationIssues/rawOutput 仅在详情接口读取。
          error: sql<
            AgentRunRow['error']
          >`case when ${agentRuns.error} is null then null else jsonb_build_object('code', ${agentRuns.error}->>'code', 'message', ${agentRuns.error}->>'message') end`,
          durationMs: agentRuns.durationMs,
          startedAt: agentRuns.startedAt,
          finishedAt: agentRuns.finishedAt,
        },
        ...this.debugRelations(),
      })
      .from(agentRuns)
      .leftJoin(jobAnalyses, eq(agentRuns.analysisId, jobAnalyses.id))
      .leftJoin(interviewSessions, eq(agentRuns.interviewSessionId, interviewSessions.id))
      .leftJoin(interviewTurns, eq(agentRuns.interviewTurnId, interviewTurns.id))
      .leftJoin(reviewDocuments, eq(agentRuns.reviewDocumentId, reviewDocuments.id))
      .leftJoin(
        jobOpportunities,
        or(
          eq(jobOpportunities.id, jobAnalyses.opportunityId),
          eq(jobOpportunities.id, interviewSessions.opportunityId),
          eq(jobOpportunities.id, reviewDocuments.opportunityId),
        ),
      )
  }

  private debugDetailQuery() {
    return db
      .select({ run: agentRuns, ...this.debugRelations() })
      .from(agentRuns)
      .leftJoin(jobAnalyses, eq(agentRuns.analysisId, jobAnalyses.id))
      .leftJoin(interviewSessions, eq(agentRuns.interviewSessionId, interviewSessions.id))
      .leftJoin(interviewTurns, eq(agentRuns.interviewTurnId, interviewTurns.id))
      .leftJoin(reviewDocuments, eq(agentRuns.reviewDocumentId, reviewDocuments.id))
      .leftJoin(
        jobOpportunities,
        or(
          eq(jobOpportunities.id, jobAnalyses.opportunityId),
          eq(jobOpportunities.id, interviewSessions.opportunityId),
          eq(jobOpportunities.id, reviewDocuments.opportunityId),
        ),
      )
  }

  async findDebugList(filters: AgentRunDebugListFilters) {
    return measureDb(async () => {
      const query = this.debugListQuery()

      return (filters.workflowType ? query.where(eq(agentRuns.workflowType, filters.workflowType)) : query)
        .orderBy(desc(agentRuns.startedAt), desc(agentRuns.attemptNumber))
        .limit(filters.limit)
    })
  }

  async findDebugById(runId: string) {
    const [entry] = await measureDb(() => this.debugDetailQuery().where(eq(agentRuns.id, runId)).limit(1))

    return entry ?? null
  }

  async findLatestAttemptNumber(operationKey: string) {
    const [run] = await db
      .select({ attemptNumber: agentRuns.attemptNumber })
      .from(agentRuns)
      .where(eq(agentRuns.operationKey, operationKey))
      .orderBy(desc(agentRuns.attemptNumber))
      .limit(1)

    return run?.attemptNumber ?? 0
  }

  async createReviewExtractionRun(run: typeof agentRuns.$inferInsert) {
    if (!run.reviewDocumentId || run.workflowType !== 'review_extraction') {
      throw new TypeError('真实复盘提取 AgentRun 必须绑定 reviewDocumentId，并使用 review_extraction workflowType')
    }

    const [createdRun] = await db.insert(agentRuns).values(run).returning()
    return createdRun
  }

  async markReviewExtractionRunProcessing(runId: string, startedAt: string) {
    const [run] = await db
      .update(agentRuns)
      .set({ status: 'processing', startedAt })
      .where(
        and(eq(agentRuns.id, runId), eq(agentRuns.workflowType, 'review_extraction'), eq(agentRuns.status, 'pending')),
      )
      .returning()

    if (!run) throw new Error('真实复盘提取 AgentRun 不存在或已不处于 pending 状态')
    return run
  }

  async completeReviewExtractionRun(record: CompleteReviewExtractionRunRecord) {
    const [run] = await db
      .update(agentRuns)
      .set({
        status: 'completed',
        rawOutput: record.rawOutput,
        parsedOutput: record.parsedOutput,
        tokenUsage: record.tokenUsage,
        durationMs: record.durationMs,
        error: null,
        finishedAt: record.finishedAt,
      })
      .where(
        and(
          eq(agentRuns.id, record.runId),
          eq(agentRuns.workflowType, 'review_extraction'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new Error('真实复盘提取 AgentRun 不存在或已不处于 processing 状态')
    return run
  }

  async failReviewExtractionRun(record: FailReviewExtractionRunRecord) {
    const [run] = await db
      .update(agentRuns)
      .set({
        status: 'failed',
        error: record.error,
        rawOutput: record.rawOutput,
        tokenUsage: record.tokenUsage,
        durationMs: record.durationMs,
        finishedAt: record.finishedAt,
      })
      .where(
        and(
          eq(agentRuns.id, record.runId),
          eq(agentRuns.workflowType, 'review_extraction'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new Error('真实复盘提取 AgentRun 不存在或已不处于 processing 状态')
    return run
  }
}

export const agentRunRepository = new DrizzleAgentRunRepository()
