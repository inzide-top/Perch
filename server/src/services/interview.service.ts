import { ZodError } from 'zod'
import type { InterviewPlanRunInput } from '@server/schemas/interview-plan.schema'
import type { InterviewSkipModelOutput, InterviewSkipRunInput } from '@server/schemas/interview-skip.schema'
import type { InterviewTurnRunInput } from '@server/schemas/interview-turn.schema'
import type {
  AnswerDeepEvaluationModelOutput,
  AnswerDeepEvaluationRunInput,
} from '@server/schemas/interview-deep-evaluation.schema'
import { InterviewRepositoryConflictError, interviewRepository } from '../repositories/interview.repository'
import { jobAnalysisRepository } from '../repositories/job-analysis.repository'
import { opportunityRepository } from '../repositories/opportunity.repository'
import { resumeRepository } from '../repositories/resume.repository'
import {
  createInterviewSessionInputSchema,
  cancelInterviewAnswerInputSchema,
  endInterviewSessionInputSchema,
  generateInterviewDeepEvaluationInputSchema,
  saveInterviewQuestionFeedbackInputSchema,
  retryInterviewAnswerInputSchema,
  skipInterviewTurnInputSchema,
  submitInterviewAnswerInputSchema,
  switchInterviewSessionModelInputSchema,
} from '../schemas/interview.schema'
import { getCurrentUserId } from '../context/current-user'
import {
  interviewAnswerSchema,
  answerDeepEvaluationResultSchema,
  type AnswerEvidence,
  type AnswerEvidenceDraft,
  type InterviewAnswerContent,
  type InterviewAssessmentPlan,
  type InterviewFinalReview,
  type InterviewFinalReviewModel,
  type InterviewPlanModelOutput,
  type InterviewQuestionDraft,
  type InterviewSessionEvaluation,
  type InterviewSessionEvaluationPatch,
  type InterviewTurnModelOutput,
  type QuestionAssessmentPlan,
} from '@/shared/interview/schemas'
import type { ModelConnection } from '@server/schemas/model.schema'
import {
  createJsonSyntaxRepairContext,
  createValidationRepairContext,
  type ValidationRepairContext,
} from '../utils/model-validation'
import {
  buildInterviewPlanRepairPrompt,
  buildInterviewPlanSystemPrompt,
  buildInterviewPlanUserPrompt,
  parseInterviewPlanModelOutput,
} from './interview/plan-prompt'
import { buildInterviewPlanRunInput } from './interview/plan-input'
import { collectHistoricalReviews, collectHistoricalWeaknesses } from './interview/history-context'
import {
  buildInterviewSkipRepairPrompt,
  buildInterviewSkipSystemPrompt,
  buildInterviewSkipUserPrompt,
  parseInterviewSkipModelOutput,
} from './interview/skip-prompt'
import {
  buildInterviewTurnRepairPrompt,
  buildInterviewTurnSystemPrompt,
  buildInterviewTurnUserPrompt,
  parseInterviewTurnModelOutput,
} from './interview/turn-prompt'
import {
  applyExplicitUnknownSkipEvaluation,
  applyInterviewAssistanceFactor,
  calculateInterviewOverallScore,
  calculateWeightedEvaluationPointScore,
} from './interview/scoring'
import { buildAnswerDeepEvaluationRunInput } from './interview/deep-evaluation-input'
import { materializeAnswerDeepEvaluationResult } from './interview/deep-evaluation'
import {
  buildAnswerDeepEvaluationRepairPrompt,
  buildAnswerDeepEvaluationSystemPrompt,
  buildAnswerDeepEvaluationUserPrompt,
  parseAnswerDeepEvaluationModelOutput,
} from './interview/deep-evaluation-prompt'
import { getInterviewCancellationOperationKeys, getInterviewSubmissionReplay } from './interview/state-machine'
import { withBackgroundTaskCapacity } from './background-task.service'
import {
  cancelModelRequest,
  clearModelRequestCancellation,
  isModelRequestCancelled,
  requestModelCompletion,
  ModelRequestError,
} from './ai/model-client'
import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'

const interviewPromptVersion = 'mock-interview.v1'

export class InterviewNotFoundError extends Error {
  statusCode = 404
}

export class InterviewConflictError extends Error {
  statusCode = 409
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function createInitialEvaluation(): InterviewSessionEvaluation {
  return {
    status: 'evaluating',
    score: null,
    masteryScore: null,
    communicationScore: null,
    coverage: {
      plannedTopics: 0,
      evaluatedTopics: 0,
      sufficientTopics: 0,
    },
    consistency: 'unknown',
    topicEvaluations: [],
    summary: '',
    strengths: [],
    weaknesses: [],
    suggestions: [],
    finalReview: null,
  }
}

async function assertOwnedOpportunity(opportunityId: string) {
  const [userId, opportunity] = await Promise.all([
    getCurrentUserId(),
    opportunityRepository.findOpportunityOwnership(opportunityId),
  ])

  if (!opportunity || opportunity.userId !== userId) throw new InterviewNotFoundError('岗位机会不存在')
}

async function requireOwnedOpportunity(opportunityId: string) {
  await assertOwnedOpportunity(opportunityId)
  const opportunity = await opportunityRepository.findOpportunityById(opportunityId)
  if (!opportunity) throw new InterviewNotFoundError('岗位机会不存在')
  return opportunity
}

async function requireOwnedSession(sessionId: string) {
  const session = await interviewRepository.findSessionById(sessionId)
  if (!session) throw new InterviewNotFoundError('模拟面试不存在')

  await requireOwnedOpportunity(session.opportunityId)
  return session
}

function toSessionSummary(
  session: Awaited<ReturnType<typeof interviewRepository.findSessionById>>,
  metadata: {
    answeredQuestionCount?: number
    validAnswerCount?: number
    evaluation?: InterviewSessionEvaluation | null
  } = {},
) {
  if (!session) throw new InterviewNotFoundError('模拟面试不存在')

  return {
    id: session.id,
    opportunityId: session.opportunityId,
    configuration: session.configuration,
    modelName: session.modelSnapshot.modelName,
    modelBaseUrl: session.modelSnapshot.baseUrl,
    status: session.status,
    evidenceStatus: session.evidenceStatus,
    latestOverallScore: session.latestOverallScore,
    answeredQuestionCount: metadata.answeredQuestionCount ?? 0,
    validAnswerCount: metadata.validAnswerCount ?? 0,
    primaryStrength: metadata.evaluation?.strengths[0] ?? null,
    primaryGap: metadata.evaluation?.weaknesses[0] ?? null,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
  }
}

function toPublicSession(session: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionById>>>) {
  return {
    id: session.id,
    opportunityId: session.opportunityId,
    configuration: session.configuration,
    modelName: session.modelSnapshot.modelName,
    modelBaseUrl: session.modelSnapshot.baseUrl,
    currentTurnId: session.currentTurnId,
    status: session.status,
    evidenceStatus: session.evidenceStatus,
    endReason: session.endReason,
    latestOverallScore: session.latestOverallScore,
    overallScoreStatus: session.overallScoreStatus,
    stateVersion: session.stateVersion,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
    updatedAt: session.updatedAt,
  }
}

function normalizeModelBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

function assertSessionModelConnection(
  session: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionById>>>,
  connection: ModelConnection,
) {
  const matches =
    session.modelSnapshot.modelName.trim() === connection.modelName.trim() &&
    normalizeModelBaseUrl(session.modelSnapshot.baseUrl) === normalizeModelBaseUrl(connection.baseUrl)
  if (!matches) {
    throw new InterviewConflictError(`本轮面试绑定模型 ${session.modelSnapshot.modelName}，请先确认切换模型后再继续。`)
  }
}

function getCandidateAnswerFromRunInput(input: unknown): InterviewAnswerContent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const parsedAnswer = interviewAnswerSchema.safeParse((input as Record<string, unknown>).candidateAnswer)
  return parsedAnswer.success ? parsedAnswer.data : null
}

function toPublicDetail(
  detail: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>,
  recoveredAnswers: ReadonlyMap<string, InterviewAnswerContent> = new Map(),
  taskError: AgentRunError | null = null,
) {
  return {
    // assessmentPlan 的规则与评估点仍是 Agent 私有上下文；只公开主题 key/label 供评分区域展示。
    session: toPublicSession(detail.session),
    topics:
      detail.session.assessmentPlan?.topics.map((topic) => ({
        key: topic.key,
        label: topic.label,
      })) ?? [],
    turns: detail.turns.map((turn) => ({
      ...turn,
      answer: turn.answer ?? recoveredAnswers.get(turn.id) ?? null,
    })),
    interactions: detail.interactions,
    evaluation: detail.evaluation,
    deepEvaluations: detail.deepEvaluations.map((evaluation) => ({
      turnId: evaluation.turnId,
      status: evaluation.status,
      error: evaluation.error
        ? {
            code: evaluation.error.code,
            message: evaluation.error.message,
            retryable: evaluation.error.retryable,
          }
        : null,
      completedAt: evaluation.completedAt,
    })),
    feedback: detail.feedback,
    taskError: taskError
      ? {
          code: taskError.code,
          message: taskError.message,
          retryable: taskError.retryable,
        }
      : null,
  }
}

export async function createInterviewSession(opportunityId: string, input: unknown) {
  const parsedInput = createInterviewSessionInputSchema.parse(input)
  const opportunity = await requireOwnedOpportunity(opportunityId)

  const analysis = await jobAnalysisRepository.findAnalysisByOpportunityId(opportunityId)
  if (!analysis || analysis.status !== 'completed' || !analysis.result) {
    throw new InterviewConflictError('JD 分析尚未完成，不能开始模拟面试')
  }

  const analysisResult = analysis.result

  const resumeVersion = await resumeRepository.findVersionById(analysis.resumeVersionId)

  if (!resumeVersion) {
    throw new InterviewConflictError('JD 分析绑定的简历版本不存在，不能开始模拟面试')
  }

  const [historicalSessionEvaluations, interviewHistory] = await Promise.all([
    interviewRepository.findHistoricalSessionEvaluationsByOpportunityId(opportunityId),
    opportunityRepository.findInterviewHistoryByOpportunityId(opportunityId, opportunity),
  ])
  const historicalWeaknesses = collectHistoricalWeaknesses(historicalSessionEvaluations)
  const historicalReviews = collectHistoricalReviews(
    interviewHistory ?? {
      writtenTestReview: null,
      interviewRounds: [],
      reviewDocuments: [],
    },
  )

  const planInput = buildInterviewPlanRunInput({
    opportunity,
    resume: resumeVersion.content,
    analysis: analysisResult,
    configuration: parsedInput.configuration,
    historicalWeaknesses,
    historicalReviews,
  })

  const [latestRun] = await jobAnalysisRepository.findRunsByAnalysisId(analysis.id)
  const now = new Date().toISOString()
  const sessionId = crypto.randomUUID()
  const evaluation = createInitialEvaluation()

  const result = await interviewRepository.createSessionWithInitialEvaluation({
    session: {
      id: sessionId,
      opportunityId,
      jobAnalysisId: analysis.id,
      jobAnalysisRunId: latestRun?.id ?? null,
      resumeVersionId: analysis.resumeVersionId,
      configuration: parsedInput.configuration,
      assessmentPlan: null,
      modelSnapshot: {
        baseUrl: parsedInput.modelConnection.baseUrl,
        modelName: parsedInput.modelConnection.modelName,
      },
      promptVersion: interviewPromptVersion,
      currentTurnId: null,
      status: 'preparing',
      evidenceStatus: 'insufficient',
      endReason: null,
      latestOverallScore: null,
      overallScoreStatus: 'evaluating',
      stateVersion: 1,
      createdAt: now,
      startedAt: null,
      lastActiveAt: now,
      endedAt: null,
      updatedAt: now,
    },
    evaluation: {
      id: crypto.randomUUID(),
      sessionId,
      result: evaluation,
      evaluatedThroughTurnId: null,
      revision: 1,
      updatedAt: now,
      finalizedAt: null,
    },
  })

  const operationKey = `interview_plan:${result.session.id}`
  void executeInterviewPlan({
    sessionId: result.session.id,
    expectedStateVersion: result.session.stateVersion,
    input: planInput,
    modelConnection: parsedInput.modelConnection,
  })
    .catch((error: unknown) => {
      console.error('Interview plan background execution crashed', {
        sessionId: result.session.id,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return toSessionSummary(result.session)
}

export async function getInterviewSessions(opportunityId: string) {
  await assertOwnedOpportunity(opportunityId)
  const records = await interviewRepository.listSessionSummariesByOpportunityId(opportunityId)

  return records.map((record) =>
    toSessionSummary(record.session, {
      answeredQuestionCount: record.answeredQuestionCount ?? 0,
      validAnswerCount: record.validAnswerCount ?? 0,
      evaluation: record.evaluation,
    }),
  )
}

export type InterviewSessionStatusSnapshot = {
  status: string
  phase:
    | 'building_plan'
    | 'preparation_failed'
    | 'generating_first_question'
    | 'awaiting_answer'
    | 'evaluating_answer'
    | 'answer_processing_failed'
    | 'generating_question'
    | 'question_generation_failed'
    | 'generating_review'
    | 'review_generation_failed'
    | 'review_ready'
  stateVersion: number
  currentTurnId: string | null
  updatedAt: string
  error: { code: string; message: string } | null
}

function getInterviewSessionPhaseFromStatus(snapshot: {
  status: string
  currentTurnId: string | null
  currentTurnStatus: string | null
  currentTurnSkip: unknown
}): InterviewSessionStatusSnapshot['phase'] {
  if (snapshot.status === 'preparing') return 'building_plan'
  if (snapshot.status === 'preparation_failed') return 'preparation_failed'
  if (snapshot.status === 'finalizing') return 'generating_review'
  if (snapshot.status === 'completed' || snapshot.status === 'ended_early' || snapshot.status === 'cancelled') {
    return 'review_ready'
  }
  if (!snapshot.currentTurnId) return 'generating_question'
  if (snapshot.currentTurnStatus === 'awaiting_answer') return 'awaiting_answer'
  if (snapshot.currentTurnStatus === 'processing') {
    return snapshot.currentTurnSkip ? 'generating_question' : 'evaluating_answer'
  }
  if (snapshot.currentTurnStatus === 'processing_failed') {
    return snapshot.currentTurnSkip ? 'question_generation_failed' : 'answer_processing_failed'
  }

  return 'generating_question'
}

export async function getInterviewSessionStatus(sessionId: string): Promise<InterviewSessionStatusSnapshot> {
  const [userId, snapshot] = await Promise.all([
    getCurrentUserId(),
    interviewRepository.findSessionStatusById(sessionId),
  ])

  if (!snapshot || snapshot.opportunityUserId !== userId) throw new InterviewNotFoundError('模拟面试不存在')

  const phase = getInterviewSessionPhaseFromStatus(snapshot)
  const shouldReadError =
    phase === 'preparation_failed' || phase === 'answer_processing_failed' || phase === 'question_generation_failed'
  const failedRun = shouldReadError ? await interviewRepository.findLatestFailedInterviewWorkflowRun(sessionId) : null

  return {
    status: snapshot.status,
    phase,
    stateVersion: snapshot.stateVersion,
    currentTurnId: snapshot.currentTurnId,
    updatedAt: snapshot.updatedAt,
    error: failedRun?.error ? { code: failedRun.error.code, message: failedRun.error.message } : null,
  }
}

export async function getActiveInterviewModelUsage() {
  const userId = await getCurrentUserId()
  return interviewRepository.listActiveSessionModelUsage(userId)
}

export async function switchInterviewSessionModel(sessionId: string, input: unknown) {
  const parsedInput = switchInterviewSessionModelInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  if (session.status !== 'active' || !session.currentTurnId) {
    throw new InterviewConflictError('只能为等待继续的进行中面试切换模型')
  }

  const turn = await interviewRepository.findTurnById(session.currentTurnId)
  if (!turn || (turn.status !== 'awaiting_answer' && turn.status !== 'processing_failed')) {
    throw new InterviewConflictError('AI 正在处理当前任务，请完成后再切换模型')
  }

  await interviewRepository.updateSessionModelSnapshot({
    sessionId,
    expectedStateVersion: session.stateVersion,
    modelSnapshot: {
      baseUrl: parsedInput.modelConnection.baseUrl,
      modelName: parsedInput.modelConnection.modelName,
    },
    updatedAt: new Date().toISOString(),
  })
  return getInterviewSession(sessionId)
}

export async function getInterviewSession(sessionId: string) {
  await requireOwnedSession(sessionId)
  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')

  const turnIdsMissingAnswers = detail.turns
    .filter(
      (turn) =>
        !turn.answer &&
        Boolean(turn.answerSubmissionKey) &&
        (turn.status === 'processing' || turn.status === 'processing_failed'),
    )
    .map((turn) => turn.id)
  const recoveryRuns = await interviewRepository.findInterviewTurnRunsByTurnIds(turnIdsMissingAnswers)
  const recoveredAnswers = new Map<string, InterviewAnswerContent>()

  recoveryRuns.forEach((run) => {
    if (!run.interviewTurnId || recoveredAnswers.has(run.interviewTurnId)) return

    const answer = getCandidateAnswerFromRunInput(run.input)
    if (answer) recoveredAnswers.set(run.interviewTurnId, answer)
  })

  const currentTurn = detail.turns.find((turn) => turn.id === detail.session.currentTurnId)
  const hasFailedInterviewWorkflow =
    detail.session.status === 'preparation_failed' || currentTurn?.status === 'processing_failed'
  const latestFailedRun = hasFailedInterviewWorkflow
    ? await interviewRepository.findLatestFailedInterviewWorkflowRun(sessionId)
    : null

  return toPublicDetail(detail, recoveredAnswers, latestFailedRun?.error ?? null)
}

export async function endInterviewSession(sessionId: string, input: unknown) {
  const parsedInput = endInterviewSessionInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')

  const coverage = detail.evaluation?.result.coverage
  const evidenceStatus =
    !coverage || coverage.evaluatedTopics === 0
      ? 'insufficient'
      : coverage.plannedTopics > 0 && coverage.evaluatedTopics >= coverage.plannedTopics
        ? 'sufficient'
        : 'partial'
  const now = new Date().toISOString()
  const ended = await interviewRepository.endSession({
    sessionId,
    expectedStateVersion: session.stateVersion,
    status: 'ended_early',
    evidenceStatus,
    endReason: parsedInput.reason,
    endedAt: now,
  })

  if (!ended) throw new InterviewConflictError('面试状态已变化，请刷新后重试')

  const currentTurn = detail.turns.find((turn) => turn.id === session.currentTurnId)
  for (const operationKey of getInterviewCancellationOperationKeys(sessionId, currentTurn ?? null)) {
    cancelModelRequest(operationKey)
  }

  return toSessionSummary(ended)
}

export async function saveInterviewQuestionFeedback(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = saveInterviewQuestionFeedbackInputSchema.parse(input)
  await requireOwnedSession(sessionId)
  const turn = await interviewRepository.findTurnById(turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('面试问题不存在')

  const existing = await interviewRepository.findQuestionFeedbackByTurnId(turnId)
  if (existing?.lockedAt) throw new InterviewConflictError('已提交详细反馈，不支持修改')

  const now = new Date().toISOString()
  const shouldLock = parsedInput.reasons.length > 0 || Boolean(parsedInput.comment)
  const feedback = await interviewRepository.saveQuestionFeedback({
    id: existing?.id ?? crypto.randomUUID(),
    turnId,
    rating: parsedInput.rating,
    reasons: parsedInput.reasons,
    comment: parsedInput.comment,
    lockedAt: shouldLock ? now : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })

  if (!feedback) throw new InterviewConflictError('反馈状态已变化，请刷新后重试')
  return feedback
}

export async function generateAnswerDeepEvaluation(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = generateInterviewDeepEvaluationInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')

  const turn = detail.turns.find((item) => item.id === turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('面试回答不存在')
  if (turn.status !== 'completed' || !turn.answer || !turn.answerEvidence) {
    throw new InterviewConflictError('只有已完成评估的正式回答才能生成深度点评')
  }

  const existingEvaluation = await interviewRepository.findAnswerDeepEvaluationByTurnId(turnId)
  if (
    existingEvaluation?.status === 'completed' ||
    existingEvaluation?.status === 'pending' ||
    existingEvaluation?.status === 'processing'
  ) {
    return existingEvaluation
  }

  const assessmentPlan = session.assessmentPlan
  if (!assessmentPlan) throw new InterviewConflictError('模拟面试计划不存在')
  const topic = findPlanTopic(assessmentPlan, turn.question.topicKey)
  const opportunity = await requireOwnedOpportunity(session.opportunityId)
  const runInput = buildAnswerDeepEvaluationRunInput({
    jobTitle: opportunity.jobTitle,
    interviewType: session.configuration.type,
    configuredDifficulty: session.configuration.difficulty,
    difficultyRubric: assessmentPlan.difficultyRubric,
    topic,
    turn,
    turns: detail.turns,
  })
  const operationKey = `interview_deep_evaluation:${turnId}`
  clearModelRequestCancellation(operationKey)
  const existingRuns = await interviewRepository.findAgentRunsByOperationKey(operationKey)
  const attemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const runId = crypto.randomUUID()
  const evaluationId = existingEvaluation?.id ?? crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const run = createAnswerDeepEvaluationAgentRun({
    id: runId,
    sessionId,
    turnId,
    operationKey,
    attemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: answerDeepEvaluationPromptVersion,
    startedAt,
  })

  let evaluation: Awaited<ReturnType<typeof interviewRepository.findAnswerDeepEvaluationByTurnId>>
  try {
    const started = await withBackgroundTaskCapacity('answer_deep_evaluation', async () => {
      if (existingEvaluation?.status === 'failed') {
        return interviewRepository.restartFailedAnswerDeepEvaluation({
          sessionId,
          turnId,
          evaluationId,
          run,
          startedAt,
        })
      }

      return interviewRepository.startAnswerDeepEvaluation({
        sessionId,
        turnId,
        evaluation: {
          id: evaluationId,
          turnId,
          status: 'processing',
          result: null,
          error: null,
          modelName: parsedInput.modelConnection.modelName,
          promptVersion: answerDeepEvaluationPromptVersion,
          agentRunId: runId,
          createdAt: startedAt,
          updatedAt: startedAt,
          completedAt: null,
        },
        run,
      })
    })
    evaluation = started.evaluation
  } catch (error) {
    if (error instanceof InterviewRepositoryConflictError) {
      const concurrentEvaluation = await interviewRepository.findAnswerDeepEvaluationByTurnId(turnId)
      if (concurrentEvaluation) return concurrentEvaluation
    }
    throw error
  }

  void executeAnswerDeepEvaluation({
    sessionId,
    turnId,
    operationKey,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
    firstRunId: runId,
    firstAttemptNumber: attemptNumber,
  })
    .catch((error: unknown) => {
      console.error('Answer deep evaluation background execution crashed', {
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return evaluation
}

export async function getAnswerDeepEvaluation(sessionId: string, turnId: string) {
  await requireOwnedSession(sessionId)
  const turn = await interviewRepository.findTurnById(turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('面试回答不存在')

  const evaluation = await interviewRepository.findAnswerDeepEvaluationByTurnId(turnId)
  if (!evaluation) throw new InterviewNotFoundError('当前回答尚未生成深度点评')
  return evaluation
}

export async function getAnswerDeepEvaluationStatus(sessionId: string, turnId: string) {
  const [userId, sessionStatus] = await Promise.all([
    getCurrentUserId(),
    interviewRepository.findSessionStatusById(sessionId),
  ])
  if (!sessionStatus || sessionStatus.opportunityUserId !== userId) throw new InterviewNotFoundError('模拟面试不存在')
  const turn = await interviewRepository.findTurnStatusById(turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('面试回答不存在')

  const evaluation = await interviewRepository.findAnswerDeepEvaluationStatusByTurnId(turnId)
  if (!evaluation) throw new InterviewNotFoundError('当前回答尚未生成深度点评')
  return evaluation
}

export async function deleteInterviewQuestionFeedback(sessionId: string, turnId: string) {
  await requireOwnedSession(sessionId)
  const turn = await interviewRepository.findTurnById(turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('面试问题不存在')

  const existing = await interviewRepository.findQuestionFeedbackByTurnId(turnId)
  if (!existing) throw new InterviewNotFoundError('问题反馈不存在')
  if (existing.lockedAt) throw new InterviewConflictError('已提交详细反馈，不支持撤销')

  await interviewRepository.deleteQuestionFeedback(turnId)
  return { id: existing.id }
}

function createInterviewTurnAgentRun(input: {
  id: string
  sessionId: string
  turnId: string
  operationKey: string
  attemptNumber: number
  runInput: Record<string, unknown>
  modelName: string
  promptVersion: string
  startedAt: string
}) {
  return {
    id: input.id,
    workflowType: 'interview_turn' as const,
    analysisId: null,
    interviewSessionId: input.sessionId,
    interviewTurnId: input.turnId,
    operationKey: input.operationKey,
    attemptNumber: input.attemptNumber,
    status: 'processing' as const,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    input: input.runInput,
    startedAt: input.startedAt,
  }
}

function createAnswerDeepEvaluationAgentRun(input: {
  id: string
  sessionId: string
  turnId: string
  operationKey: string
  attemptNumber: number
  runInput: AnswerDeepEvaluationRunInput
  modelName: string
  promptVersion: string
  startedAt: string
}) {
  return {
    id: input.id,
    workflowType: 'interview_deep_evaluation' as const,
    analysisId: null,
    interviewSessionId: input.sessionId,
    interviewTurnId: input.turnId,
    operationKey: input.operationKey,
    attemptNumber: input.attemptNumber,
    status: 'processing' as const,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    input: input.runInput,
    startedAt: input.startedAt,
  }
}

function stripAssessmentPlanIds(assessmentPlan: InterviewAssessmentPlan) {
  return {
    difficultyRubric: assessmentPlan.difficultyRubric,
    topics: assessmentPlan.topics.map(({ id: _, evaluationPoints, ...topic }) => ({
      ...topic,
      evaluationPoints: evaluationPoints.map(({ id: __, ...point }) => point),
    })),
  }
}

function getCompoundQuestionLimit(scale: 'quick' | 'standard' | 'deep') {
  if (scale === 'quick') return 1
  if (scale === 'deep') return 3
  return 2
}

function skipConsumesBudget(reason: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>['skip']) {
  return !reason || (reason.reason !== 'unclear' && reason.reason !== 'irrelevant')
}

function getBudgetedTurns(
  turns: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>['turns'],
) {
  return turns.filter((turn) => skipConsumesBudget(turn.skip))
}

function buildReviewEvidence(
  detail: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>,
  currentTurn: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>,
  answer: InterviewAnswerContent,
) {
  const pointKeyById = new Map(
    (detail.session.assessmentPlan?.topics ?? []).flatMap((topic) =>
      topic.evaluationPoints.map((point) => [point.id, point.key] as const),
    ),
  )
  const historicalItems = detail.turns
    .filter(
      (turn) =>
        turn.id !== currentTurn.id &&
        (turn.status === 'completed' || turn.status === 'skipped') &&
        (turn.answerEvidence || turn.skip),
    )
    .map((turn) => ({
      referenceKey: `T${turn.sequenceNumber}`,
      sequenceNumber: turn.sequenceNumber,
      kind: turn.kind,
      format: turn.question.format,
      topicKey: turn.question.topicKey,
      focusLabel: turn.question.focusLabel,
      question: turn.question.content,
      answerSummary: turn.answer?.content?.slice(0, 500) ?? null,
      evidenceSummary: turn.answerEvidence?.summary ?? null,
      pointResults:
        turn.answerEvidence?.pointResults.flatMap((point) => {
          const pointKey = pointKeyById.get(point.pointId)
          return pointKey ? [{ pointKey, status: point.status, score: point.score }] : []
        }) ?? [],
      hintUsage: turn.hintUsage,
      skipReason: turn.skip?.reason ?? null,
    }))

  return [
    ...historicalItems,
    {
      referenceKey: `T${currentTurn.sequenceNumber}`,
      sequenceNumber: currentTurn.sequenceNumber,
      kind: currentTurn.kind,
      format: currentTurn.question.format,
      topicKey: currentTurn.question.topicKey,
      focusLabel: currentTurn.question.focusLabel,
      question: currentTurn.question.content,
      answerSummary: answer.content.slice(0, 500),
      evidenceSummary: null,
      pointResults: [],
      hintUsage: currentTurn.hintUsage,
      skipReason: null,
    },
  ].sort((current, next) => current.sequenceNumber - next.sequenceNumber)
}

function buildInterviewTurnRunInput(
  detail: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>,
  turn: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>,
  answer: InterviewAnswerContent,
): InterviewTurnRunInput {
  const assessmentPlan = detail.session.assessmentPlan
  if (!assessmentPlan) throw new InterviewConflictError('模拟面试计划尚未生成，不能提交回答')

  const budget = detail.session.configuration.budget
  const completedTurns = detail.turns.filter((item) => item.status === 'completed')
  const budgetedTurns = getBudgetedTurns(detail.turns)
  const mainQuestionsAsked = budgetedTurns.filter((item) => item.kind === 'main').length
  const totalQuestionsAsked = budgetedTurns.length
  const compoundQuestionsAsked = budgetedTurns.filter((item) => item.question.format === 'compound').length
  const compoundQuestionLimit = getCompoundQuestionLimit(detail.session.configuration.scale)

  return {
    configuration: detail.session.configuration,
    budgetProgress: {
      mainQuestionsAsked,
      totalQuestionsAsked,
      followUpsForCurrentRoot: turn.followUpNumber,
      remainingMainQuestions: Math.max(0, budget.mainTopicBudget - mainQuestionsAsked),
      remainingTotalQuestions: Math.max(0, budget.totalQuestionBudget - totalQuestionsAsked),
      remainingFollowUpsForCurrentRoot: Math.max(0, budget.maxFollowUpsPerRoot - turn.followUpNumber),
      compoundQuestionsAsked,
      remainingCompoundQuestions: Math.max(0, compoundQuestionLimit - compoundQuestionsAsked),
    },
    assessmentPlan: stripAssessmentPlanIds(assessmentPlan),
    currentTurn: {
      kind: turn.kind,
      sequenceNumber: turn.sequenceNumber,
      mainQuestionNumber: turn.mainQuestionNumber,
      followUpNumber: turn.followUpNumber,
      question: turn.question,
      hintUsage: turn.hintUsage,
    },
    candidateAnswer: answer,
    recentHistory: completedTurns.slice(-8).map((item) => ({
      sequenceNumber: item.sequenceNumber,
      kind: item.kind,
      format: item.question.format,
      topicKey: item.question.topicKey,
      focusLabel: item.question.focusLabel,
      question: item.question.content,
      answerSummary: item.answer?.content ? item.answer.content.slice(0, 500) : null,
      evidenceSummary: item.answerEvidence?.summary ?? null,
    })),
    reviewEvidence: buildReviewEvidence(detail, turn, answer),
  }
}

function buildInterviewSkipRunInput(
  detail: NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>,
  turn: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>,
): InterviewSkipRunInput {
  const assessmentPlan = detail.session.assessmentPlan
  if (!assessmentPlan || !turn.skip) throw new InterviewConflictError('跳过任务缺少面试计划或跳过原因')

  const budgetedTurns = getBudgetedTurns(detail.turns)
  const consumesBudget = skipConsumesBudget(turn.skip)
  const mainQuestionsAsked = budgetedTurns.filter((item) => item.kind === 'main').length
  const totalQuestionsAsked = budgetedTurns.length
  const compoundQuestionsAsked = budgetedTurns.filter((item) => item.question.format === 'compound').length
  const compoundQuestionLimit = getCompoundQuestionLimit(detail.session.configuration.scale)

  return {
    configuration: detail.session.configuration,
    budgetProgress: {
      remainingMainQuestions: Math.max(0, detail.session.configuration.budget.mainTopicBudget - mainQuestionsAsked),
      remainingTotalQuestions: Math.max(
        0,
        detail.session.configuration.budget.totalQuestionBudget - totalQuestionsAsked,
      ),
      remainingCompoundQuestions: Math.max(0, compoundQuestionLimit - compoundQuestionsAsked),
    },
    assessmentPlan: stripAssessmentPlanIds(assessmentPlan),
    currentTurn: {
      kind: turn.kind,
      sequenceNumber: turn.sequenceNumber,
      mainQuestionNumber: turn.mainQuestionNumber,
      followUpNumber: turn.followUpNumber,
      question: turn.question,
    },
    skip: turn.skip,
    consumesBudget,
    recentHistory: detail.turns
      .filter((item) => item.id !== turn.id && (item.status === 'completed' || item.status === 'skipped'))
      .slice(-8)
      .map((item) => ({
        sequenceNumber: item.sequenceNumber,
        topicKey: item.question.topicKey,
        focusLabel: item.question.focusLabel,
        question: item.question.content,
        evidenceSummary: item.answerEvidence?.summary ?? null,
      })),
  }
}

function findPlanTopic(assessmentPlan: InterviewAssessmentPlan, topicKey: string) {
  const topic = assessmentPlan.topics.find((item) => item.key === topicKey)
  if (!topic) throw new InterviewConflictError('模型引用了不存在的面试主题')

  return topic
}

function mapAnswerEvidenceToPersisted(topic: QuestionAssessmentPlan, draft: AnswerEvidenceDraft): AnswerEvidence {
  return {
    ...draft,
    pointResults: draft.pointResults.map(({ pointKey, ...result }) => {
      const point = topic.evaluationPoints.find((item) => item.key === pointKey)
      if (!point) throw new InterviewConflictError('模型引用了不存在的评估点')

      return {
        ...result,
        pointId: point.id,
      }
    }),
  }
}

function calculateTopicMasteryScore(topic: QuestionAssessmentPlan, draft: AnswerEvidenceDraft) {
  const contentScore = calculateWeightedEvaluationPointScore(
    draft.pointResults.map((result) => ({
      score: result.score,
      weight: topic.evaluationPoints.find((item) => item.key === result.pointKey)?.weight ?? 0,
    })),
  )

  return applyInterviewAssistanceFactor(contentScore, draft.hintUsage)
}

function getTopicStatus(score: number): InterviewSessionEvaluation['topicEvaluations'][number]['status'] {
  if (score >= 85) return 'mastered'
  if (score >= 70) return 'solid'
  if (score >= 45) return 'partial'
  if (score > 0) return 'weak'
  return 'unknown'
}

function getEvidenceStatus(evaluation: InterviewSessionEvaluation) {
  if (evaluation.coverage.evaluatedTopics === 0) return 'insufficient' as const
  if (evaluation.coverage.evaluatedTopics >= evaluation.coverage.plannedTopics) return 'sufficient' as const
  return 'partial' as const
}

function mergeUniqueLimited(current: string[], incoming: string[], limit: number) {
  return [...new Set([...incoming, ...current])].filter(Boolean).slice(0, limit)
}

type InterviewSessionDetail = NonNullable<Awaited<ReturnType<typeof interviewRepository.findSessionDetail>>>
type InterviewTurnRecord = InterviewSessionDetail['turns'][number]
type InterviewEvaluationEvidence = {
  turnId: string
  topicKey: string
  score: number
  confidence: 'high' | 'medium' | 'low'
  communicationScore: number | null
  summary: string
}

function calculatePersistedTopicMasteryScore(topic: QuestionAssessmentPlan, evidence: AnswerEvidence) {
  const contentScore = calculateWeightedEvaluationPointScore(
    evidence.pointResults.map((result) => ({
      score: result.score,
      weight: topic.evaluationPoints.find((item) => item.id === result.pointId)?.weight ?? 0,
    })),
  )

  return applyInterviewAssistanceFactor(contentScore, evidence.hintUsage)
}

function getCombinedConfidence(values: Array<'high' | 'medium' | 'low'>): 'high' | 'medium' | 'low' {
  if (values.includes('low')) return 'low'
  if (values.includes('medium')) return 'medium'
  return 'high'
}

function materializeFinalReview(
  modelReview: InterviewFinalReviewModel,
  turns: InterviewTurnRecord[],
  generatedAt: string,
): InterviewFinalReview {
  const turnBySequence = new Map(turns.map((turn) => [turn.sequenceNumber, turn]))

  const referencesFor = (referenceKeys: string[]) =>
    referenceKeys.map((referenceKey) => {
      const sequenceNumber = Number(referenceKey.slice(1))
      const turn = turnBySequence.get(sequenceNumber)
      if (!turn) throw new InterviewConflictError(`最终复盘引用了不存在的问题：${referenceKey}`)
      return { turnId: turn.id, sequenceNumber }
    })

  return {
    summary: modelReview.summary,
    strengths: modelReview.strengths.map((item) => ({
      title: item.title,
      detail: item.detail,
      references: referencesFor(item.referenceKeys),
    })),
    gaps: modelReview.gaps.map((item) => ({
      title: item.title,
      detail: item.detail,
      priority: item.priority,
      references: referencesFor(item.referenceKeys),
    })),
    nextPractice: modelReview.nextPractice,
    generatedAt,
  }
}

/**
 * 如果模型没有返回合法的 finalReview，仍然保留一份可审计的最小复盘，避免完成面试后右侧结果为空。
 * 这不是新的模型调用，也不改写服务端确定性评分；引用只使用已经落库的题次。
 */
function buildFallbackFinalReview(
  evaluation: InterviewSessionEvaluation,
  turns: InterviewTurnRecord[],
  generatedAt: string,
): InterviewFinalReview {
  const completedTurns = turns
    .filter((turn) => turn.answerEvidence || turn.skip)
    .slice(-3)
    .map((turn) => ({ turnId: turn.id, sequenceNumber: turn.sequenceNumber }))

  const references = completedTurns.length
    ? completedTurns
    : turns.slice(-1).map((turn) => ({
        turnId: turn.id,
        sequenceNumber: turn.sequenceNumber,
      }))

  return {
    summary: evaluation.summary || `本轮面试已结束，完成 ${evaluation.coverage.evaluatedTopics} 个能力主题的评估。`,
    strengths: evaluation.strengths.slice(0, 3).map((title) => ({
      title,
      detail: title,
      references,
    })),
    gaps: evaluation.weaknesses.slice(0, 3).map((title) => ({
      title,
      detail: title,
      priority: 'medium' as const,
      references,
    })),
    nextPractice: evaluation.suggestions.slice(0, 3),
    generatedAt,
  }
}

function applySessionEvaluation(
  detail: InterviewSessionDetail,
  assessmentPlan: InterviewAssessmentPlan,
  currentTurn: InterviewTurnRecord,
  draftEvidence: AnswerEvidenceDraft,
  patch: InterviewSessionEvaluationPatch | undefined,
  forceFinal: boolean,
  finalReview: InterviewFinalReview | null,
): InterviewSessionEvaluation {
  const currentTopic = findPlanTopic(assessmentPlan, currentTurn.question.topicKey)
  const currentTopicScore = calculateTopicMasteryScore(currentTopic, draftEvidence)
  const historicalEvidence = detail.turns.reduce<InterviewEvaluationEvidence[]>((items, turn) => {
    if (turn.id === currentTurn.id) return items
    if (turn.answerEvidence) {
      const topic = findPlanTopic(assessmentPlan, turn.question.topicKey)
      items.push({
        turnId: turn.id,
        topicKey: turn.question.topicKey,
        score: calculatePersistedTopicMasteryScore(topic, turn.answerEvidence),
        confidence: turn.answerEvidence.confidence,
        communicationScore: Math.round(
          (turn.answerEvidence.communication.clarity +
            turn.answerEvidence.communication.structure +
            turn.answerEvidence.communication.conciseness) /
            3,
        ),
        summary: turn.answerEvidence.summary,
      })
      return items
    }
    if (turn.skip?.reason === 'unknown') {
      items.push({
        turnId: turn.id,
        topicKey: turn.question.topicKey,
        score: 0,
        confidence: 'high',
        communicationScore: null,
        summary: `候选人明确选择不会回答“${findPlanTopic(assessmentPlan, turn.question.topicKey).label}”相关问题。`,
      })
    }
    return items
  }, [])
  const evidence: InterviewEvaluationEvidence[] = [
    ...historicalEvidence,
    {
      turnId: currentTurn.id,
      topicKey: currentTurn.question.topicKey,
      score: currentTopicScore,
      confidence: draftEvidence.confidence,
      communicationScore: Math.round(
        (draftEvidence.communication.clarity +
          draftEvidence.communication.structure +
          draftEvidence.communication.conciseness) /
          3,
      ),
      summary: draftEvidence.summary,
    },
  ]
  const evidenceByTopic = new Map<string, typeof evidence>()
  evidence.forEach((item) => {
    const topicEvidence = evidenceByTopic.get(item.topicKey) ?? []
    topicEvidence.push(item)
    evidenceByTopic.set(item.topicKey, topicEvidence)
  })
  const topicEvaluations = [...evidenceByTopic.entries()].map(([topicKey, topicEvidence]) => {
    const topic = findPlanTopic(assessmentPlan, topicKey)
    const masteryScore = Math.round(topicEvidence.reduce((total, item) => total + item.score, 0) / topicEvidence.length)
    const currentPatch =
      topicKey === currentTurn.question.topicKey && patch?.topicEvaluation?.topicKey === topicKey
        ? patch.topicEvaluation
        : null
    return {
      assessmentPlanId: topic.id,
      topicKey,
      // 等级必须由服务端根据确定性分数映射，不能让模型文案与实际分数互相矛盾。
      status: getTopicStatus(masteryScore),
      masteryScore,
      evidenceConfidence:
        currentPatch?.evidenceConfidence ?? getCombinedConfidence(topicEvidence.map((item) => item.confidence)),
      supportingTurnIds: topicEvidence.map((item) => item.turnId),
      summary: currentPatch?.summary ?? topicEvidence.at(-1)?.summary ?? '',
    }
  })
  const averageMastery = Math.round(
    topicEvaluations.reduce((total, item) => total + item.masteryScore, 0) / topicEvaluations.length,
  )
  const communicationEvidence = evidence.flatMap((item) =>
    item.communicationScore === null ? [] : [item.communicationScore],
  )
  const communicationScore = communicationEvidence.length
    ? Math.round(communicationEvidence.reduce((total, score) => total + score, 0) / communicationEvidence.length)
    : null
  const overallScore =
    communicationScore === null ? averageMastery : calculateInterviewOverallScore(averageMastery, communicationScore)
  const previousEvaluation = detail.evaluation?.result
  const plannedTopics = previousEvaluation?.coverage.plannedTopics || assessmentPlan.topics.length
  const sufficientTopics = topicEvaluations.filter((item) => item.masteryScore >= 70).length

  return {
    status: forceFinal ? 'final' : topicEvaluations.length >= 2 ? 'provisional' : 'evaluating',
    score: overallScore,
    masteryScore: averageMastery,
    communicationScore,
    coverage: {
      plannedTopics,
      evaluatedTopics: topicEvaluations.length,
      sufficientTopics,
    },
    consistency: topicEvaluations.length >= 3 ? 'stable' : 'unknown',
    topicEvaluations,
    summary: draftEvidence.summary,
    strengths: mergeUniqueLimited(previousEvaluation?.strengths ?? [], patch?.strengths ?? [], 6),
    weaknesses: mergeUniqueLimited(previousEvaluation?.weaknesses ?? [], patch?.weaknesses ?? [], 6),
    suggestions: mergeUniqueLimited(previousEvaluation?.suggestions ?? [], patch?.suggestions ?? [], 6),
    finalReview: finalReview ?? previousEvaluation?.finalReview ?? null,
  }
}

function materializeNextTurn(
  sessionId: string,
  currentTurn: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>,
  assessmentPlan: InterviewAssessmentPlan,
  nextQuestion: InterviewQuestionDraft,
  actionType: 'ask_follow_up' | 'ask_next_topic',
  createdAt: string,
) {
  const nextTopic = findPlanTopic(assessmentPlan, nextQuestion.topicKey)
  const { hints, ...question } = nextQuestion
  const isFollowUp = actionType === 'ask_follow_up'

  return {
    id: crypto.randomUUID(),
    sessionId,
    assessmentPlanId: nextTopic.id,
    rootTurnId: isFollowUp ? (currentTurn.rootTurnId ?? currentTurn.id) : null,
    parentTurnId: isFollowUp ? currentTurn.id : null,
    kind: isFollowUp ? ('follow_up' as const) : ('main' as const),
    sequenceNumber: currentTurn.sequenceNumber + 1,
    mainQuestionNumber: isFollowUp ? currentTurn.mainQuestionNumber : currentTurn.mainQuestionNumber + 1,
    followUpNumber: isFollowUp ? currentTurn.followUpNumber + 1 : 0,
    question,
    hints,
    answer: null,
    hintUsage: 'none' as const,
    skip: null,
    answerEvidence: null,
    answerSubmissionKey: null,
    status: 'awaiting_answer' as const,
    createdAt,
    completedAt: null,
    updatedAt: createdAt,
  }
}

function materializeTurnAfterSkip(
  sessionId: string,
  currentTurn: NonNullable<Awaited<ReturnType<typeof interviewRepository.findTurnById>>>,
  assessmentPlan: InterviewAssessmentPlan,
  nextQuestion: InterviewQuestionDraft,
  consumesBudget: boolean,
  createdAt: string,
) {
  const nextTopic = findPlanTopic(assessmentPlan, nextQuestion.topicKey)
  const { hints, ...question } = nextQuestion

  return {
    id: crypto.randomUUID(),
    sessionId,
    assessmentPlanId: nextTopic.id,
    rootTurnId: consumesBudget ? null : currentTurn.rootTurnId,
    parentTurnId: consumesBudget ? null : currentTurn.parentTurnId,
    kind: consumesBudget ? ('main' as const) : currentTurn.kind,
    sequenceNumber: currentTurn.sequenceNumber + 1,
    mainQuestionNumber: consumesBudget ? currentTurn.mainQuestionNumber + 1 : currentTurn.mainQuestionNumber,
    followUpNumber: consumesBudget ? 0 : currentTurn.followUpNumber,
    question,
    hints,
    answer: null,
    hintUsage: 'none' as const,
    skip: null,
    answerEvidence: null,
    answerSubmissionKey: null,
    status: 'awaiting_answer' as const,
    createdAt,
    completedAt: null,
    updatedAt: createdAt,
  }
}

function buildTurnInteractions(input: {
  turnId: string
  clientSubmissionId: string
  content: string
  submittedAt: string
  responseContent: string
  existingCount: number
  classification: InterviewTurnModelOutput['inputClassification']
  createdAt: string
}) {
  const isOffTopic = input.classification === 'off_topic'

  return {
    candidateInteraction: {
      id: crypto.randomUUID(),
      turnId: input.turnId,
      replyToInteractionId: null,
      clientMessageId: input.clientSubmissionId,
      sequenceNumber: input.existingCount + 1,
      role: 'candidate' as const,
      type: isOffTopic ? ('off_topic_message' as const) : ('clarification_request' as const),
      content: input.content,
      submittedAt: input.submittedAt,
      createdAt: input.createdAt,
    },
    interviewerInteraction: {
      id: crypto.randomUUID(),
      turnId: input.turnId,
      replyToInteractionId: null,
      clientMessageId: null,
      sequenceNumber: input.existingCount + 2,
      role: 'interviewer' as const,
      type: isOffTopic ? ('off_topic_redirect' as const) : ('clarification_response' as const),
      content: input.responseContent,
      submittedAt: null,
      createdAt: input.createdAt,
    },
  }
}

export async function submitInterviewAnswer(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = submitInterviewAnswerInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)

  const [existingAnswerTurn, existingInteraction] = await Promise.all([
    interviewRepository.findTurnByAnswerSubmissionKey(parsedInput.clientSubmissionId),
    interviewRepository.findInteractionByClientMessageId(parsedInput.clientSubmissionId),
  ])
  const replay = getInterviewSubmissionReplay({ sessionId, turnId, existingAnswerTurn, existingInteraction })
  if (replay === 'same_operation') return getInterviewSession(sessionId)
  if (replay === 'conflict') throw new InterviewConflictError('回答提交标识已被其他问题或消息使用')

  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new InterviewConflictError('只能回答当前进行中的问题')
  }
  assertSessionModelConnection(session, parsedInput.modelConnection)

  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
  const turn = detail.turns.find((item) => item.id === turnId)
  if (!turn || turn.status !== 'awaiting_answer') throw new InterviewConflictError('当前问题已不处于待回答状态')
  const turnWithHintUsage = {
    ...turn,
    hintUsage: parsedInput.hintUsage,
  }

  const acceptedAt = new Date().toISOString()
  const answer: InterviewAnswerContent = {
    content: parsedInput.content,
    submittedAt: parsedInput.submittedAt,
    acceptedAt,
  }
  const runInput = buildInterviewTurnRunInput(detail, turnWithHintUsage, answer)
  const operationKey = `interview_turn:${turnId}:${parsedInput.clientSubmissionId}`
  if (isModelRequestCancelled(operationKey)) {
    clearModelRequestCancellation(operationKey)
    return getInterviewSession(sessionId)
  }
  const existingRuns = await interviewRepository.findAgentRunsByOperationKey(operationKey)
  const attemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const runId = crypto.randomUUID()
  const run = createInterviewTurnAgentRun({
    id: runId,
    sessionId,
    turnId,
    operationKey,
    attemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: interviewTurnPromptVersion,
    startedAt: acceptedAt,
  })
  let started: Awaited<ReturnType<typeof interviewRepository.startInterviewTurnRun>>
  try {
    started = await interviewRepository.startInterviewTurnRun({
      sessionId,
      turnId,
      expectedStateVersion: session.stateVersion,
      answerSubmissionKey: parsedInput.clientSubmissionId,
      answer,
      hintUsage: parsedInput.hintUsage,
      now: acceptedAt,
      run,
    })
  } catch (error) {
    if (error instanceof InterviewRepositoryConflictError) {
      const [duplicateTurn, duplicateInteraction] = await Promise.all([
        interviewRepository.findTurnByAnswerSubmissionKey(parsedInput.clientSubmissionId),
        interviewRepository.findInteractionByClientMessageId(parsedInput.clientSubmissionId),
      ])
      if (
        getInterviewSubmissionReplay({
          sessionId,
          turnId,
          existingAnswerTurn: duplicateTurn,
          existingInteraction: duplicateInteraction,
        }) === 'same_operation'
      ) {
        return getInterviewSession(sessionId)
      }
    }
    throw error
  }

  if (isModelRequestCancelled(operationKey)) {
    await interviewRepository.cancelInterviewTurnRun({
      sessionId,
      turnId,
      cancelledAt: new Date().toISOString(),
    })
    clearModelRequestCancellation(operationKey)
    return getInterviewSession(sessionId)
  }

  void executeInterviewTurn({
    sessionId,
    turnId,
    operationKey,
    answer,
    clientSubmissionId: parsedInput.clientSubmissionId,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
    firstRunId: runId,
    firstAttemptNumber: attemptNumber,
    expectedStateVersion: started.session.stateVersion,
  })
    .catch((error: unknown) => {
      console.error('Interview turn background execution crashed', {
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return getInterviewSession(sessionId)
}

export async function retryInterviewAnswer(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = retryInterviewAnswerInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  assertSessionModelConnection(session, parsedInput.modelConnection)
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new InterviewConflictError('只能重试当前进行中的问题')
  }

  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
  const turn = detail.turns.find((item) => item.id === turnId)
  if (!turn || turn.status !== 'processing_failed' || !turn.answerSubmissionKey) {
    throw new InterviewConflictError('当前回答不处于可重试状态')
  }

  const operationKey = `interview_turn:${turnId}:${turn.answerSubmissionKey}`
  clearModelRequestCancellation(operationKey)
  const existingRuns = await interviewRepository.findAgentRunsByOperationKey(operationKey)
  const answer = turn.answer ?? getCandidateAnswerFromRunInput(existingRuns[0]?.input)
  if (!answer) throw new InterviewConflictError('当前失败任务缺少原回答，无法重新分析')

  const attemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const startedAt = new Date().toISOString()
  const runInput = buildInterviewTurnRunInput(detail, turn, answer)
  const runId = crypto.randomUUID()
  const run = createInterviewTurnAgentRun({
    id: runId,
    sessionId,
    turnId,
    operationKey,
    attemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: interviewTurnPromptVersion,
    startedAt,
  })
  const restarted = await interviewRepository.restartFailedInterviewTurn({
    sessionId,
    turnId,
    expectedStateVersion: session.stateVersion,
    answer,
    now: startedAt,
    run,
  })

  void executeInterviewTurn({
    sessionId,
    turnId,
    operationKey,
    answer,
    clientSubmissionId: turn.answerSubmissionKey,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
    firstRunId: runId,
    firstAttemptNumber: attemptNumber,
    expectedStateVersion: restarted.session.stateVersion,
  })
    .catch((error: unknown) => {
      console.error('Interview turn retry background execution crashed', {
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return getInterviewSession(sessionId)
}

export async function skipInterviewTurn(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = skipInterviewTurnInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  assertSessionModelConnection(session, parsedInput.modelConnection)
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new InterviewConflictError('只能跳过当前进行中的问题')
  }

  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
  const currentTurn = detail.turns.find((item) => item.id === turnId)
  if (!currentTurn || currentTurn.status !== 'awaiting_answer') {
    throw new InterviewConflictError('AI 正在输出或当前问题已变化，不能跳过')
  }

  const startedAt = new Date().toISOString()
  const turnWithSkip = {
    ...currentTurn,
    skip: { reason: parsedInput.reason, note: parsedInput.note, skippedAt: startedAt },
  }
  const runInput = buildInterviewSkipRunInput(detail, turnWithSkip)
  const operationKey = `interview_skip:${turnId}`
  const existingRuns = await interviewRepository.findAgentRunsByOperationKey(operationKey)
  const attemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const runId = crypto.randomUUID()
  const run = createInterviewTurnAgentRun({
    id: runId,
    sessionId,
    turnId,
    operationKey,
    attemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: interviewSkipPromptVersion,
    startedAt,
  })
  const started = await interviewRepository.startInterviewSkipRun({
    sessionId,
    turnId,
    expectedStateVersion: session.stateVersion,
    skip: turnWithSkip.skip,
    now: startedAt,
    run,
  })

  void executeInterviewSkip({
    sessionId,
    turnId,
    operationKey,
    expectedStateVersion: started.session.stateVersion,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
    firstRunId: runId,
    firstAttemptNumber: attemptNumber,
  })
    .catch((error: unknown) => {
      console.error('Interview skip background execution crashed', {
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return getInterviewSession(sessionId)
}

export async function retryInterviewSkip(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = retryInterviewAnswerInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  assertSessionModelConnection(session, parsedInput.modelConnection)
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new InterviewConflictError('只能重试当前问题的跳过任务')
  }

  const detail = await interviewRepository.findSessionDetail(sessionId)
  if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
  const turn = detail.turns.find((item) => item.id === turnId)
  if (!turn || turn.status !== 'processing_failed' || !turn.skip) {
    throw new InterviewConflictError('当前问题不处于可重试的跳过状态')
  }

  const operationKey = `interview_skip:${turnId}`
  const existingRuns = await interviewRepository.findAgentRunsByOperationKey(operationKey)
  const attemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const startedAt = new Date().toISOString()
  const runInput = buildInterviewSkipRunInput(detail, turn)
  const runId = crypto.randomUUID()
  const run = createInterviewTurnAgentRun({
    id: runId,
    sessionId,
    turnId,
    operationKey,
    attemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: interviewSkipPromptVersion,
    startedAt,
  })
  const restarted = await interviewRepository.restartFailedInterviewSkip({
    sessionId,
    turnId,
    expectedStateVersion: session.stateVersion,
    now: startedAt,
    run,
  })

  void executeInterviewSkip({
    sessionId,
    turnId,
    operationKey,
    expectedStateVersion: restarted.session.stateVersion,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
    firstRunId: runId,
    firstAttemptNumber: attemptNumber,
  })
    .catch((error: unknown) => {
      console.error('Interview skip retry background execution crashed', {
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    })
    .finally(() => clearModelRequestCancellation(operationKey))

  return getInterviewSession(sessionId)
}

export async function cancelInterviewAnswer(sessionId: string, turnId: string, input: unknown) {
  const parsedInput = cancelInterviewAnswerInputSchema.parse(input)
  const session = await requireOwnedSession(sessionId)
  if (session.status !== 'active' || session.currentTurnId !== turnId) {
    throw new InterviewConflictError('只能中止当前进行中的回答')
  }

  const turn = await interviewRepository.findTurnById(turnId)
  if (!turn || turn.sessionId !== sessionId) throw new InterviewNotFoundError('当前问题不存在')
  if (
    parsedInput.clientSubmissionId &&
    turn.answerSubmissionKey &&
    parsedInput.clientSubmissionId !== turn.answerSubmissionKey
  ) {
    throw new InterviewConflictError('回答提交标识已变化，不能中止旧任务')
  }

  const submissionId = turn.answerSubmissionKey ?? parsedInput.clientSubmissionId
  if (!submissionId) throw new InterviewConflictError('当前没有可中止的回答任务')
  const operationKey = `interview_turn:${turnId}:${submissionId}`
  cancelModelRequest(operationKey)

  if (turn.status !== 'awaiting_answer' && turn.status !== 'processing') {
    throw new InterviewConflictError('当前回答已不处于可中止状态')
  }

  // 即使 Answer 请求尚未落库，也要递增 Session 版本形成持久化取消屏障。
  // 这样已经读取旧 stateVersion 的 Answer 请求会在事务中回滚，不能在 Cancel 返回后再次抢占当前 Turn。
  await interviewRepository.cancelInterviewTurnRun({
    sessionId,
    turnId,
    cancelledAt: new Date().toISOString(),
  })
  return getInterviewSession(sessionId)
}

type InterviewPlanExecutionContext = {
  sessionId: string
  expectedStateVersion: number
  input: InterviewPlanRunInput
  modelConnection: ModelConnection
}

type InterviewTurnExecutionContext = {
  sessionId: string
  turnId: string
  operationKey: string
  clientSubmissionId: string
  expectedStateVersion: number
  answer: InterviewAnswerContent
  input: InterviewTurnRunInput
  modelConnection: ModelConnection
  firstRunId: string
  firstAttemptNumber: number
}

type InterviewSkipExecutionContext = {
  sessionId: string
  turnId: string
  operationKey: string
  expectedStateVersion: number
  input: InterviewSkipRunInput
  modelConnection: ModelConnection
  firstRunId: string
  firstAttemptNumber: number
}

type AnswerDeepEvaluationExecutionContext = {
  sessionId: string
  turnId: string
  operationKey: string
  input: AnswerDeepEvaluationRunInput
  modelConnection: ModelConnection
  firstRunId: string
  firstAttemptNumber: number
}

const maxInterviewPlanAttempts = 3
const maxInterviewTurnAttempts = 3
const maxAnswerDeepEvaluationAttempts = 3
const interviewPlanRepairPromptVersion = 'mock-interview.v1.repair'
const interviewTurnPromptVersion = 'mock-interview-turn.v6'
const interviewTurnRepairPromptVersion = 'mock-interview-turn.v6.repair'
const interviewSkipPromptVersion = 'mock-interview-skip.v2'
const interviewSkipRepairPromptVersion = 'mock-interview-skip.v2.repair'
const answerDeepEvaluationPromptVersion = 'mock-interview-deep-evaluation.v3'
const answerDeepEvaluationRepairPromptVersion = 'mock-interview-deep-evaluation.v3.repair'
const interviewPlanRetryDelaysMs = [0, 2_000, 5_000]
const interviewTurnRetryDelaysMs = [0, 1_000, 2_000]
const answerDeepEvaluationRetryDelaysMs = [0, 1_000, 2_000]

function materializeInterviewPlan(sessionId: string, output: InterviewPlanModelOutput, createdAt: string) {
  const topics = output.topics.map((topic) => ({
    ...topic,
    id: crypto.randomUUID(),
    evaluationPoints: topic.evaluationPoints.map((point) => ({
      ...point,
      id: crypto.randomUUID(),
    })),
  }))

  const firstTopic = topics.find((topic) => topic.key === output.firstQuestion.topicKey)

  if (!firstTopic) {
    throw new Error('首题关联的面试主题不存在')
  }

  const { hints, ...question } = output.firstQuestion

  return {
    assessmentPlan: {
      difficultyRubric: output.difficultyRubric,
      topics,
    },
    firstTurn: {
      id: crypto.randomUUID(),
      sessionId,
      assessmentPlanId: firstTopic.id,
      rootTurnId: null,
      parentTurnId: null,
      kind: 'main' as const,
      sequenceNumber: 1,
      mainQuestionNumber: 1,
      followUpNumber: 0,
      question,
      hints,
      answer: null,
      hintUsage: 'none' as const,
      skip: null,
      answerEvidence: null,
      answerSubmissionKey: null,
      status: 'awaiting_answer' as const,
      createdAt,
      completedAt: null,
      updatedAt: createdAt,
    },
  }
}

async function executeInterviewPlan(context: InterviewPlanExecutionContext) {
  let repairContext: ValidationRepairContext | null = null
  const operationKey = `interview_plan:${context.sessionId}`

  const existingRuns = await interviewRepository.findInterviewPlanRunsBySessionId(context.sessionId)

  let attemptNumber = existingRuns[0]?.attemptNumber ?? 0

  for (let localAttempt = 1; localAttempt <= maxInterviewPlanAttempts; localAttempt += 1) {
    if (isModelRequestCancelled(operationKey)) return
    attemptNumber += 1

    const runId = crypto.randomUUID()
    const queuedAt = new Date().toISOString()

    const isRepairAttempt = repairContext !== null

    await interviewRepository.createInterviewPlanRun({
      id: runId,
      workflowType: 'interview_plan',
      analysisId: null,
      interviewSessionId: context.sessionId,
      interviewTurnId: null,

      operationKey: `interview_plan:${context.sessionId}`,

      attemptNumber,
      status: 'pending',
      modelName: context.modelConnection.modelName,
      promptVersion: isRepairAttempt ? interviewPlanRepairPromptVersion : interviewPromptVersion,

      input: context.input,
      startedAt: queuedAt,
    })

    const startedAt = new Date().toISOString()

    await interviewRepository.markInterviewPlanRunProcessing({
      sessionId: context.sessionId,
      runId,
      startedAt,
    })
    // 3. 调用模型
    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null
    let modelOutput: InterviewPlanModelOutput
    let validationIssues: AgentRunError['validationIssues']

    try {
      const completion = await requestModelCompletion(
        operationKey,
        context.modelConnection,
        buildInterviewPlanSystemPrompt(),
        repairContext
          ? buildInterviewPlanRepairPrompt(context.input, repairContext)
          : buildInterviewPlanUserPrompt(context.input),
      )

      rawOutput = completion.rawOutput

      tokenUsage = completion.tokenUsage

      try {
        modelOutput = parseInterviewPlanModelOutput(rawOutput)
      } catch (error) {
        const nextRepairContext =
          error instanceof ZodError
            ? createValidationRepairContext(rawOutput, error)
            : createJsonSyntaxRepairContext(rawOutput, error)

        repairContext = nextRepairContext
        validationIssues = nextRepairContext.validationIssues

        throw new ModelRequestError(
          '面试计划未通过结构化校验',
          'structured_output_validation_failed',
          true,
          rawOutput,
          tokenUsage,
        )
      }

      // 5. 成功后生成数据库对象并完成事务
      const finishedAt = new Date().toISOString()

      const { assessmentPlan, firstTurn } = materializeInterviewPlan(context.sessionId, modelOutput, finishedAt)

      const evaluation = createInitialEvaluation()

      evaluation.coverage.plannedTopics = assessmentPlan.topics.length

      return interviewRepository.completeInterviewPlanRun({
        sessionId: context.sessionId,
        runId,
        expectedStateVersion: context.expectedStateVersion,
        assessmentPlan,
        modelOutput,
        firstTurn,
        evaluation,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
    } catch (error) {
      if (isModelRequestCancelled(operationKey) || (error instanceof ModelRequestError && error.code === 'cancelled')) {
        return
      }

      const finishedAt = new Date().toISOString()

      const runError: AgentRunError =
        error instanceof ModelRequestError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              validationIssues: error.code === 'structured_output_validation_failed' ? validationIssues : undefined,
            }
          : {
              code: 'unknown',
              message: error instanceof Error ? error.message : '模拟面试计划生成发生未知错误',
              retryable: false,
            }

      await interviewRepository.failInterviewPlanRun({
        sessionId: context.sessionId,
        runId,
        error: runError,

        rawOutput: error instanceof ModelRequestError ? (error.rawOutput ?? rawOutput) : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? (error.tokenUsage ?? tokenUsage) : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })

      const canRetry = runError.retryable && localAttempt < maxInterviewPlanAttempts

      if (!canRetry) {
        await interviewRepository.markInterviewPlanFailed({
          sessionId: context.sessionId,
          expectedStateVersion: context.expectedStateVersion,
          failedAt: finishedAt,
        })
        return
      }
      await delay(interviewPlanRetryDelaysMs[localAttempt] ?? 0)
    }
  }
}

async function executeInterviewTurn(context: InterviewTurnExecutionContext) {
  let repairContext: ValidationRepairContext | null = null
  let runId = context.firstRunId
  let attemptNumber = context.firstAttemptNumber

  for (let localAttempt = 1; localAttempt <= maxInterviewTurnAttempts; localAttempt += 1) {
    if (isModelRequestCancelled(context.operationKey)) return
    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null
    let modelOutput: InterviewTurnModelOutput
    let validationIssues: AgentRunError['validationIssues']

    if (localAttempt > 1) {
      if (isModelRequestCancelled(context.operationKey)) return
      attemptNumber += 1
      runId = crypto.randomUUID()
      const retryStartedAt = new Date().toISOString()
      await interviewRepository.createInterviewTurnRetryRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        run: createInterviewTurnAgentRun({
          id: runId,
          sessionId: context.sessionId,
          turnId: context.turnId,
          operationKey: context.operationKey,
          attemptNumber,
          runInput: context.input,
          modelName: context.modelConnection.modelName,
          promptVersion: interviewTurnRepairPromptVersion,
          startedAt: retryStartedAt,
        }),
      })
    }

    try {
      const completion = await requestModelCompletion(
        context.operationKey,
        context.modelConnection,
        buildInterviewTurnSystemPrompt(),
        repairContext
          ? buildInterviewTurnRepairPrompt(context.input, repairContext)
          : buildInterviewTurnUserPrompt(context.input),
      )

      rawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage

      try {
        modelOutput = parseInterviewTurnModelOutput(rawOutput, context.input)
      } catch (error) {
        const nextRepairContext =
          error instanceof ZodError
            ? createValidationRepairContext(rawOutput, error)
            : createJsonSyntaxRepairContext(rawOutput, error)

        repairContext = nextRepairContext
        validationIssues = nextRepairContext.validationIssues

        throw new ModelRequestError(
          '回答处理结果未通过结构化校验',
          'structured_output_validation_failed',
          true,
          rawOutput,
          tokenUsage,
        )
      }

      const detail = await interviewRepository.findSessionDetail(context.sessionId)
      if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
      const session = detail.session
      const turn = detail.turns.find((item) => item.id === context.turnId)
      if (!turn) throw new InterviewNotFoundError('当前问题不存在')
      const assessmentPlan = session.assessmentPlan
      if (!assessmentPlan) throw new InterviewConflictError('模拟面试计划尚未生成')
      const currentTopic = findPlanTopic(assessmentPlan, turn.question.topicKey)
      const finishedAt = new Date().toISOString()

      if (
        modelOutput.inputClassification === 'clarification_request' ||
        modelOutput.inputClassification === 'off_topic'
      ) {
        if (!modelOutput.clarificationResponse) throw new InterviewConflictError('模型未返回澄清或跑题引导内容')

        const existingInteractionCount = detail.interactions.filter((item) => item.turnId === context.turnId).length
        const interactions = buildTurnInteractions({
          turnId: context.turnId,
          clientSubmissionId: context.clientSubmissionId,
          content: context.answer.content,
          submittedAt: context.answer.submittedAt,
          responseContent: modelOutput.clarificationResponse.content,
          existingCount: existingInteractionCount,
          classification: modelOutput.inputClassification,
          createdAt: finishedAt,
        })

        await interviewRepository.completeInterviewTurnWithInteraction({
          sessionId: context.sessionId,
          turnId: context.turnId,
          runId,
          expectedStateVersion: context.expectedStateVersion,
          modelOutput,
          ...interactions,
          rawOutput,
          tokenUsage,
          durationMs: Date.now() - startedAtMs,
          finishedAt,
        })
        return
      }

      if (!modelOutput.answerEvidence) throw new InterviewConflictError('模型未返回回答证据')

      const answerEvidence = mapAnswerEvidenceToPersisted(currentTopic, modelOutput.answerEvidence)
      const forceFinal = modelOutput.nextAction.type === 'finish_session'
      const finalReview =
        forceFinal && modelOutput.finalReview
          ? materializeFinalReview(modelOutput.finalReview, detail.turns, finishedAt)
          : null
      const evaluation = applySessionEvaluation(
        detail,
        assessmentPlan,
        turn,
        modelOutput.answerEvidence,
        modelOutput.sessionEvaluationPatch,
        forceFinal,
        finalReview,
      )

      if (modelOutput.nextAction.type === 'finish_session') {
        const finalEvaluation = evaluation.finalReview
          ? evaluation
          : { ...evaluation, finalReview: buildFallbackFinalReview(evaluation, detail.turns, finishedAt) }
        await interviewRepository.completeInterviewSessionFromTurn({
          sessionId: context.sessionId,
          turnId: context.turnId,
          runId,
          expectedStateVersion: context.expectedStateVersion,
          answer: context.answer,
          answerEvidence,
          modelOutput,
          evaluation: finalEvaluation,
          evidenceStatus: getEvidenceStatus(finalEvaluation),
          latestOverallScore: finalEvaluation.score,
          rawOutput,
          tokenUsage,
          durationMs: Date.now() - startedAtMs,
          finishedAt,
        })
        return
      }

      if (modelOutput.nextAction.type !== 'ask_follow_up' && modelOutput.nextAction.type !== 'ask_next_topic') {
        throw new InterviewConflictError('模型返回了无法创建下一题的动作')
      }
      if (!modelOutput.nextQuestion) throw new InterviewConflictError('模型未返回下一题')

      const nextTurn = materializeNextTurn(
        context.sessionId,
        turn,
        assessmentPlan,
        modelOutput.nextQuestion,
        modelOutput.nextAction.type,
        finishedAt,
      )

      await interviewRepository.completeInterviewTurnWithNextQuestion({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        expectedStateVersion: context.expectedStateVersion,
        answer: context.answer,
        answerEvidence,
        modelOutput,
        nextTurn,
        evaluation,
        latestOverallScore: evaluation.score,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
      return
    } catch (error) {
      if (
        isModelRequestCancelled(context.operationKey) ||
        (error instanceof ModelRequestError && error.code === 'cancelled')
      ) {
        return
      }

      const finishedAt = new Date().toISOString()
      const runError: AgentRunError =
        error instanceof ModelRequestError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              validationIssues: error.code === 'structured_output_validation_failed' ? validationIssues : undefined,
            }
          : {
              code: 'unknown',
              message: error instanceof Error ? error.message : '模拟面试回答处理发生未知错误',
              retryable: false,
            }

      const canRetry = runError.retryable && localAttempt < maxInterviewTurnAttempts
      await interviewRepository.failInterviewTurnRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        error: runError,
        rawOutput: error instanceof ModelRequestError ? (error.rawOutput ?? rawOutput) : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? (error.tokenUsage ?? tokenUsage) : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
        finalFailure: !canRetry,
      })

      if (!canRetry) return
      await delay(interviewTurnRetryDelaysMs[localAttempt] ?? 0)
    }
  }
}

async function executeInterviewSkip(context: InterviewSkipExecutionContext) {
  let repairContext: ValidationRepairContext | null = null
  let runId = context.firstRunId
  let attemptNumber = context.firstAttemptNumber

  for (let localAttempt = 1; localAttempt <= maxInterviewTurnAttempts; localAttempt += 1) {
    if (isModelRequestCancelled(context.operationKey)) return
    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null
    let modelOutput: InterviewSkipModelOutput
    let validationIssues: AgentRunError['validationIssues']

    if (localAttempt > 1) {
      if (isModelRequestCancelled(context.operationKey)) return
      attemptNumber += 1
      runId = crypto.randomUUID()
      const retryStartedAt = new Date().toISOString()
      await interviewRepository.createInterviewTurnRetryRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        run: createInterviewTurnAgentRun({
          id: runId,
          sessionId: context.sessionId,
          turnId: context.turnId,
          operationKey: context.operationKey,
          attemptNumber,
          runInput: context.input,
          modelName: context.modelConnection.modelName,
          promptVersion: interviewSkipRepairPromptVersion,
          startedAt: retryStartedAt,
        }),
      })
    }

    try {
      const completion = await requestModelCompletion(
        context.operationKey,
        context.modelConnection,
        buildInterviewSkipSystemPrompt(),
        repairContext
          ? buildInterviewSkipRepairPrompt(context.input, repairContext)
          : buildInterviewSkipUserPrompt(context.input),
      )
      rawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage

      try {
        modelOutput = parseInterviewSkipModelOutput(rawOutput, context.input)
      } catch (error) {
        const nextRepairContext =
          error instanceof ZodError
            ? createValidationRepairContext(rawOutput, error)
            : createJsonSyntaxRepairContext(rawOutput, error)
        repairContext = nextRepairContext
        validationIssues = nextRepairContext.validationIssues
        throw new ModelRequestError(
          '跳过后的问题调度结果未通过结构化校验',
          'structured_output_validation_failed',
          true,
          rawOutput,
          tokenUsage,
        )
      }

      const detail = await interviewRepository.findSessionDetail(context.sessionId)
      if (!detail) throw new InterviewNotFoundError('模拟面试不存在')
      const turn = detail.turns.find((item) => item.id === context.turnId)
      const assessmentPlan = detail.session.assessmentPlan
      if (!turn || !turn.skip) throw new InterviewNotFoundError('当前跳过问题不存在')
      if (!assessmentPlan) throw new InterviewConflictError('模拟面试计划尚未生成')

      const finishedAt = new Date().toISOString()
      const currentEvaluation = detail.evaluation?.result ?? createInitialEvaluation()
      const skipEvaluation =
        turn.skip.reason === 'unknown'
          ? applyExplicitUnknownSkipEvaluation(
              currentEvaluation,
              assessmentPlan,
              findPlanTopic(assessmentPlan, turn.question.topicKey),
              turn.id,
            )
          : null
      if (modelOutput.nextAction.type === 'finish_session') {
        const evaluation: InterviewSessionEvaluation = {
          ...(skipEvaluation ?? currentEvaluation),
          status: (skipEvaluation ?? currentEvaluation).score === null ? 'insufficient' : 'final',
        }
        const finalEvaluation = evaluation.finalReview
          ? evaluation
          : { ...evaluation, finalReview: buildFallbackFinalReview(evaluation, detail.turns, finishedAt) }
        await interviewRepository.completeInterviewSessionFromSkip({
          sessionId: context.sessionId,
          turnId: context.turnId,
          runId,
          expectedStateVersion: context.expectedStateVersion,
          modelOutput,
          evaluation: finalEvaluation,
          evidenceStatus: getEvidenceStatus(finalEvaluation),
          rawOutput,
          tokenUsage,
          durationMs: Date.now() - startedAtMs,
          finishedAt,
        })
        return
      }

      if (!modelOutput.nextQuestion) throw new InterviewConflictError('模型未返回跳过后的下一题')
      const nextTurn = materializeTurnAfterSkip(
        context.sessionId,
        turn,
        assessmentPlan,
        modelOutput.nextQuestion,
        context.input.consumesBudget,
        finishedAt,
      )
      await interviewRepository.completeInterviewSkipWithNextQuestion({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        expectedStateVersion: context.expectedStateVersion,
        modelOutput,
        nextTurn,
        evaluation: skipEvaluation,
        latestOverallScore: skipEvaluation?.score ?? detail.session.latestOverallScore,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
      return
    } catch (error) {
      if (
        isModelRequestCancelled(context.operationKey) ||
        (error instanceof ModelRequestError && error.code === 'cancelled')
      ) {
        return
      }

      const finishedAt = new Date().toISOString()
      const runError: AgentRunError =
        error instanceof ModelRequestError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              validationIssues: error.code === 'structured_output_validation_failed' ? validationIssues : undefined,
            }
          : {
              code: 'unknown',
              message: error instanceof Error ? error.message : '跳过后的问题调度发生未知错误',
              retryable: false,
            }
      const canRetry = runError.retryable && localAttempt < maxInterviewTurnAttempts
      await interviewRepository.failInterviewTurnRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        error: runError,
        rawOutput: error instanceof ModelRequestError ? (error.rawOutput ?? rawOutput) : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? (error.tokenUsage ?? tokenUsage) : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
        finalFailure: !canRetry,
      })

      if (!canRetry) return
      await delay(interviewTurnRetryDelaysMs[localAttempt] ?? 0)
    }
  }
}

async function executeAnswerDeepEvaluation(context: AnswerDeepEvaluationExecutionContext) {
  let repairContext: ValidationRepairContext | null = null
  let runId = context.firstRunId
  let attemptNumber = context.firstAttemptNumber

  for (let localAttempt = 1; localAttempt <= maxAnswerDeepEvaluationAttempts; localAttempt += 1) {
    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null
    let modelOutput: AnswerDeepEvaluationModelOutput
    let validationIssues: AgentRunError['validationIssues']

    if (localAttempt > 1) {
      attemptNumber += 1
      runId = crypto.randomUUID()
      const retryStartedAt = new Date().toISOString()
      await interviewRepository.createAnswerDeepEvaluationRetryRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        run: createAnswerDeepEvaluationAgentRun({
          id: runId,
          sessionId: context.sessionId,
          turnId: context.turnId,
          operationKey: context.operationKey,
          attemptNumber,
          runInput: context.input,
          modelName: context.modelConnection.modelName,
          promptVersion: answerDeepEvaluationRepairPromptVersion,
          startedAt: retryStartedAt,
        }),
      })
    }

    try {
      const completion = await requestModelCompletion(
        context.operationKey,
        context.modelConnection,
        buildAnswerDeepEvaluationSystemPrompt(),
        repairContext
          ? buildAnswerDeepEvaluationRepairPrompt(context.input, repairContext)
          : buildAnswerDeepEvaluationUserPrompt(context.input),
      )
      rawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage

      try {
        modelOutput = parseAnswerDeepEvaluationModelOutput(rawOutput, context.input)
      } catch (error) {
        const nextRepairContext =
          error instanceof ZodError
            ? createValidationRepairContext(rawOutput, error)
            : createJsonSyntaxRepairContext(rawOutput, error)
        repairContext = nextRepairContext
        validationIssues = nextRepairContext.validationIssues
        throw new ModelRequestError(
          '单回答深度点评未通过结构化校验',
          'structured_output_validation_failed',
          true,
          rawOutput,
          tokenUsage,
        )
      }

      const result = answerDeepEvaluationResultSchema.parse(
        materializeAnswerDeepEvaluationResult(context.input, modelOutput),
      )
      const finishedAt = new Date().toISOString()
      await interviewRepository.completeAnswerDeepEvaluationRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        modelOutput,
        result,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
      return
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const runError: AgentRunError =
        error instanceof ModelRequestError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              validationIssues: error.code === 'structured_output_validation_failed' ? validationIssues : undefined,
            }
          : {
              code: 'unknown',
              message: error instanceof Error ? error.message : '单回答深度点评发生未知错误',
              retryable: false,
            }
      const canRetry = runError.retryable && localAttempt < maxAnswerDeepEvaluationAttempts
      await interviewRepository.failAnswerDeepEvaluationRun({
        sessionId: context.sessionId,
        turnId: context.turnId,
        runId,
        error: runError,
        rawOutput: error instanceof ModelRequestError ? (error.rawOutput ?? rawOutput) : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? (error.tokenUsage ?? tokenUsage) : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
        finalFailure: !canRetry,
      })

      if (!canRetry) return
      await delay(answerDeepEvaluationRetryDelaysMs[localAttempt] ?? 0)
    }
  }
}
