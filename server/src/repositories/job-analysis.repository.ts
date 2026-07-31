import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { db } from '../db/client'
import { agentRuns, jobAnalyses } from '../db/schema'
import type { AgentRunError, AgentTokenUsage, JobAnalysisResult } from '@/types/opportunity'

export type CreateAnalysisWithInitialRunRecord = {
  analysis: typeof jobAnalyses.$inferInsert
  run: typeof agentRuns.$inferInsert
}

export type CompleteRunAndAnalysisRecord = {
  analysisId: string
  runId: string
  resumeVersionId: string

  result: JobAnalysisResult
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type MarkRunProcessingRecord = {
  analysisId: string
  runId: string
  startedAt: string
}

export type FailRunRecord = {
  analysisId: string
  runId: string
  error: AgentRunError
  rawOutput: string | null
  tokenUsage: AgentTokenUsage | null
  durationMs: number | null
  finishedAt: string
}

export type MarkAnalysisFailedRecord = {
  analysisId: string
  failedAt: string
}

export type QueueExistingAnalysisWithRunRecord = {
  analysisId: string
  resumeId: string
  resumeVersionId: string
  queuedAt: string
  run: typeof agentRuns.$inferInsert
}

export class DrizzleJobAnalysisRepository {
  async createAnalysisWithInitialRun(record: CreateAnalysisWithInitialRunRecord) {
    return db.transaction(async (tx) => {
      const [analysis] = await tx.insert(jobAnalyses).values(record.analysis).returning()
      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      return { analysis, run }
    })
  }

  async findAnalysisByOpportunityId(opportunityId: string) {
    const [analysis] = await db.select().from(jobAnalyses).where(eq(jobAnalyses.opportunityId, opportunityId)).limit(1)

    return analysis ?? null
  }

  async findRunsByAnalysisId(analysisId: string) {
    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.analysisId, analysisId))
      .orderBy(desc(agentRuns.attemptNumber))
  }

  async findAnalysesByOpportunityIds(opportunityIds: string[]) {
    if (opportunityIds.length === 0) return []

    return db.select().from(jobAnalyses).where(inArray(jobAnalyses.opportunityId, opportunityIds))
  }

  async findRunsByAnalysisIds(analysisIds: string[]) {
    if (analysisIds.length === 0) return []

    return db
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.analysisId, analysisIds))
      .orderBy(desc(agentRuns.attemptNumber))
  }

  async queueExistingAnalysisWithRun(record: QueueExistingAnalysisWithRunRecord) {
    return db.transaction(async (tx) => {
      const [analysis] = await tx
        .update(jobAnalyses)
        .set({
          resumeId: record.resumeId,
          resumeVersionId: record.resumeVersionId,
          status: 'pending',
          result: null,
          updatedAt: record.queuedAt,
          completedAt: null,
        })
        .where(
          and(
            eq(jobAnalyses.id, record.analysisId),
            or(eq(jobAnalyses.status, 'completed'), eq(jobAnalyses.status, 'failed')),
          ),
        )
        .returning()

      if (!analysis) throw new Error('JobAnalysis 不存在或正在执行')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      return { analysis, run }
    })
  }

  async createRetryRun(run: typeof agentRuns.$inferInsert) {
    const [createdRun] = await db.insert(agentRuns).values(run).returning()

    return createdRun
  }

  async markRetryRunProcessing(record: MarkRunProcessingRecord) {
    const [run] = await db
      .update(agentRuns)
      .set({
        status: 'processing',
        startedAt: record.startedAt,
      })
      .where(
        and(
          eq(agentRuns.analysisId, record.analysisId),
          eq(agentRuns.id, record.runId),
          eq(agentRuns.status, 'pending'),
        ),
      )
      .returning()

    if (!run) throw new Error('重试 AgentRun 不存在或已不处于 pending 状态')

    return run
  }

  async completeRunAndAnalysis(record: CompleteRunAndAnalysisRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.result,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.analysisId, record.analysisId),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new Error('AgentRun 不存在或已不处于 processing 状态')

      const [analysis] = await tx
        .update(jobAnalyses)
        .set({
          resumeVersionId: record.resumeVersionId,
          status: 'completed',
          result: record.result,
          updatedAt: record.finishedAt,
          completedAt: record.finishedAt,
        })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
        .returning()

      if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 processing 状态')

      return { analysis, run }
    })
  }

  async markRunProcessing(record: MarkRunProcessingRecord) {
    return db.transaction(async (tx) => {
      const [analysis] = await tx
        .update(jobAnalyses)
        .set({
          status: 'processing',
          updatedAt: record.startedAt,
        })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'pending')))
        .returning()
      if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 pending 状态')
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'processing',
          startedAt: record.startedAt,
        })
        .where(
          and(
            eq(agentRuns.analysisId, record.analysisId),
            eq(agentRuns.id, record.runId),
            eq(agentRuns.status, 'pending'),
          ),
        )
        .returning()
      if (!run) throw new Error('AgentRun 不存在或已不处于 pending 状态')

      return { analysis, run }
    })
  }

  async failRun(record: FailRunRecord) {
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
          eq(agentRuns.analysisId, record.analysisId),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new Error('AgentRun 不存在或已不处于 processing 状态')

    return run
  }

  async markAnalysisFailed(record: MarkAnalysisFailedRecord) {
    const [analysis] = await db
      .update(jobAnalyses)
      .set({
        status: 'failed',
        updatedAt: record.failedAt,
      })
      .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
      .returning()

    if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 processing 状态')

    return analysis
  }
}

export const jobAnalysisRepository = new DrizzleJobAnalysisRepository()
