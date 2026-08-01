import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db/client'
import { agentRuns, jobAnalyses, jobOpportunities } from '../db/schema'
import type { AgentRunError, AgentTokenUsage, JobAnalysisResult } from '@/types/opportunity'

export type CreateAnalysisWithInitialRunRecord = {
  analysis: typeof jobAnalyses.$inferInsert
  run: typeof agentRuns.$inferInsert
}

export type CompleteRunAndAnalysisRecord = {
  analysisId: string
  runId: string
  resumeVersionId: string
  modelName: string

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

export type FailStuckRunAndAnalysisRecord = MarkAnalysisFailedRecord & {
  runId: string
  error: AgentRunError
  durationMs: number
}

export type QueueExistingAnalysisWithRunRecord = {
  analysisId: string
  resumeId: string
  resumeVersionId: string
  inputFingerprint: string
  queuedAt: string
  run: typeof agentRuns.$inferInsert
}

export type QueueRetryRunRecord = {
  analysisId: string
  currentAttempt: number
  queuedAt: string
  run: typeof agentRuns.$inferInsert
}

/** 将相同输入的机会分析挂到正在执行的源分析，避免重复调用模型。 */
export type LinkAnalysisToSourceRecord = {
  id: string
  opportunityId: string
  resumeId: string
  resumeVersionId: string
  sourceAnalysis: typeof jobAnalyses.$inferSelect
  linkedAt: string
}

export class DrizzleJobAnalysisRepository {
  async findAgentRunDebugList(limit: number) {
    return db
      .select({
        run: agentRuns,
        analysisId: jobAnalyses.id,
        sourceAnalysisId: jobAnalyses.sourceAnalysisId,
        opportunityId: jobAnalyses.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
      })
      .from(agentRuns)
      .innerJoin(jobAnalyses, eq(agentRuns.analysisId, jobAnalyses.id))
      .innerJoin(jobOpportunities, eq(jobAnalyses.opportunityId, jobOpportunities.id))
      .orderBy(desc(agentRuns.startedAt), desc(agentRuns.attemptNumber))
      .limit(limit)
  }

  async findAgentRunDebugById(runId: string) {
    const [entry] = await db
      .select({
        run: agentRuns,
        analysisId: jobAnalyses.id,
        sourceAnalysisId: jobAnalyses.sourceAnalysisId,
        opportunityId: jobAnalyses.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
      })
      .from(agentRuns)
      .innerJoin(jobAnalyses, eq(agentRuns.analysisId, jobAnalyses.id))
      .innerJoin(jobOpportunities, eq(jobAnalyses.opportunityId, jobOpportunities.id))
      .where(eq(agentRuns.id, runId))
      .limit(1)

    return entry ?? null
  }

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

  async markFollowersFailedForDeletedSource(sourceAnalysisId: string, failedAt: string) {
    await db
      .update(jobAnalyses)
      .set({ status: 'failed', updatedAt: failedAt })
      .where(
        and(
          eq(jobAnalyses.sourceAnalysisId, sourceAnalysisId),
          inArray(jobAnalyses.status, ['pending', 'processing']),
        ),
      )
  }

  async findCompletedAnalysisByInputFingerprint(inputFingerprint: string) {
    const [analysis] = await db
      .select()
      .from(jobAnalyses)
      .where(
        and(
          eq(jobAnalyses.inputFingerprint, inputFingerprint),
          eq(jobAnalyses.status, 'completed'),
          isNull(jobAnalyses.sourceAnalysisId),
        ),
      )
      .orderBy(desc(jobAnalyses.updatedAt))
      .limit(1)

    return analysis ?? null
  }

  async findActiveSourceAnalysisByInputFingerprint(inputFingerprint: string) {
    const [analysis] = await db
      .select()
      .from(jobAnalyses)
      .where(
        and(
          eq(jobAnalyses.inputFingerprint, inputFingerprint),
          isNull(jobAnalyses.sourceAnalysisId),
          inArray(jobAnalyses.status, ['pending', 'processing']),
        ),
      )
      .orderBy(desc(jobAnalyses.updatedAt))
      .limit(1)

    return analysis ?? null
  }

  async createCompletedAnalysisFromCache(analysis: typeof jobAnalyses.$inferInsert) {
    const [cachedAnalysis] = await db.insert(jobAnalyses).values(analysis).returning()

    return cachedAnalysis
  }

  async linkAnalysisToSource(record: LinkAnalysisToSourceRecord) {
    const values = {
      resumeId: record.resumeId,
      resumeVersionId: record.resumeVersionId,
      sourceAnalysisId: record.sourceAnalysis.id,
      status: record.sourceAnalysis.status,
      currentAttempt: record.sourceAnalysis.currentAttempt,
      inputFingerprint: record.sourceAnalysis.inputFingerprint,
      modelName: record.sourceAnalysis.modelName,
      result: record.sourceAnalysis.result,
      updatedAt: record.linkedAt,
      completedAt: record.sourceAnalysis.completedAt,
    }

    const [updated] = await db
      .update(jobAnalyses)
      .set(values)
      .where(and(eq(jobAnalyses.id, record.id), inArray(jobAnalyses.status, ['completed', 'failed'])))
      .returning()

    if (updated) return updated

    const [created] = await db
      .insert(jobAnalyses)
      .values({
        id: record.id,
        opportunityId: record.opportunityId,
        createdAt: record.linkedAt,
        ...values,
      })
      .returning()

    return created
  }

  async updateExistingAnalysisFromCache(record: {
    analysisId: string
    resumeId: string
    resumeVersionId: string
    inputFingerprint: string
    modelName: string | null
    sourceAnalysisId: string | null
    result: JobAnalysisResult
    completedAt: string
  }) {
    const [analysis] = await db
      .update(jobAnalyses)
      .set({
        resumeId: record.resumeId,
        resumeVersionId: record.resumeVersionId,
        status: 'completed',
        currentAttempt: 0,
        inputFingerprint: record.inputFingerprint,
        sourceAnalysisId: record.sourceAnalysisId,
        modelName: record.modelName,
        result: record.result,
        updatedAt: record.completedAt,
        completedAt: record.completedAt,
      })
      .where(and(eq(jobAnalyses.id, record.analysisId), inArray(jobAnalyses.status, ['completed', 'failed'])))
      .returning()

    if (!analysis) throw new Error('JobAnalysis 不存在或正在执行')

    return analysis
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

  async findAnalysesByIds(analysisIds: string[]) {
    if (analysisIds.length === 0) return []

    return db.select().from(jobAnalyses).where(inArray(jobAnalyses.id, analysisIds))
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
          inputFingerprint: record.inputFingerprint,
          sourceAnalysisId: null,
          status: 'pending',
          currentAttempt: 1,
          modelName: null,
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

  async queueRetryRun(record: QueueRetryRunRecord) {
    return db.transaction(async (tx) => {
      const [analysis] = await tx
        .update(jobAnalyses)
        .set({ currentAttempt: record.currentAttempt, updatedAt: record.queuedAt })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
        .returning()

      if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 processing 状态')

      await tx
        .update(jobAnalyses)
        .set({ currentAttempt: record.currentAttempt, updatedAt: record.queuedAt })
        .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))

      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      return { analysis, run }
    })
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
          modelName: record.modelName,
          result: record.result,
          updatedAt: record.finishedAt,
          completedAt: record.finishedAt,
        })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
        .returning()

      if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 processing 状态')

      await tx
        .update(jobAnalyses)
        .set({
          resumeVersionId: record.resumeVersionId,
          status: 'completed',
          currentAttempt: analysis.currentAttempt,
          modelName: record.modelName,
          result: record.result,
          updatedAt: record.finishedAt,
          completedAt: record.finishedAt,
        })
        .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))

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

      await tx
        .update(jobAnalyses)
        .set({ status: 'processing', updatedAt: record.startedAt })
        .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))
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
    return db.transaction(async (tx) => {
      const [analysis] = await tx
        .update(jobAnalyses)
        .set({ status: 'failed', updatedAt: record.failedAt })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
        .returning()

      if (!analysis) throw new Error('JobAnalysis 不存在或已不处于 processing 状态')

      await tx
        .update(jobAnalyses)
        .set({ status: 'failed', currentAttempt: analysis.currentAttempt, updatedAt: record.failedAt })
        .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))

      return analysis
    })
  }

  async markAnalysisFailedIfActive(record: MarkAnalysisFailedRecord) {
    return db.transaction(async (tx) => {
      const [analysis] = await tx
        .update(jobAnalyses)
        .set({ status: 'failed', updatedAt: record.failedAt })
        .where(and(eq(jobAnalyses.id, record.analysisId), inArray(jobAnalyses.status, ['pending', 'processing'])))
        .returning()

      if (!analysis) return null

      await tx
        .update(jobAnalyses)
        .set({ status: 'failed', currentAttempt: analysis.currentAttempt, updatedAt: record.failedAt })
        .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))

      return analysis
    })
  }

  async failStuckRunAndAnalysis(record: FailStuckRunAndAnalysisRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'failed',
          error: record.error,
          durationMs: record.durationMs,
          finishedAt: record.failedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.analysisId, record.analysisId),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) return null

      const [analysis] = await tx
        .update(jobAnalyses)
        .set({
          status: 'failed',
          updatedAt: record.failedAt,
        })
        .where(and(eq(jobAnalyses.id, record.analysisId), eq(jobAnalyses.status, 'processing')))
        .returning()

      if (analysis) {
        await tx
          .update(jobAnalyses)
          .set({ status: 'failed', currentAttempt: analysis.currentAttempt, updatedAt: record.failedAt })
          .where(eq(jobAnalyses.sourceAnalysisId, record.analysisId))
      }

      return analysis ? { analysis, run } : null
    })
  }
}

export const jobAnalysisRepository = new DrizzleJobAnalysisRepository()
