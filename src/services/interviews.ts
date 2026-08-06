import type {
  AnswerDeepReview,
  AnswerEvaluation,
  CreateInterviewPayload,
  InterviewAnswer,
  InterviewBudget,
  InterviewInteraction,
  InterviewConfig,
  InterviewPhase,
  InterviewOverview,
  InterviewOverallScore,
  InterviewQuestion,
  InterviewQuestionFeedback,
  InterviewReview,
  InterviewSession,
  InterviewSessionSummary,
  SkipReason,
} from '@/types/interview'
import type { LlmConnectionSettings } from '@/types/settings'
import type { AiTaskError } from '@/types/ai'
import type {
  AnswerEvidence,
  InterviewAnswerContent,
  InterviewConfiguration,
  InterviewQuestionHints,
  InterviewSessionEvaluation,
  InterviewSessionStatus,
  InterviewTurnKind,
  InterviewTurnStatus,
  AnswerDeepEvaluationResult,
} from '@/shared/interview/schemas'
import { request, type RequestOptions } from './http'

type InterviewSessionSummaryDto = {
  id: string
  opportunityId: string
  configuration: InterviewConfiguration
  modelName: string
  modelBaseUrl: string
  status: InterviewSessionStatus
  evidenceStatus: string
  latestOverallScore: number | null
  answeredQuestionCount: number
  validAnswerCount: number
  primaryStrength: string | null
  primaryGap: string | null
  createdAt: string
  startedAt: string | null
  lastActiveAt: string
  endedAt: string | null
}

type PublicInterviewSessionDto = InterviewSessionSummaryDto & {
  currentTurnId: string | null
  endReason: string | null
  overallScoreStatus: InterviewSessionEvaluation['status']
  stateVersion: number
  updatedAt: string
}

export type InterviewSessionStatusSnapshot = {
  status: InterviewSessionStatus
  phase: InterviewPhase
  stateVersion: number
  currentTurnId: string | null
  updatedAt: string
  error: { code: string; message: string } | null
}

type PublicInterviewTurnDto = {
  id: string
  sessionId: string
  assessmentPlanId: string
  rootTurnId: string | null
  parentTurnId: string | null
  kind: InterviewTurnKind
  sequenceNumber: number
  mainQuestionNumber: number
  followUpNumber: number
  question: {
    topicKey: string
    targetEvaluationPointKeys: string[]
    format: 'single' | 'compound'
    content: string
    subQuestions: string[]
    focusLabel: string
  }
  hints: InterviewQuestionHints
  answer: InterviewAnswerContent | null
  hintUsage: InterviewQuestion['revealedHintLevel']
  skip: {
    reason: SkipReason
    note: string | null
    skippedAt: string
  } | null
  answerEvidence: AnswerEvidence | null
  answerSubmissionKey: string | null
  status: InterviewTurnStatus
  createdAt: string
  completedAt: string | null
  updatedAt: string
}

type PublicInterviewInteractionDto = {
  id: string
  turnId: string
  role: 'candidate' | 'interviewer'
  type: 'clarification_request' | 'clarification_response' | 'off_topic_message' | 'off_topic_redirect'
  content: string
  submittedAt: string | null
  createdAt: string
}

type PublicInterviewEvaluationDto = {
  result: InterviewSessionEvaluation
  updatedAt: string
  finalizedAt: string | null
}

type PublicInterviewDeepEvaluationDto = {
  turnId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: AnswerDeepEvaluationResult | null
  error: AiTaskError | null
  createdAt?: string
  updatedAt?: string
  completedAt: string | null
}

type PublicInterviewFeedbackDto = {
  turnId: string
  rating: 'like' | 'dislike'
  reasons: string[]
  comment: string | null
  lockedAt: string | null
  updatedAt: string
}

type InterviewSessionDetailDto = {
  session: PublicInterviewSessionDto
  topics: Array<{
    key: string
    label: string
  }>
  turns: PublicInterviewTurnDto[]
  interactions: PublicInterviewInteractionDto[]
  evaluation: PublicInterviewEvaluationDto | null
  deepEvaluations: PublicInterviewDeepEvaluationDto[]
  feedback: PublicInterviewFeedbackDto[]
  taskError: AiTaskError | null
}

export type SubmitInterviewAnswerPayload = {
  content: string
  clientSubmissionId: string
  submittedAt: string
  hintUsage: InterviewQuestion['revealedHintLevel']
  modelConnection: LlmConnectionSettings
}

export function getInterviewBudget(config: InterviewConfig): InterviewBudget {
  const scaleMap = {
    quick: { mainTopicBudget: 3, totalQuestionBudget: 5 },
    standard: { mainTopicBudget: 5, totalQuestionBudget: 9 },
    deep: { mainTopicBudget: 8, totalQuestionBudget: 14 },
  } as const
  const budget = scaleMap[config.scale]

  return { ...budget, maxFollowUpsPerRoot: 3 }
}

function stripBudget(configuration: InterviewConfiguration): InterviewConfig {
  const { budget: _, ...config } = configuration
  return config
}

function createEmptyOverallScore(): InterviewOverallScore {
  return {
    state: 'evaluating',
    score: null,
    coverage: 0,
    summary: '完成至少三次有效回答后，将展示暂定整体评估。',
    dimensions: [
      { key: 'mastery', label: '岗位能力掌握', score: null },
      { key: 'communication', label: '表达与沟通', score: null },
    ],
  }
}

function getPhaseFromSession(
  session: PublicInterviewSessionDto | InterviewSessionSummaryDto,
  currentTurn?: PublicInterviewTurnDto,
) {
  if (session.status === 'preparing') return 'building_plan'
  if (session.status === 'preparation_failed') return 'preparation_failed'
  if (session.status === 'finalizing') return 'generating_review'
  if (session.status === 'completed' || session.status === 'ended_early' || session.status === 'cancelled') {
    return 'review_ready'
  }
  if (!currentTurn) return 'generating_question'
  if (currentTurn.status === 'awaiting_answer') return 'awaiting_answer'
  if (currentTurn.status === 'processing') return currentTurn.skip ? 'generating_question' : 'evaluating_answer'
  if (currentTurn.status === 'processing_failed') {
    return currentTurn.skip ? 'question_generation_failed' : 'answer_processing_failed'
  }

  return 'generating_question'
}

function getQuestionRelation(kind: InterviewTurnKind): InterviewQuestion['relation'] {
  return kind === 'follow_up' ? 'follow_up' : 'main'
}

function toQuestion(turn: PublicInterviewTurnDto): InterviewQuestion {
  return {
    id: turn.id,
    sequence: turn.sequenceNumber,
    relation: getQuestionRelation(turn.kind),
    format: turn.question.format,
    rootQuestionId: turn.rootTurnId ?? turn.id,
    followUpCount: turn.followUpNumber,
    content: turn.question.content,
    subQuestions: turn.question.subQuestions,
    focusLabel: turn.question.focusLabel,
    hintLevel1: turn.hints.level1,
    hintLevel2: turn.hints.level2,
    revealedHintLevel: turn.hintUsage,
    feedback: null,
    createdAt: turn.createdAt,
  }
}

function average(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

function getOutcome(score: number, evidence: AnswerEvidence): AnswerEvaluation['outcome'] {
  if (evidence.relevance === 'off_topic') return 'unable_to_assess'
  if (evidence.explicitlyUnknown) return 'weak'
  if (score >= 85) return 'mastered'
  if (score >= 70) return 'mostly_correct'
  if (score >= 45) return 'partial'
  if (score > 0) return 'weak'
  return 'incorrect'
}

function toAnswerEvaluation(evidence: AnswerEvidence | null): AnswerEvaluation | null {
  if (!evidence) return null

  const pointScores = evidence.pointResults.map((point) => point.score)
  const score = average(pointScores)

  return {
    qualityScore: score,
    coverageScore: score,
    confidence: evidence.confidence === 'high' ? 0.9 : evidence.confidence === 'medium' ? 0.7 : 0.5,
    outcome: getOutcome(score, evidence),
    evidence: evidence.summary,
    missedPoints: evidence.pointResults
      .filter((point) => point.status !== 'covered')
      .map((point) => point.evidence ?? '该评估点覆盖不足。')
      .slice(0, 4),
  }
}

function toAnswer(
  turn: PublicInterviewTurnDto,
  deepEvaluation: PublicInterviewDeepEvaluationDto | undefined,
): InterviewAnswer | null {
  if (!turn.answer) return null

  return {
    id: turn.id,
    questionId: turn.id,
    clientSubmissionId: turn.answerSubmissionKey ?? undefined,
    content: turn.answer.content,
    assistanceLevel: turn.hintUsage,
    submittedAt: turn.answer.submittedAt,
    evaluation: toAnswerEvaluation(turn.answerEvidence),
    deepReviewStatus: deepEvaluation?.status === 'pending' ? 'processing' : (deepEvaluation?.status ?? 'idle'),
    deepReviewError: deepEvaluation?.error ?? null,
    deepReview: deepEvaluation?.result ? toAnswerDeepReview(deepEvaluation) : null,
  }
}

function toAnswerDeepReview(evaluation: PublicInterviewDeepEvaluationDto): AnswerDeepReview | null {
  if (!evaluation.result || evaluation.status !== 'completed') return null

  return {
    ...evaluation.result,
    createdAt: evaluation.completedAt ?? evaluation.updatedAt ?? evaluation.createdAt ?? new Date(0).toISOString(),
  }
}

function toAnswerDeepEvaluationState(evaluation: PublicInterviewDeepEvaluationDto) {
  return {
    status: evaluation.status === 'pending' ? ('processing' as const) : evaluation.status,
    error: evaluation.error,
    review: toAnswerDeepReview(evaluation),
  }
}

function toInteractions(interactions: PublicInterviewInteractionDto[]): InterviewInteraction[] {
  return interactions.map((interaction) => ({
    id: interaction.id,
    questionId: interaction.turnId,
    role: interaction.role,
    type: interaction.type,
    content: interaction.content,
    submittedAt: interaction.submittedAt,
    createdAt: interaction.createdAt,
  }))
}

function toQuestionFeedback(feedback: PublicInterviewFeedbackDto): InterviewQuestionFeedback {
  return {
    value: feedback.rating,
    reason: feedback.comment ?? feedback.reasons[0] ?? '',
    submittedAt: feedback.updatedAt,
    locked: Boolean(feedback.lockedAt),
  }
}

function toOverallScore(
  evaluation: PublicInterviewEvaluationDto | null,
  sessionStatus: InterviewSessionStatus,
  topics: InterviewSessionDetailDto['topics'],
): InterviewOverallScore {
  if (!evaluation) return createEmptyOverallScore()

  const result = evaluation.result
  const plannedTopics = result.coverage.plannedTopics
  const coverage = plannedTopics > 0 ? Math.round((result.coverage.evaluatedTopics / plannedTopics) * 100) : 0
  const topicLabelByKey = new Map(topics.map((topic) => [topic.key, topic.label]))

  return {
    state: sessionStatus === 'ended_early' ? 'partial' : result.status,
    score: result.score,
    coverage,
    summary: result.summary || createEmptyOverallScore().summary,
    dimensions: [
      { key: 'mastery', label: '岗位能力掌握', score: result.masteryScore },
      { key: 'communication', label: '表达与沟通', score: result.communicationScore },
      ...result.topicEvaluations.slice(0, 3).map((topic, index) => ({
        key: topic.topicKey,
        label: topicLabelByKey.get(topic.topicKey) ?? `能力主题 ${index + 1}`,
        score: topic.masteryScore,
      })),
    ],
  }
}

function toReview(
  evaluation: PublicInterviewEvaluationDto | null,
  sessionStatus: InterviewSessionStatus,
): InterviewReview | null {
  if (!evaluation || (sessionStatus !== 'completed' && sessionStatus !== 'ended_early')) return null

  const result = evaluation.result
  if (result.finalReview) {
    return {
      summary: result.finalReview.summary,
      strengths: result.finalReview.strengths,
      gaps: result.finalReview.gaps,
      nextPractice: result.finalReview.nextPractice,
      generatedAt: result.finalReview.generatedAt,
    }
  }

  return {
    summary: result.summary || '本轮面试已结束，后续会接入更完整的复盘报告。',
    // 旧记录没有保存最终复盘的引用键，不能用数组下标伪造题号；等新复盘生成后再展示精确引用。
    strengths: result.strengths.map((title) => ({ title, detail: title, references: [] })),
    gaps: result.weaknesses.map((title) => ({ title, detail: title, priority: 'medium' as const, references: [] })),
    nextPractice: result.suggestions,
    generatedAt: evaluation.finalizedAt ?? evaluation.updatedAt,
  }
}

function toSessionFromSummary(summary: InterviewSessionSummaryDto): InterviewSession {
  const config = stripBudget(summary.configuration)

  return {
    id: summary.id,
    opportunityId: summary.opportunityId,
    config,
    budget: summary.configuration.budget,
    model: { baseUrl: summary.modelBaseUrl, modelName: summary.modelName },
    stateVersion: 0,
    status: summary.status,
    phase: getPhaseFromSession(summary),
    questions: [],
    answers: [],
    interactions: [],
    skips: [],
    currentQuestionId: null,
    streamingText: '',
    streamingKind: null,
    streamingCreatedAt: null,
    overallScore: {
      ...createEmptyOverallScore(),
      score: summary.latestOverallScore,
    },
    review: null,
    taskError: null,
    hintImpactAcknowledged: false,
    startedAt: summary.startedAt ?? summary.createdAt,
    lastActivityAt: summary.lastActiveAt,
    completedAt: summary.endedAt,
  }
}

function toInterviewSessionSummary(summary: InterviewSessionSummaryDto): InterviewSessionSummary {
  return {
    id: summary.id,
    opportunityId: summary.opportunityId,
    config: stripBudget(summary.configuration),
    status: summary.status,
    phase: getPhaseFromSession(summary),
    startedAt: summary.startedAt ?? summary.createdAt,
    lastActivityAt: summary.lastActiveAt,
    completedAt: summary.endedAt,
    answeredQuestionCount: summary.answeredQuestionCount,
    validAnswerCount: summary.validAnswerCount,
    overallScore: summary.latestOverallScore,
    primaryStrength: summary.primaryStrength,
    primaryGap: summary.primaryGap,
  }
}

function toSession(detail: InterviewSessionDetailDto): InterviewSession {
  const currentTurn = detail.turns.find((turn) => turn.id === detail.session.currentTurnId)
  const questions = detail.turns.map(toQuestion)
  const feedbackByTurnId = new Map(detail.feedback.map((feedback) => [feedback.turnId, feedback]))

  questions.forEach((question) => {
    const feedback = feedbackByTurnId.get(question.id)
    if (feedback) question.feedback = toQuestionFeedback(feedback)
  })

  const answers = detail.turns.flatMap((turn) => {
    const answer = toAnswer(
      turn,
      detail.deepEvaluations.find((evaluation) => evaluation.turnId === turn.id),
    )
    return answer ? [answer] : []
  })

  return {
    id: detail.session.id,
    opportunityId: detail.session.opportunityId,
    config: stripBudget(detail.session.configuration),
    budget: detail.session.configuration.budget,
    model: { baseUrl: detail.session.modelBaseUrl, modelName: detail.session.modelName },
    stateVersion: detail.session.stateVersion,
    status: detail.session.status,
    phase: getPhaseFromSession(detail.session, currentTurn),
    questions,
    answers,
    interactions: toInteractions(detail.interactions),
    skips: detail.turns.flatMap((turn) =>
      turn.skip
        ? [
            {
              id: turn.id,
              questionId: turn.id,
              reason: turn.skip.reason,
              createdAt: turn.skip.skippedAt,
            },
          ]
        : [],
    ),
    currentQuestionId: detail.session.currentTurnId,
    streamingText: '',
    streamingKind: null,
    streamingCreatedAt: null,
    overallScore: toOverallScore(detail.evaluation, detail.session.status, detail.topics),
    review: toReview(detail.evaluation, detail.session.status),
    taskError: detail.taskError,
    hintImpactAcknowledged: false,
    startedAt: detail.session.startedAt ?? detail.session.createdAt,
    lastActivityAt: detail.session.lastActiveAt,
    completedAt: detail.session.endedAt,
  }
}

export function toSessionSummary(session: InterviewSession): InterviewSessionSummary {
  return {
    id: session.id,
    opportunityId: session.opportunityId,
    config: session.config,
    status: session.status,
    phase: session.phase,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    completedAt: session.completedAt,
    answeredQuestionCount: session.answers.length,
    validAnswerCount: session.answers.filter((answer) => answer.evaluation?.outcome !== 'unable_to_assess').length,
    overallScore: session.overallScore.score,
    primaryStrength: session.review?.strengths[0]?.title ?? null,
    primaryGap: session.review?.gaps[0]?.title ?? null,
  }
}

export function createInterviewOverview(sessions: InterviewSessionSummary[]): InterviewOverview {
  const availableSessions = sessions.filter((session) => session.status !== 'cancelled')
  const completed = availableSessions.filter(
    (session) => session.status === 'completed' || session.status === 'ended_early',
  )
  const latest = completed.sort(
    (current, next) => Date.parse(next.lastActivityAt) - Date.parse(current.lastActivityAt),
  )[0]

  return {
    completedCount: completed.length,
    activeCount: availableSessions.filter((session) => session.status === 'active' || session.status === 'preparing')
      .length,
    foundationCount: availableSessions.filter((session) => session.config.type === 'foundation').length,
    projectCount: availableSessions.filter((session) => session.config.type === 'project').length,
    recentScore: latest?.overallScore ?? null,
    primaryStrength: latest?.primaryStrength ?? null,
    primaryGap: latest?.primaryGap ?? null,
  }
}

export const interviewApi = {
  async listActiveModelUsage() {
    return request.get<
      Array<{
        sessionId: string
        opportunityId: string
        status: InterviewSessionStatus
        modelSnapshot: { baseUrl: string; modelName: string }
      }>
    >('/interview-sessions/active-model-usage')
  },

  async listSessions(opportunityId: string): Promise<InterviewSessionSummary[]> {
    const query = new URLSearchParams({ opportunityId })
    const summaries = await request.get<InterviewSessionSummaryDto[]>(`/interview-sessions?${query.toString()}`)
    return summaries.map(toInterviewSessionSummary)
  },

  async getSession(sessionId: string, options: RequestOptions = {}): Promise<InterviewSession | null> {
    const detail = await request.get<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}`,
      options,
    )
    return toSession(detail)
  },

  getSessionStatus(sessionId: string, options: RequestOptions = {}) {
    return request.get<InterviewSessionStatusSnapshot>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/status`,
      options,
    )
  },

  async createSession(
    opportunityId: string,
    config: CreateInterviewPayload,
    modelConnection: LlmConnectionSettings,
  ): Promise<InterviewSession> {
    const summary = await request.post<InterviewSessionSummaryDto>(
      `/opportunities/${encodeURIComponent(opportunityId)}/interview-sessions`,
      {
        configuration: {
          ...config,
          budget: getInterviewBudget(config),
        },
        modelConnection,
      },
    )

    return toSessionFromSummary(summary)
  },

  async endSession(sessionId: string): Promise<InterviewSession> {
    await request.post<InterviewSessionSummaryDto>(`/interview-sessions/${encodeURIComponent(sessionId)}/end`, {
      reason: 'user_ended',
    })
    const session = await this.getSession(sessionId)
    if (!session) throw new Error('模拟面试不存在')
    return session
  },

  async switchSessionModel(sessionId: string, modelConnection: LlmConnectionSettings) {
    const detail = await request.patch<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/model`,
      { modelConnection },
    )
    return toSession(detail)
  },

  async submitAnswer(
    sessionId: string,
    turnId: string,
    payload: SubmitInterviewAnswerPayload,
    options: RequestOptions = {},
  ) {
    const detail = await request.post<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/answers`,
      payload,
      options,
    )
    return toSession(detail)
  },

  async retryAnswer(sessionId: string, turnId: string, modelConnection: LlmConnectionSettings) {
    const detail = await request.post<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/retry-answer`,
      { modelConnection },
    )
    return toSession(detail)
  },

  async skipQuestion(sessionId: string, turnId: string, reason: SkipReason, modelConnection: LlmConnectionSettings) {
    const detail = await request.post<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/skip`,
      { reason, note: null, modelConnection },
    )
    return toSession(detail)
  },

  async retrySkip(sessionId: string, turnId: string, modelConnection: LlmConnectionSettings) {
    const detail = await request.post<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/retry-skip`,
      { modelConnection },
    )
    return toSession(detail)
  },

  async cancelAnswer(sessionId: string, turnId: string, clientSubmissionId?: string) {
    const detail = await request.post<InterviewSessionDetailDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel-answer`,
      { clientSubmissionId },
    )
    return toSession(detail)
  },

  async saveQuestionFeedback(sessionId: string, turnId: string, feedback: InterviewQuestionFeedback) {
    const response = await request.put<PublicInterviewFeedbackDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/feedback`,
      {
        rating: feedback.value,
        reasons: feedback.reason ? [feedback.reason] : [],
        comment: null,
      },
    )
    return toQuestionFeedback(response)
  },

  async deleteQuestionFeedback(sessionId: string, turnId: string) {
    await request.delete<{ id: string }>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/feedback`,
    )
  },

  async generateAnswerReview(sessionId: string, turnId: string, modelConnection: LlmConnectionSettings) {
    const evaluation = await request.post<PublicInterviewDeepEvaluationDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/deep-evaluation`,
      { modelConnection },
    )
    return toAnswerDeepEvaluationState(evaluation)
  },

  async getAnswerReview(sessionId: string, turnId: string) {
    const evaluation = await request.get<PublicInterviewDeepEvaluationDto>(
      `/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/deep-evaluation`,
    )
    return toAnswerDeepEvaluationState(evaluation)
  },
}
