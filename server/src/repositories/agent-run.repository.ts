import { and, desc, eq, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  actionStrategySnapshots,
  agentRuns,
  chatConversations,
  chatRuns,
  interviewSessions,
  interviewTurns,
  jobAnalyses,
  jobOpportunities,
  reviewDocuments,
  resumePdfImportTasks,
} from '../db/schema'
import type { AgentWorkflowType } from '@/shared/interview/schemas'
import { measureDb } from '../utils/request-metrics'

export type AgentRunDebugListFilters = {
  userId: string
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

export type CompleteResumePdfImportRunRecord = {
  runId: string
  rawOutput: string
  parsedOutput: AgentRunRow['parsedOutput']
  tokenUsage: AgentRunRow['tokenUsage']
  durationMs: number
  finishedAt: string
}

export type FailResumePdfImportRunRecord = {
  runId: string
  error: NonNullable<AgentRunRow['error']>
  rawOutput: string | null
  tokenUsage: AgentRunRow['tokenUsage']
  durationMs: number
  finishedAt: string
}

export type StartChatModelCallRunRecord = typeof agentRuns.$inferInsert

export type CompleteChatModelCallRunRecord = {
  operationKey: string
  rawOutput: string
  parsedOutput: Record<string, unknown>
  tokenUsage: AgentRunRow['tokenUsage']
  durationMs: number
  finishedAt: string
}

export type FailChatModelCallRunRecord = {
  operationKey: string
  error: NonNullable<AgentRunRow['error']>
  durationMs: number
  finishedAt: string
  cancelled: boolean
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
      resumePdfImportTaskId: resumePdfImportTasks.id,
      resumePdfFileName: resumePdfImportTasks.fileName,
      resumePdfImportStatus: resumePdfImportTasks.status,
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
          chatRunId: agentRuns.chatRunId,
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
      .leftJoin(resumePdfImportTasks, eq(agentRuns.resumePdfImportTaskId, resumePdfImportTasks.id))
      .leftJoin(actionStrategySnapshots, eq(agentRuns.actionStrategySnapshotId, actionStrategySnapshots.id))
      .leftJoin(chatRuns, eq(agentRuns.chatRunId, chatRuns.id))
      .leftJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
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
      .leftJoin(resumePdfImportTasks, eq(agentRuns.resumePdfImportTaskId, resumePdfImportTasks.id))
      .leftJoin(actionStrategySnapshots, eq(agentRuns.actionStrategySnapshotId, actionStrategySnapshots.id))
      .leftJoin(chatRuns, eq(agentRuns.chatRunId, chatRuns.id))
      .leftJoin(chatConversations, eq(chatRuns.conversationId, chatConversations.id))
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
      const workflowFilter = filters.workflowType
        ? eq(agentRuns.workflowType, filters.workflowType)
        : ne(agentRuns.workflowType, 'chat_turn')
      const ownerFilter = or(
        eq(jobOpportunities.userId, filters.userId),
        eq(resumePdfImportTasks.userId, filters.userId),
        eq(actionStrategySnapshots.userId, filters.userId),
        eq(chatConversations.userId, filters.userId),
      )!

      return query
        .where(and(workflowFilter, ownerFilter))
        .orderBy(desc(agentRuns.startedAt), desc(agentRuns.attemptNumber))
        .limit(filters.limit)
    })
  }

  async findDebugById(runId: string, userId: string) {
    const ownerFilter = or(
      eq(jobOpportunities.userId, userId),
      eq(resumePdfImportTasks.userId, userId),
      eq(actionStrategySnapshots.userId, userId),
      eq(chatConversations.userId, userId),
    )!
    const [entry] = await measureDb(() =>
      this.debugDetailQuery()
        .where(and(eq(agentRuns.id, runId), ownerFilter))
        .limit(1),
    )

    if (!entry) return null
    return entry
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

  async startChatModelCall(run: StartChatModelCallRunRecord) {
    if (!run.chatRunId || run.workflowType !== 'chat_turn') {
      throw new TypeError('聊天模型 AgentRun 必须绑定 chatRunId，并使用 chat_turn workflowType')
    }

    const [created] = await db
      .insert(agentRuns)
      .values(run)
      .onConflictDoNothing({ target: [agentRuns.operationKey, agentRuns.attemptNumber] })
      .returning()
    if (created) return created

    const [existing] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.operationKey, run.operationKey), eq(agentRuns.attemptNumber, run.attemptNumber)))
      .limit(1)
    return existing ?? null
  }

  async completeChatModelCall(record: CompleteChatModelCallRunRecord) {
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
          eq(agentRuns.operationKey, record.operationKey),
          eq(agentRuns.attemptNumber, 1),
          eq(agentRuns.workflowType, 'chat_turn'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    return run ?? null
  }

  async failChatModelCall(record: FailChatModelCallRunRecord) {
    const [run] = await db
      .update(agentRuns)
      .set({
        status: record.cancelled ? 'cancelled' : 'failed',
        error: record.error,
        durationMs: record.durationMs,
        finishedAt: record.finishedAt,
      })
      .where(
        and(
          eq(agentRuns.operationKey, record.operationKey),
          eq(agentRuns.attemptNumber, 1),
          eq(agentRuns.workflowType, 'chat_turn'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    return run ?? null
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

  async createResumePdfImportRun(run: typeof agentRuns.$inferInsert) {
    if (!run.resumePdfImportTaskId || run.workflowType !== 'resume_pdf_import') {
      throw new TypeError('PDF 简历识别 AgentRun 必须绑定 resumePdfImportTaskId，并使用 resume_pdf_import workflowType')
    }

    const [created] = await db
      .insert(agentRuns)
      .values(run)
      .onConflictDoNothing({ target: [agentRuns.operationKey, agentRuns.attemptNumber] })
      .returning()
    if (created) return created

    const [existing] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.operationKey, run.operationKey), eq(agentRuns.attemptNumber, run.attemptNumber)))
      .limit(1)
    return existing ?? null
  }

  async markResumePdfImportRunProcessing(runId: string, startedAt: string) {
    const [run] = await db
      .update(agentRuns)
      .set({ status: 'processing', startedAt })
      .where(
        and(eq(agentRuns.id, runId), eq(agentRuns.workflowType, 'resume_pdf_import'), eq(agentRuns.status, 'pending')),
      )
      .returning()

    if (!run) throw new Error('PDF 简历识别 AgentRun 不存在或已不处于 pending 状态')
    return run
  }

  async completeResumePdfImportRun(record: CompleteResumePdfImportRunRecord) {
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
          eq(agentRuns.workflowType, 'resume_pdf_import'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new Error('PDF 简历识别 AgentRun 不存在或已不处于 processing 状态')
    return run
  }

  async failResumePdfImportRun(record: FailResumePdfImportRunRecord) {
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
          eq(agentRuns.workflowType, 'resume_pdf_import'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new Error('PDF 简历识别 AgentRun 不存在或已不处于 processing 状态')
    return run
  }
}

export const agentRunRepository = new DrizzleAgentRunRepository()
