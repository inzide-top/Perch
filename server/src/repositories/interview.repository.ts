import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  agentRuns,
  answerDeepEvaluations,
  interviewQuestionFeedback,
  interviewSessionEvaluations,
  interviewSessions,
  interviewTurnInteractions,
  interviewTurns,
  jobOpportunities,
  resumeVersions,
} from '../db/schema'
import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'
import type {
  AnswerDeepEvaluationResult,
  AnswerEvidence,
  InterviewAnswerContent,
  InterviewPlanModelOutput,
  InterviewSessionEvaluation,
  InterviewTurnModelOutput,
} from '@/shared/interview/schemas'
import type { InterviewSkipModelOutput } from '../schemas/interview-skip.schema'
import type { AnswerDeepEvaluationModelOutput } from '../schemas/interview-deep-evaluation.schema'
import { measureDb } from '../utils/request-metrics'

export type CreateInterviewSessionRecord = {
  session: typeof interviewSessions.$inferInsert
  evaluation: typeof interviewSessionEvaluations.$inferInsert
}

export type MarkInterviewPlanRunProcessingRecord = {
  sessionId: string
  runId: string
  startedAt: string
}

export type MarkInterviewPlanFailedRecord = {
  sessionId: string
  expectedStateVersion: number
  failedAt: string
}

export type FailInterviewPlanRunRecord = {
  sessionId: string
  runId: string
  error: AgentRunError
  rawOutput: string | null
  tokenUsage: AgentTokenUsage | null
  durationMs: number | null
  finishedAt: string
}

export type CompleteInterviewPlanRunRecord = {
  sessionId: string
  runId: string
  expectedStateVersion: number
  assessmentPlan: NonNullable<typeof interviewSessions.$inferInsert.assessmentPlan>
  modelOutput: InterviewPlanModelOutput
  firstTurn: typeof interviewTurns.$inferInsert
  evaluation: typeof interviewSessionEvaluations.$inferInsert.result
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type EndInterviewSessionRecord = {
  sessionId: string
  expectedStateVersion: number
  status: 'completed' | 'ended_early'
  evidenceStatus: typeof interviewSessions.$inferInsert.evidenceStatus
  endReason: string
  endedAt: string
}

export type StartInterviewTurnRunRecord = {
  sessionId: string
  turnId: string
  expectedStateVersion: number
  answerSubmissionKey: string
  answer: InterviewAnswerContent
  hintUsage: typeof interviewTurns.$inferInsert.hintUsage
  now: string
  run: typeof agentRuns.$inferInsert
}

export type RestartFailedInterviewTurnRecord = {
  sessionId: string
  turnId: string
  expectedStateVersion: number
  answer: InterviewAnswerContent
  now: string
  run: typeof agentRuns.$inferInsert
}

export type CancelInterviewTurnRunRecord = {
  sessionId: string
  turnId: string
  cancelledAt: string
}

export type CreateInterviewTurnRetryRunRecord = {
  sessionId: string
  turnId: string
  run: typeof agentRuns.$inferInsert
}

export type FailInterviewTurnRunRecord = {
  sessionId: string
  turnId: string
  runId: string
  error: AgentRunError
  rawOutput: string | null
  tokenUsage: AgentTokenUsage | null
  durationMs: number | null
  finishedAt: string
  finalFailure: boolean
}

export type CompleteInterviewTurnWithNextQuestionRecord = {
  sessionId: string
  turnId: string
  runId: string
  expectedStateVersion: number
  answer: InterviewAnswerContent
  answerEvidence: AnswerEvidence
  modelOutput: InterviewTurnModelOutput
  nextTurn: typeof interviewTurns.$inferInsert
  evaluation: InterviewSessionEvaluation
  latestOverallScore: number | null
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type CompleteInterviewTurnWithInteractionRecord = {
  sessionId: string
  turnId: string
  runId: string
  expectedStateVersion: number
  modelOutput: InterviewTurnModelOutput
  candidateInteraction: typeof interviewTurnInteractions.$inferInsert
  interviewerInteraction: typeof interviewTurnInteractions.$inferInsert
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type CompleteInterviewSessionFromTurnRecord = {
  sessionId: string
  turnId: string
  runId: string
  expectedStateVersion: number
  answer: InterviewAnswerContent
  answerEvidence: AnswerEvidence
  modelOutput: InterviewTurnModelOutput
  evaluation: InterviewSessionEvaluation
  evidenceStatus: typeof interviewSessions.$inferInsert.evidenceStatus
  latestOverallScore: number | null
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type StartInterviewSkipRunRecord = {
  sessionId: string
  turnId: string
  expectedStateVersion: number
  skip: NonNullable<typeof interviewTurns.$inferInsert.skip>
  now: string
  run: typeof agentRuns.$inferInsert
}

export type RestartFailedInterviewSkipRecord = {
  sessionId: string
  turnId: string
  expectedStateVersion: number
  now: string
  run: typeof agentRuns.$inferInsert
}

export type CompleteInterviewSkipWithNextQuestionRecord = {
  sessionId: string
  turnId: string
  runId: string
  expectedStateVersion: number
  modelOutput: InterviewSkipModelOutput
  nextTurn: typeof interviewTurns.$inferInsert
  evaluation: InterviewSessionEvaluation | null
  latestOverallScore: number | null
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type CompleteInterviewSessionFromSkipRecord = {
  sessionId: string
  turnId: string
  runId: string
  expectedStateVersion: number
  modelOutput: InterviewSkipModelOutput
  evaluation: InterviewSessionEvaluation
  evidenceStatus: typeof interviewSessions.$inferInsert.evidenceStatus
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export type StartAnswerDeepEvaluationRecord = {
  sessionId: string
  turnId: string
  evaluation: typeof answerDeepEvaluations.$inferInsert
  run: typeof agentRuns.$inferInsert
}

export type RestartAnswerDeepEvaluationRecord = {
  sessionId: string
  turnId: string
  evaluationId: string
  run: typeof agentRuns.$inferInsert
  startedAt: string
}

export type CreateAnswerDeepEvaluationRetryRunRecord = {
  sessionId: string
  turnId: string
  run: typeof agentRuns.$inferInsert
}

export type FailAnswerDeepEvaluationRunRecord = {
  sessionId: string
  turnId: string
  runId: string
  error: AgentRunError
  rawOutput: string | null
  tokenUsage: AgentTokenUsage | null
  durationMs: number | null
  finishedAt: string
  finalFailure: boolean
}

export type CompleteAnswerDeepEvaluationRunRecord = {
  sessionId: string
  turnId: string
  runId: string
  modelOutput: AnswerDeepEvaluationModelOutput
  result: AnswerDeepEvaluationResult
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  durationMs: number
  finishedAt: string
}

export class InterviewRepositoryConflictError extends Error {
  statusCode = 409
}

export class DrizzleInterviewRepository {
  async createSessionWithInitialEvaluation(record: CreateInterviewSessionRecord) {
    return db.transaction(async (tx) => {
      const [session] = await tx.insert(interviewSessions).values(record.session).returning()
      const [evaluation] = await tx.insert(interviewSessionEvaluations).values(record.evaluation).returning()

      return { session, evaluation }
    })
  }

  async listSessionSummariesByOpportunityId(opportunityId: string) {
    const turnCounts = db
      .select({
        sessionId: interviewTurns.sessionId,
        answeredQuestionCount: count(interviewTurns.answer).as('answered_question_count'),
        validAnswerCount: count(interviewTurns.answerEvidence).as('valid_answer_count'),
      })
      .from(interviewTurns)
      .groupBy(interviewTurns.sessionId)
      .as('interview_turn_counts')

    return db
      .select({
        session: interviewSessions,
        evaluation: interviewSessionEvaluations.result,
        answeredQuestionCount: turnCounts.answeredQuestionCount,
        validAnswerCount: turnCounts.validAnswerCount,
      })
      .from(interviewSessions)
      .leftJoin(turnCounts, eq(interviewSessions.id, turnCounts.sessionId))
      .leftJoin(interviewSessionEvaluations, eq(interviewSessions.id, interviewSessionEvaluations.sessionId))
      .where(eq(interviewSessions.opportunityId, opportunityId))
      .orderBy(desc(interviewSessions.lastActiveAt), desc(interviewSessions.createdAt))
  }

  /**
   * 只读取已经结束且具备有效证据的历史面试评估，供下一轮计划聚合历史薄弱项。
   * preparing/active 或 evidenceStatus=insufficient 的面试不应污染后续计划。
   */
  async findHistoricalSessionEvaluationsByOpportunityId(opportunityId: string) {
    const rows = await db
      .select({
        evaluation: interviewSessionEvaluations.result,
        assessmentPlan: interviewSessions.assessmentPlan,
        endedAt: interviewSessions.endedAt,
        lastActiveAt: interviewSessions.lastActiveAt,
        updatedAt: interviewSessions.updatedAt,
      })
      .from(interviewSessions)
      .innerJoin(interviewSessionEvaluations, eq(interviewSessions.id, interviewSessionEvaluations.sessionId))
      .where(
        and(
          eq(interviewSessions.opportunityId, opportunityId),
          inArray(interviewSessions.status, ['completed', 'ended_early']),
          inArray(interviewSessions.evidenceStatus, ['partial', 'sufficient']),
        ),
      )
      .orderBy(desc(interviewSessions.lastActiveAt))

    return rows.map((row) => ({
      evaluation: row.evaluation,
      assessmentPlan: row.assessmentPlan,
      observedAt: row.endedAt ?? row.lastActiveAt ?? row.updatedAt,
    }))
  }

  async hasSessionsByOpportunityId(opportunityId: string) {
    const [session] = await db
      .select({ id: interviewSessions.id })
      .from(interviewSessions)
      .where(eq(interviewSessions.opportunityId, opportunityId))
      .limit(1)

    return Boolean(session)
  }

  async hasSessionsByResumeId(resumeId: string) {
    const [session] = await db
      .select({ id: interviewSessions.id })
      .from(interviewSessions)
      .innerJoin(resumeVersions, eq(interviewSessions.resumeVersionId, resumeVersions.id))
      .where(eq(resumeVersions.resumeId, resumeId))
      .limit(1)

    return Boolean(session)
  }

  async findSessionById(sessionId: string) {
    const [session] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, sessionId)).limit(1)

    return session ?? null
  }

  /** 面试轮询只读取状态字段和当前 Turn 状态，不读取 assessmentPlan 或会话内容。 */
  async findSessionStatusById(sessionId: string) {
    const [session] = await measureDb(() =>
      db
        .select({
          id: interviewSessions.id,
          opportunityId: interviewSessions.opportunityId,
          opportunityUserId: jobOpportunities.userId,
          currentTurnId: interviewSessions.currentTurnId,
          status: interviewSessions.status,
          stateVersion: interviewSessions.stateVersion,
          updatedAt: interviewSessions.updatedAt,
        })
        .from(interviewSessions)
        .innerJoin(jobOpportunities, eq(interviewSessions.opportunityId, jobOpportunities.id))
        .where(eq(interviewSessions.id, sessionId))
        .limit(1),
    )

    if (!session) return null

    const [currentTurn] = session.currentTurnId
      ? await measureDb(() =>
          db
            .select({ status: interviewTurns.status, skip: interviewTurns.skip })
            .from(interviewTurns)
            .where(eq(interviewTurns.id, session.currentTurnId!))
            .limit(1),
        )
      : []

    return {
      ...session,
      currentTurnStatus: currentTurn?.status ?? null,
      currentTurnSkip: currentTurn?.skip ?? null,
    }
  }

  async findTurnStatusById(turnId: string) {
    const [turn] = await measureDb(() =>
      db
        .select({ id: interviewTurns.id, sessionId: interviewTurns.sessionId })
        .from(interviewTurns)
        .where(eq(interviewTurns.id, turnId))
        .limit(1),
    )

    return turn ?? null
  }

  async listActiveSessionModelUsage(userId: string) {
    return db
      .select({
        sessionId: interviewSessions.id,
        opportunityId: interviewSessions.opportunityId,
        status: interviewSessions.status,
        modelSnapshot: interviewSessions.modelSnapshot,
      })
      .from(interviewSessions)
      .innerJoin(jobOpportunities, eq(interviewSessions.opportunityId, jobOpportunities.id))
      .where(
        and(
          eq(jobOpportunities.userId, userId),
          inArray(interviewSessions.status, ['preparing', 'active', 'finalizing']),
        ),
      )
      .orderBy(desc(interviewSessions.lastActiveAt))
  }

  async updateSessionModelSnapshot(record: {
    sessionId: string
    expectedStateVersion: number
    modelSnapshot: typeof interviewSessions.$inferInsert.modelSnapshot
    updatedAt: string
  }) {
    const [session] = await db
      .update(interviewSessions)
      .set({
        modelSnapshot: record.modelSnapshot,
        updatedAt: record.updatedAt,
        lastActiveAt: record.updatedAt,
        stateVersion: record.expectedStateVersion + 1,
      })
      .where(
        and(
          eq(interviewSessions.id, record.sessionId),
          eq(interviewSessions.status, 'active'),
          eq(interviewSessions.stateVersion, record.expectedStateVersion),
        ),
      )
      .returning()

    if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能切换模型')
    return session
  }

  async findTurnById(turnId: string) {
    const [turn] = await db.select().from(interviewTurns).where(eq(interviewTurns.id, turnId)).limit(1)

    return turn ?? null
  }

  async findTurnByAnswerSubmissionKey(answerSubmissionKey: string) {
    const [turn] = await db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.answerSubmissionKey, answerSubmissionKey))
      .limit(1)

    return turn ?? null
  }

  async findInteractionByClientMessageId(clientMessageId: string) {
    const [interaction] = await db
      .select()
      .from(interviewTurnInteractions)
      .where(eq(interviewTurnInteractions.clientMessageId, clientMessageId))
      .limit(1)

    return interaction ?? null
  }

  async findAgentRunsByOperationKey(operationKey: string) {
    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.operationKey, operationKey))
      .orderBy(desc(agentRuns.attemptNumber))
  }

  async findInterviewTurnRunsByTurnIds(turnIds: string[]) {
    if (!turnIds.length) return []

    return db
      .select({
        interviewTurnId: agentRuns.interviewTurnId,
        attemptNumber: agentRuns.attemptNumber,
        input: agentRuns.input,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.workflowType, 'interview_turn'), inArray(agentRuns.interviewTurnId, turnIds)))
      .orderBy(desc(agentRuns.attemptNumber))
  }

  async findLatestFailedInterviewWorkflowRun(sessionId: string) {
    const [run] = await measureDb(() =>
      db
        .select({ error: agentRuns.error })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.interviewSessionId, sessionId),
            eq(agentRuns.status, 'failed'),
            inArray(agentRuns.workflowType, ['interview_plan', 'interview_turn']),
          ),
        )
        .orderBy(desc(agentRuns.startedAt), desc(agentRuns.attemptNumber))
        .limit(1),
    )

    return run ?? null
  }

  /** 初次执行与结构化修复重试共用同一个写入入口，attemptNumber 由 Service 递增。 */
  async createInterviewPlanRun(run: typeof agentRuns.$inferInsert) {
    if (!run.interviewSessionId || run.workflowType !== 'interview_plan') {
      throw new TypeError('面试计划 AgentRun 必须绑定 interviewSessionId，并使用 interview_plan workflowType')
    }
    const sessionId = run.interviewSessionId

    return db.transaction(async (tx) => {
      const [session] = await tx
        .select({ id: interviewSessions.id })
        .from(interviewSessions)
        .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.status, 'preparing')))
        .limit(1)

      if (!session) throw new InterviewRepositoryConflictError('模拟面试已不处于计划生成阶段')

      const [createdRun] = await tx.insert(agentRuns).values(run).returning()
      return createdRun
    })
  }

  async findInterviewPlanRunsBySessionId(sessionId: string) {
    return db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.interviewSessionId, sessionId), eq(agentRuns.workflowType, 'interview_plan')))
      .orderBy(desc(agentRuns.attemptNumber))
  }

  async markInterviewPlanRunProcessing(record: MarkInterviewPlanRunProcessingRecord) {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .select({ id: interviewSessions.id })
        .from(interviewSessions)
        .where(and(eq(interviewSessions.id, record.sessionId), eq(interviewSessions.status, 'preparing')))
        .limit(1)

      if (!session) throw new InterviewRepositoryConflictError('模拟面试已不处于计划生成阶段')

      const [run] = await tx
        .update(agentRuns)
        .set({ status: 'processing', startedAt: record.startedAt })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.workflowType, 'interview_plan'),
            eq(agentRuns.status, 'pending'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('面试计划 AgentRun 不存在或已不处于 pending 状态')
      return run
    })
  }

  async markInterviewPlanFailed(record: MarkInterviewPlanFailedRecord) {
    const [session] = await db
      .update(interviewSessions)
      .set({
        status: 'preparation_failed',
        lastActiveAt: record.failedAt,
        updatedAt: record.failedAt,
        stateVersion: record.expectedStateVersion + 1,
      })
      .where(
        and(
          eq(interviewSessions.id, record.sessionId),
          eq(interviewSessions.status, 'preparing'),
          eq(interviewSessions.stateVersion, record.expectedStateVersion),
        ),
      )
      .returning()

    if (!session) throw new InterviewRepositoryConflictError('模拟面试状态已变化，不能标记为准备失败')

    return session
  }

  async failInterviewPlanRun(record: FailInterviewPlanRunRecord) {
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
          eq(agentRuns.interviewSessionId, record.sessionId),
          eq(agentRuns.workflowType, 'interview_plan'),
          eq(agentRuns.status, 'processing'),
        ),
      )
      .returning()

    if (!run) throw new InterviewRepositoryConflictError('面试计划 AgentRun 不存在或已不处于 processing 状态')
    return run
  }

  async startInterviewTurnRun(record: StartInterviewTurnRunRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .update(interviewTurns)
        .set({
          status: 'processing',
          answer: record.answer,
          answerSubmissionKey: record.answerSubmissionKey,
          hintUsage: record.hintUsage,
          updatedAt: record.now,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'awaiting_answer'),
          ),
        )
        .returning()

      if (!turn) throw new InterviewRepositoryConflictError('当前问题已不处于待回答状态')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.now,
          updatedAt: record.now,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能提交当前回答')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()
      return { session, turn, run }
    })
  }

  async startInterviewSkipRun(record: StartInterviewSkipRunRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .update(interviewTurns)
        .set({
          status: 'processing',
          skip: record.skip,
          answer: null,
          answerSubmissionKey: null,
          updatedAt: record.now,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'awaiting_answer'),
          ),
        )
        .returning()

      if (!turn) throw new InterviewRepositoryConflictError('当前问题已不处于待回答状态')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.now,
          updatedAt: record.now,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能跳过当前问题')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()
      return { session, turn, run }
    })
  }

  async createInterviewTurnRetryRun(record: CreateInterviewTurnRetryRunRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .select({ id: interviewTurns.id })
        .from(interviewTurns)
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
          ),
        )
        .limit(1)

      if (!turn) throw new InterviewRepositoryConflictError('当前问题已不处于回答处理阶段')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()
      return run
    })
  }

  async failInterviewTurnRun(record: FailInterviewTurnRunRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
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
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('回答处理 AgentRun 不存在或已不处于 processing 状态')

      if (record.finalFailure) {
        const [turn] = await tx
          .update(interviewTurns)
          .set({
            status: 'processing_failed',
            updatedAt: record.finishedAt,
          })
          .where(
            and(
              eq(interviewTurns.id, record.turnId),
              eq(interviewTurns.sessionId, record.sessionId),
              eq(interviewTurns.status, 'processing'),
            ),
          )
          .returning({ id: interviewTurns.id })

        if (!turn) throw new InterviewRepositoryConflictError('当前问题已不处于回答处理阶段')

        await tx
          .update(interviewSessions)
          .set({
            lastActiveAt: record.finishedAt,
            updatedAt: record.finishedAt,
            stateVersion: sql`${interviewSessions.stateVersion} + 1`,
          })
          .where(and(eq(interviewSessions.id, record.sessionId), eq(interviewSessions.currentTurnId, record.turnId)))
      }

      return run
    })
  }

  async restartFailedInterviewTurn(record: RestartFailedInterviewTurnRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .update(interviewTurns)
        .set({ status: 'processing', answer: record.answer, updatedAt: record.now })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing_failed'),
          ),
        )
        .returning()

      if (!turn?.answerSubmissionKey) {
        throw new InterviewRepositoryConflictError('失败的回答不存在，无法重新分析')
      }

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.now,
          updatedAt: record.now,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能重新分析当前回答')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()
      return { session, turn, run }
    })
  }

  async restartFailedInterviewSkip(record: RestartFailedInterviewSkipRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .update(interviewTurns)
        .set({ status: 'processing', updatedAt: record.now })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing_failed'),
            sql`${interviewTurns.skip} IS NOT NULL`,
          ),
        )
        .returning()

      if (!turn) throw new InterviewRepositoryConflictError('失败的跳过任务不存在，无法重新生成下一题')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.now,
          updatedAt: record.now,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能重试跳过任务')

      const [run] = await tx.insert(agentRuns).values(record.run).returning()
      return { session, turn, run }
    })
  }

  async cancelInterviewTurnRun(record: CancelInterviewTurnRunRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .update(interviewTurns)
        .set({
          status: 'awaiting_answer',
          answer: null,
          answerSubmissionKey: null,
          updatedAt: record.cancelledAt,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            inArray(interviewTurns.status, ['awaiting_answer', 'processing']),
          ),
        )
        .returning()

      if (!turn) throw new InterviewRepositoryConflictError('当前回答已不处于可中止状态')

      const [activeRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            inArray(agentRuns.status, ['pending', 'processing']),
          ),
        )
        .orderBy(desc(agentRuns.attemptNumber))
        .limit(1)

      if (activeRun) {
        await tx
          .update(agentRuns)
          .set({
            status: 'cancelled',
            error: {
              code: 'cancelled',
              message: '用户主动中止回答处理',
              retryable: false,
            },
            finishedAt: record.cancelledAt,
          })
          .where(and(eq(agentRuns.id, activeRun.id), inArray(agentRuns.status, ['pending', 'processing'])))
      }

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.cancelledAt,
          updatedAt: record.cancelledAt,
          stateVersion: sql`${interviewSessions.stateVersion} + 1`,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能中止当前回答')
      return { session, turn }
    })
  }

  async findSessionDetail(sessionId: string) {
    const session = await this.findSessionById(sessionId)
    if (!session) return null

    const turns = await db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.sessionId, sessionId))
      .orderBy(asc(interviewTurns.sequenceNumber))
    const turnIds = turns.map((turn) => turn.id)

    const [interactions, evaluations, deepEvaluations, feedback] = await Promise.all([
      turnIds.length
        ? db
            .select()
            .from(interviewTurnInteractions)
            .where(inArray(interviewTurnInteractions.turnId, turnIds))
            .orderBy(asc(interviewTurnInteractions.sequenceNumber))
        : [],
      db
        .select()
        .from(interviewSessionEvaluations)
        .where(eq(interviewSessionEvaluations.sessionId, sessionId))
        .limit(1),
      turnIds.length
        ? db.select().from(answerDeepEvaluations).where(inArray(answerDeepEvaluations.turnId, turnIds))
        : [],
      turnIds.length
        ? db.select().from(interviewQuestionFeedback).where(inArray(interviewQuestionFeedback.turnId, turnIds))
        : [],
    ])

    return {
      session,
      turns,
      interactions,
      evaluation: evaluations[0] ?? null,
      deepEvaluations,
      feedback,
    }
  }

  /** 模型结果、首题和 Session 状态必须一起成功或一起回滚。 */
  async completeInterviewPlanRun(record: CompleteInterviewPlanRunRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.workflowType, 'interview_plan'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('面试计划 AgentRun 不存在或已不处于 processing 状态')

      const [turn] = await tx.insert(interviewTurns).values(record.firstTurn).returning()
      const [session] = await tx
        .update(interviewSessions)
        .set({
          assessmentPlan: record.assessmentPlan,
          currentTurnId: record.firstTurn.id,
          status: 'active',
          startedAt: record.finishedAt,
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'preparing'),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('模拟面试状态已变化，不能重复创建首题')

      const [evaluation] = await tx
        .update(interviewSessionEvaluations)
        .set({
          result: record.evaluation,
          revision: sql`${interviewSessionEvaluations.revision} + 1`,
          updatedAt: record.finishedAt,
        })
        .where(eq(interviewSessionEvaluations.sessionId, record.sessionId))
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('模拟面试总体评估记录不存在')
      return { session, turn, evaluation, run }
    })
  }

  async completeInterviewTurnWithNextQuestion(record: CompleteInterviewTurnWithNextQuestionRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('回答处理 AgentRun 不存在或已不处于 processing 状态')

      const [completedTurn] = await tx
        .update(interviewTurns)
        .set({
          answer: record.answer,
          answerEvidence: record.answerEvidence,
          status: 'completed',
          completedAt: record.finishedAt,
          updatedAt: record.finishedAt,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
          ),
        )
        .returning()

      if (!completedTurn) throw new InterviewRepositoryConflictError('当前问题已不处于回答处理阶段')

      const [nextTurn] = await tx.insert(interviewTurns).values(record.nextTurn).returning()

      const [session] = await tx
        .update(interviewSessions)
        .set({
          currentTurnId: record.nextTurn.id,
          latestOverallScore: record.latestOverallScore,
          overallScoreStatus: record.evaluation.status,
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能写入下一题')

      const [evaluation] = await tx
        .update(interviewSessionEvaluations)
        .set({
          result: record.evaluation,
          evaluatedThroughTurnId: record.turnId,
          revision: sql`${interviewSessionEvaluations.revision} + 1`,
          updatedAt: record.finishedAt,
        })
        .where(eq(interviewSessionEvaluations.sessionId, record.sessionId))
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('模拟面试总体评估记录不存在')

      return { session, completedTurn, nextTurn, evaluation, run }
    })
  }

  async completeInterviewSkipWithNextQuestion(record: CompleteInterviewSkipWithNextQuestionRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('跳过问题 AgentRun 不存在或已不处于 processing 状态')

      const [skippedTurn] = await tx
        .update(interviewTurns)
        .set({ status: 'skipped', completedAt: record.finishedAt, updatedAt: record.finishedAt })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
            sql`${interviewTurns.skip} IS NOT NULL`,
          ),
        )
        .returning()

      if (!skippedTurn) throw new InterviewRepositoryConflictError('当前问题已不处于跳过处理阶段')

      const [nextTurn] = await tx.insert(interviewTurns).values(record.nextTurn).returning()
      const [session] = await tx
        .update(interviewSessions)
        .set({
          currentTurnId: record.nextTurn.id,
          ...(record.evaluation
            ? {
                latestOverallScore: record.latestOverallScore,
                overallScoreStatus: record.evaluation.status,
              }
            : {}),
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能写入跳过后的下一题')

      if (record.evaluation) {
        const [evaluation] = await tx
          .update(interviewSessionEvaluations)
          .set({
            result: record.evaluation,
            evaluatedThroughTurnId: record.turnId,
            revision: sql`${interviewSessionEvaluations.revision} + 1`,
            updatedAt: record.finishedAt,
          })
          .where(eq(interviewSessionEvaluations.sessionId, record.sessionId))
          .returning()

        if (!evaluation) throw new InterviewRepositoryConflictError('模拟面试总体评估记录不存在')
      }
      return { session, skippedTurn, nextTurn, run }
    })
  }

  async completeInterviewSessionFromSkip(record: CompleteInterviewSessionFromSkipRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('跳过问题 AgentRun 不存在或已不处于 processing 状态')

      const [skippedTurn] = await tx
        .update(interviewTurns)
        .set({ status: 'skipped', completedAt: record.finishedAt, updatedAt: record.finishedAt })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
            sql`${interviewTurns.skip} IS NOT NULL`,
          ),
        )
        .returning()

      if (!skippedTurn) throw new InterviewRepositoryConflictError('当前问题已不处于跳过处理阶段')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          currentTurnId: null,
          status: 'completed',
          evidenceStatus: record.evidenceStatus,
          latestOverallScore: record.evaluation.score,
          overallScoreStatus: record.evaluation.status,
          endedAt: record.finishedAt,
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能结束本轮面试')

      const [evaluation] = await tx
        .update(interviewSessionEvaluations)
        .set({
          result: record.evaluation,
          revision: sql`${interviewSessionEvaluations.revision} + 1`,
          updatedAt: record.finishedAt,
          finalizedAt: record.finishedAt,
        })
        .where(eq(interviewSessionEvaluations.sessionId, record.sessionId))
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('模拟面试总体评估记录不存在')
      return { session, skippedTurn, evaluation, run }
    })
  }

  async completeInterviewTurnWithInteraction(record: CompleteInterviewTurnWithInteractionRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('回答处理 AgentRun 不存在或已不处于 processing 状态')

      const [candidateInteraction] = await tx
        .insert(interviewTurnInteractions)
        .values(record.candidateInteraction)
        .returning()
      const [interviewerInteraction] = await tx
        .insert(interviewTurnInteractions)
        .values(record.interviewerInteraction)
        .returning()

      const [turn] = await tx
        .update(interviewTurns)
        .set({
          status: 'awaiting_answer',
          answer: null,
          answerSubmissionKey: null,
          updatedAt: record.finishedAt,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
          ),
        )
        .returning()

      if (!turn) throw new InterviewRepositoryConflictError('当前问题已不处于回答处理阶段')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能写入澄清交互')

      return { session, turn, candidateInteraction, interviewerInteraction, run }
    })
  }

  async completeInterviewSessionFromTurn(record: CompleteInterviewSessionFromTurnRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_turn'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('回答处理 AgentRun 不存在或已不处于 processing 状态')

      const [completedTurn] = await tx
        .update(interviewTurns)
        .set({
          answer: record.answer,
          answerEvidence: record.answerEvidence,
          status: 'completed',
          completedAt: record.finishedAt,
          updatedAt: record.finishedAt,
        })
        .where(
          and(
            eq(interviewTurns.id, record.turnId),
            eq(interviewTurns.sessionId, record.sessionId),
            eq(interviewTurns.status, 'processing'),
          ),
        )
        .returning()

      if (!completedTurn) throw new InterviewRepositoryConflictError('当前问题已不处于回答处理阶段')

      const [session] = await tx
        .update(interviewSessions)
        .set({
          currentTurnId: null,
          status: 'completed',
          evidenceStatus: record.evidenceStatus,
          latestOverallScore: record.latestOverallScore,
          overallScoreStatus: record.evaluation.status,
          endedAt: record.finishedAt,
          lastActiveAt: record.finishedAt,
          updatedAt: record.finishedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            eq(interviewSessions.status, 'active'),
            eq(interviewSessions.currentTurnId, record.turnId),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) throw new InterviewRepositoryConflictError('面试状态已变化，不能结束本轮面试')

      const [evaluation] = await tx
        .update(interviewSessionEvaluations)
        .set({
          result: record.evaluation,
          evaluatedThroughTurnId: record.turnId,
          revision: sql`${interviewSessionEvaluations.revision} + 1`,
          updatedAt: record.finishedAt,
          finalizedAt: record.finishedAt,
        })
        .where(eq(interviewSessionEvaluations.sessionId, record.sessionId))
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('模拟面试总体评估记录不存在')

      return { session, completedTurn, evaluation, run }
    })
  }

  async endSession(record: EndInterviewSessionRecord) {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .update(interviewSessions)
        .set({
          status: record.status,
          evidenceStatus: record.evidenceStatus,
          endReason: record.endReason,
          currentTurnId: null,
          endedAt: record.endedAt,
          lastActiveAt: record.endedAt,
          updatedAt: record.endedAt,
          stateVersion: record.expectedStateVersion + 1,
        })
        .where(
          and(
            eq(interviewSessions.id, record.sessionId),
            inArray(interviewSessions.status, ['preparing', 'active', 'finalizing']),
            eq(interviewSessions.stateVersion, record.expectedStateVersion),
          ),
        )
        .returning()

      if (!session) return null

      await tx
        .update(interviewTurns)
        .set({ status: 'abandoned', completedAt: record.endedAt, updatedAt: record.endedAt })
        .where(
          and(
            eq(interviewTurns.sessionId, record.sessionId),
            inArray(interviewTurns.status, ['awaiting_answer', 'processing', 'processing_failed']),
          ),
        )

      await tx
        .update(agentRuns)
        .set({
          status: 'cancelled',
          error: {
            code: 'cancelled',
            message: '用户结束模拟面试，相关模型任务已终止',
            retryable: false,
          },
          finishedAt: record.endedAt,
        })
        .where(
          and(eq(agentRuns.interviewSessionId, record.sessionId), inArray(agentRuns.status, ['pending', 'processing'])),
        )

      return session
    })
  }

  async findQuestionFeedbackByTurnId(turnId: string) {
    const [feedback] = await db
      .select()
      .from(interviewQuestionFeedback)
      .where(eq(interviewQuestionFeedback.turnId, turnId))
      .limit(1)

    return feedback ?? null
  }

  async findAnswerDeepEvaluationByTurnId(turnId: string) {
    const [evaluation] = await db
      .select()
      .from(answerDeepEvaluations)
      .where(eq(answerDeepEvaluations.turnId, turnId))
      .limit(1)

    return evaluation ?? null
  }

  /** 后台轮询只读取任务状态；result 仅在详情接口或终态补取时读取。 */
  async findAnswerDeepEvaluationStatusByTurnId(turnId: string) {
    const [evaluation] = await measureDb(() =>
      db
        .select({
          id: answerDeepEvaluations.id,
          turnId: answerDeepEvaluations.turnId,
          status: answerDeepEvaluations.status,
          error: answerDeepEvaluations.error,
          updatedAt: answerDeepEvaluations.updatedAt,
          completedAt: answerDeepEvaluations.completedAt,
        })
        .from(answerDeepEvaluations)
        .where(eq(answerDeepEvaluations.turnId, turnId))
        .limit(1),
    )

    return evaluation ?? null
  }

  async startAnswerDeepEvaluation(record: StartAnswerDeepEvaluationRecord) {
    return db.transaction(async (tx) => {
      const [turn] = await tx
        .select({
          id: interviewTurns.id,
          answer: interviewTurns.answer,
          answerEvidence: interviewTurns.answerEvidence,
        })
        .from(interviewTurns)
        .where(and(eq(interviewTurns.id, record.turnId), eq(interviewTurns.sessionId, record.sessionId)))
        .limit(1)

      if (!turn?.answer || !turn.answerEvidence) {
        throw new InterviewRepositoryConflictError('当前回答尚未形成可点评的能力证据')
      }

      // answer_deep_evaluations.agent_run_id 是立即校验的外键，
      // 必须先创建被引用的 AgentRun，再创建点评任务。
      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      const [evaluation] = await tx
        .insert(answerDeepEvaluations)
        .values(record.evaluation)
        .onConflictDoNothing({ target: answerDeepEvaluations.turnId })
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('当前回答的深度点评任务已存在')
      return { evaluation, run }
    })
  }

  async restartFailedAnswerDeepEvaluation(record: RestartAnswerDeepEvaluationRecord) {
    return db.transaction(async (tx) => {
      // 先写入新的重试 Run，再让点评记录指向它，避免外键瞬时失效。
      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      const [evaluation] = await tx
        .update(answerDeepEvaluations)
        .set({
          status: 'processing',
          result: null,
          error: null,
          modelName: record.run.modelName,
          promptVersion: record.run.promptVersion,
          agentRunId: record.run.id,
          updatedAt: record.startedAt,
          completedAt: null,
        })
        .where(
          and(
            eq(answerDeepEvaluations.id, record.evaluationId),
            eq(answerDeepEvaluations.turnId, record.turnId),
            eq(answerDeepEvaluations.status, 'failed'),
          ),
        )
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('深度点评已不处于可重试状态')
      return { evaluation, run }
    })
  }

  async createAnswerDeepEvaluationRetryRun(record: CreateAnswerDeepEvaluationRetryRunRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx.insert(agentRuns).values(record.run).returning()

      const [evaluation] = await tx
        .update(answerDeepEvaluations)
        .set({
          agentRunId: run.id,
          updatedAt: run.startedAt,
        })
        .where(and(eq(answerDeepEvaluations.turnId, record.turnId), eq(answerDeepEvaluations.status, 'processing')))
        .returning({ id: answerDeepEvaluations.id })

      if (!evaluation) throw new InterviewRepositoryConflictError('深度点评已不处于生成阶段')
      return run
    })
  }

  async failAnswerDeepEvaluationRun(record: FailAnswerDeepEvaluationRunRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'failed',
          rawOutput: record.rawOutput,
          error: record.error,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_deep_evaluation'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('深度点评 AgentRun 已不处于 processing 状态')

      if (record.finalFailure) {
        const [evaluation] = await tx
          .update(answerDeepEvaluations)
          .set({
            status: 'failed',
            error: record.error,
            agentRunId: record.runId,
            updatedAt: record.finishedAt,
          })
          .where(
            and(
              eq(answerDeepEvaluations.turnId, record.turnId),
              eq(answerDeepEvaluations.agentRunId, record.runId),
              eq(answerDeepEvaluations.status, 'processing'),
            ),
          )
          .returning()

        if (!evaluation) throw new InterviewRepositoryConflictError('深度点评记录已不处于生成阶段')
      }

      return run
    })
  }

  async completeAnswerDeepEvaluationRun(record: CompleteAnswerDeepEvaluationRunRecord) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput: record.rawOutput,
          parsedOutput: record.modelOutput,
          error: null,
          tokenUsage: record.tokenUsage,
          durationMs: record.durationMs,
          finishedAt: record.finishedAt,
        })
        .where(
          and(
            eq(agentRuns.id, record.runId),
            eq(agentRuns.interviewSessionId, record.sessionId),
            eq(agentRuns.interviewTurnId, record.turnId),
            eq(agentRuns.workflowType, 'interview_deep_evaluation'),
            eq(agentRuns.status, 'processing'),
          ),
        )
        .returning()

      if (!run) throw new InterviewRepositoryConflictError('深度点评 AgentRun 已不处于 processing 状态')

      const [evaluation] = await tx
        .update(answerDeepEvaluations)
        .set({
          status: 'completed',
          result: record.result,
          error: null,
          agentRunId: record.runId,
          updatedAt: record.finishedAt,
          completedAt: record.finishedAt,
        })
        .where(
          and(
            eq(answerDeepEvaluations.turnId, record.turnId),
            eq(answerDeepEvaluations.agentRunId, record.runId),
            eq(answerDeepEvaluations.status, 'processing'),
          ),
        )
        .returning()

      if (!evaluation) throw new InterviewRepositoryConflictError('深度点评记录已不处于生成阶段')
      return { evaluation, run }
    })
  }

  async saveQuestionFeedback(record: typeof interviewQuestionFeedback.$inferInsert) {
    const [feedback] = await db
      .insert(interviewQuestionFeedback)
      .values(record)
      .onConflictDoUpdate({
        target: interviewQuestionFeedback.turnId,
        set: {
          rating: record.rating,
          reasons: record.reasons,
          comment: record.comment,
          lockedAt: record.lockedAt,
          updatedAt: record.updatedAt,
        },
        setWhere: isNull(interviewQuestionFeedback.lockedAt),
      })
      .returning()

    return feedback ?? null
  }

  async deleteQuestionFeedback(turnId: string) {
    const [feedback] = await db
      .delete(interviewQuestionFeedback)
      .where(and(eq(interviewQuestionFeedback.turnId, turnId), isNull(interviewQuestionFeedback.lockedAt)))
      .returning()

    return feedback ?? null
  }
}

export const interviewRepository = new DrizzleInterviewRepository()
