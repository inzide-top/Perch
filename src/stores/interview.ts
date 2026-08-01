import { defineStore } from 'pinia'
import {
  createInterviewOverview,
  interviewApi,
  toSessionSummary,
  type InterviewSessionStatusSnapshot,
} from '@/services/interviews'
import { useSettingsStore } from './settings'
import { useBackgroundTaskStore, type BackgroundTaskDisplayContext, type BackgroundTaskEntry } from './background-tasks'
import { canApplyInterviewSessionResponse, shouldDeferInterviewScoreUpdate } from '@/services/interview-runtime'
import { isAiTaskError } from '@/services/ai-errors'
import { ApiRequestError } from '@/services/http'
import type {
  CreateInterviewPayload,
  InterviewAnswer,
  InterviewOverview,
  InterviewQuestion,
  InterviewQuestionFeedback,
  InterviewSession,
  InterviewSessionSummary,
  SkipReason,
} from '@/types/interview'

type PendingInterviewAnswer = InterviewAnswer & {
  status: 'cancellable' | 'processing' | 'cancelling'
  clientSubmissionId: string
}

type InterviewState = {
  sessionsById: Record<string, InterviewSession>
  sessionIdsByOpportunityId: Record<string, string[]>
  sessionSummariesByOpportunityId: Record<string, InterviewSessionSummary[]>
  overviewsByOpportunityId: Record<string, InterviewOverview>
  pendingAnswersByTurnId: Record<string, PendingInterviewAnswer | undefined>
  loadingOpportunityIds: string[]
  loadingSessionIds: string[]
  generatingSessionIds: string[]
  reviewingAnswerIds: string[]
  cancellingAnswerSessionIds: string[]
  skippingSessionIds: string[]
  errorsByScope: Record<string, string | undefined>
}

type SessionRequestEntry = {
  generation: number
  token: symbol
  controller: AbortController
  promise: Promise<InterviewSession | null>
}

type PersistedPendingInterviewAnswer = {
  sessionId: string
  questionId: string
  content: string
  assistanceLevel: InterviewAnswer['assistanceLevel']
  submittedAt: string
  clientSubmissionId: string
}

type PersistedInterviewHintState = {
  impactAcknowledged: boolean
  revealedByTurnId: Record<string, InterviewQuestion['revealedHintLevel']>
}

const sessionRequestPromises = new Map<string, SessionRequestEntry>()
const sessionRequestGenerations = new Map<string, number>()
const answerAbortControllers = new Map<string, AbortController>()
const cancelledAnswerSubmissionIds = new Set<string>()
const questionStreamTimers = new Map<string, number>()
const questionStreamFinalSessions = new Map<string, InterviewSession>()
const pendingAnswerStorageKeyPrefix = 'agent-seek-employment:pending-interview-answer:'
const hintStateStorageKeyPrefix = 'agent-seek-employment:interview-hints:'

function randomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function prependIdIfMissing(list: string[], id: string) {
  if (!list.includes(id)) list.unshift(id)
}

function removeId(list: string[], id: string) {
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
}

function getSessionScope(sessionId: string) {
  return `session:${sessionId}`
}

function getOpportunityScope(opportunityId: string) {
  return `opportunity:${opportunityId}`
}

function getSessionRequestGeneration(sessionId: string) {
  return sessionRequestGenerations.get(sessionId) ?? 0
}

function invalidateSessionRequests(sessionId: string) {
  sessionRequestPromises.get(sessionId)?.controller.abort()
  sessionRequestGenerations.set(sessionId, getSessionRequestGeneration(sessionId) + 1)
}

function getPendingAnswerStorageKey(sessionId: string) {
  return `${pendingAnswerStorageKeyPrefix}${sessionId}`
}

function readPersistedPendingAnswer(sessionId: string): PersistedPendingInterviewAnswer | null {
  if (typeof localStorage === 'undefined') return null

  try {
    const storedValue = localStorage.getItem(getPendingAnswerStorageKey(sessionId))
    if (!storedValue) return null

    const candidate = JSON.parse(storedValue) as Partial<PersistedPendingInterviewAnswer>
    if (
      candidate.sessionId !== sessionId ||
      typeof candidate.questionId !== 'string' ||
      typeof candidate.content !== 'string' ||
      typeof candidate.submittedAt !== 'string' ||
      typeof candidate.clientSubmissionId !== 'string' ||
      !['none', 'level_1', 'level_2'].includes(candidate.assistanceLevel ?? '')
    ) {
      localStorage.removeItem(getPendingAnswerStorageKey(sessionId))
      return null
    }

    return candidate as PersistedPendingInterviewAnswer
  } catch {
    localStorage.removeItem(getPendingAnswerStorageKey(sessionId))
    return null
  }
}

function persistPendingAnswer(answer: PersistedPendingInterviewAnswer) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(getPendingAnswerStorageKey(answer.sessionId), JSON.stringify(answer))
}

function clearPersistedPendingAnswer(sessionId: string, clientSubmissionId?: string) {
  if (typeof localStorage === 'undefined') return
  if (clientSubmissionId) {
    const current = readPersistedPendingAnswer(sessionId)
    if (current && current.clientSubmissionId !== clientSubmissionId) return
  }
  localStorage.removeItem(getPendingAnswerStorageKey(sessionId))
}

function getHintStateStorageKey(sessionId: string) {
  return `${hintStateStorageKeyPrefix}${sessionId}`
}

function readPersistedHintState(sessionId: string): PersistedInterviewHintState {
  const fallback: PersistedInterviewHintState = { impactAcknowledged: false, revealedByTurnId: {} }
  if (typeof localStorage === 'undefined') return fallback

  try {
    const raw = localStorage.getItem(getHintStateStorageKey(sessionId))
    if (!raw) return fallback
    const candidate = JSON.parse(raw) as Partial<PersistedInterviewHintState>
    const revealedByTurnId = Object.fromEntries(
      Object.entries(candidate.revealedByTurnId ?? {}).filter(
        ([turnId, level]) => Boolean(turnId) && (level === 'none' || level === 'level_1' || level === 'level_2'),
      ),
    )
    return { impactAcknowledged: candidate.impactAcknowledged === true, revealedByTurnId }
  } catch {
    localStorage.removeItem(getHintStateStorageKey(sessionId))
    return fallback
  }
}

function persistHintState(sessionId: string, state: PersistedInterviewHintState) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(getHintStateStorageKey(sessionId), JSON.stringify(state))
}

function restorePersistedHintState(session: InterviewSession) {
  if (session.status === 'completed' || session.status === 'ended_early' || session.status === 'cancelled') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(getHintStateStorageKey(session.id))
    return
  }

  const persisted = readPersistedHintState(session.id)
  session.hintImpactAcknowledged = persisted.impactAcknowledged
  session.questions.forEach((question) => {
    const level = persisted.revealedByTurnId[question.id]
    if (level) question.revealedHintLevel = level
  })
}

function clearPersistedHintForTurn(sessionId: string, turnId: string) {
  const persisted = readPersistedHintState(sessionId)
  if (!(turnId in persisted.revealedByTurnId)) return
  delete persisted.revealedByTurnId[turnId]
  persistHintState(sessionId, persisted)
}

function getCurrentQuestion(session: InterviewSession) {
  return session.questions.find((question) => question.id === session.currentQuestionId) ?? null
}

function getQuestionStreamText(question: InterviewQuestion) {
  if (!question.subQuestions.length) return question.content

  return `${question.content}\n\n${question.subQuestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
}

function clearQuestionStream(sessionId: string) {
  const timer = questionStreamTimers.get(sessionId)
  if (timer !== undefined) window.clearTimeout(timer)
  questionStreamTimers.delete(sessionId)
  questionStreamFinalSessions.delete(sessionId)
}

function preserveLocalQuestionState(previous: InterviewSession | undefined, next: InterviewSession) {
  if (!previous) return next

  const previousQuestions = new Map(previous.questions.map((question) => [question.id, question]))
  next.questions.forEach((question) => {
    const previousQuestion = previousQuestions.get(question.id)
    if (!previousQuestion) return

    if (!question.hintLevel1) question.hintLevel1 = previousQuestion.hintLevel1
    if (!question.hintLevel2) question.hintLevel2 = previousQuestion.hintLevel2
    if (!question.feedback && previousQuestion.feedback) question.feedback = previousQuestion.feedback
    if (previousQuestion.revealedHintLevel !== 'none') {
      question.revealedHintLevel = previousQuestion.revealedHintLevel
    }
  })

  const previousAnswers = new Map(previous.answers.map((answer) => [answer.id, answer]))
  next.answers.forEach((answer) => {
    const previousAnswer = previousAnswers.get(answer.id)
    if (previousAnswer?.deepReviewStatus === 'processing' && answer.deepReviewStatus === 'idle') {
      // POST 尚未落库时，Session 轮询可能仍返回 idle；不允许它覆盖点击后的乐观 loading。
      answer.deepReviewStatus = 'processing'
    }
    if (answer.deepReviewStatus === 'completed' && previousAnswer?.deepReview) {
      answer.deepReview = previousAnswer.deepReview
    }
  })

  return {
    ...next,
    hintImpactAcknowledged: previous.hintImpactAcknowledged || next.hintImpactAcknowledged,
  }
}

export const useInterviewStore = defineStore('interview', {
  state: (): InterviewState => ({
    sessionsById: {},
    sessionIdsByOpportunityId: {},
    sessionSummariesByOpportunityId: {},
    overviewsByOpportunityId: {},
    pendingAnswersByTurnId: {},
    loadingOpportunityIds: [],
    loadingSessionIds: [],
    generatingSessionIds: [],
    reviewingAnswerIds: [],
    cancellingAnswerSessionIds: [],
    skippingSessionIds: [],
    errorsByScope: {},
  }),

  getters: {
    session: (state) => (sessionId: string) => state.sessionsById[sessionId] ?? null,
    sessionsForOpportunity: (state) => (opportunityId: string) =>
      (state.sessionIdsByOpportunityId[opportunityId] ?? [])
        .map((sessionId) => state.sessionsById[sessionId])
        .filter((session): session is InterviewSession => Boolean(session)),
    sessionSummariesForOpportunity: (state) => (opportunityId: string) =>
      state.sessionSummariesByOpportunityId[opportunityId] ?? [],
    isSessionLoading: (state) => (sessionId: string) => state.loadingSessionIds.includes(sessionId),
    isGenerating: (state) => (sessionId: string) => state.generatingSessionIds.includes(sessionId),
    isAnswerReviewing: (state) => (answerId: string) =>
      state.reviewingAnswerIds.includes(answerId) ||
      Object.values(state.sessionsById).some((session) =>
        session.answers.some((answer) => answer.id === answerId && answer.deepReviewStatus === 'processing'),
      ),
    isAnswerCancellationPending: (state) => (sessionId: string) => state.cancellingAnswerSessionIds.includes(sessionId),
    isQuestionSkipping: (state) => (sessionId: string) => state.skippingSessionIds.includes(sessionId),
    pendingAnswerForTurn: (state) => (turnId: string) => state.pendingAnswersByTurnId[turnId] ?? null,
    pendingAnswerForSession: (state) => (sessionId: string) => {
      const session = state.sessionsById[sessionId]
      if (!session) return null

      return (
        Object.values(state.pendingAnswersByTurnId).find(
          (answer) => answer?.questionId && session.questions.some((question) => question.id === answer.questionId),
        ) ?? null
      )
    },
  },

  actions: {
    restorePersistedPendingAnswerControl(session: InterviewSession) {
      const persistedAnswer = readPersistedPendingAnswer(session.id)
      if (
        !persistedAnswer ||
        session.status !== 'active' ||
        session.phase !== 'awaiting_answer' ||
        session.currentQuestionId !== persistedAnswer.questionId ||
        session.answers.some((answer) => answer.questionId === persistedAnswer.questionId) ||
        this.pendingAnswersByTurnId[persistedAnswer.questionId]
      ) {
        return
      }

      this.pendingAnswersByTurnId[persistedAnswer.questionId] = {
        id: persistedAnswer.clientSubmissionId,
        questionId: persistedAnswer.questionId,
        content: persistedAnswer.content,
        assistanceLevel: persistedAnswer.assistanceLevel,
        submittedAt: persistedAnswer.submittedAt,
        evaluation: null,
        deepReviewStatus: 'idle',
        deepReview: null,
        deepReviewError: null,
        status: 'cancellable',
        clientSubmissionId: persistedAnswer.clientSubmissionId,
      }
    },

    restorePendingAnswerControl(session: InterviewSession) {
      if (session.phase !== 'validating_answer' && session.phase !== 'evaluating_answer') return

      const turnId = session.currentQuestionId
      const answer = turnId ? session.answers.find((item) => item.questionId === turnId) : null
      if (!turnId || !answer?.clientSubmissionId || this.pendingAnswersByTurnId[turnId]) return

      this.pendingAnswersByTurnId[turnId] = {
        ...answer,
        status: 'processing',
        clientSubmissionId: answer.clientSubmissionId,
      }
    },

    mergePendingAnswers(session: InterviewSession) {
      const nextSession: InterviewSession = {
        ...session,
        answers: [...session.answers],
      }

      Object.entries(this.pendingAnswersByTurnId).forEach(([turnId, pendingAnswer]) => {
        if (!pendingAnswer) return

        const hasTurn = nextSession.questions.some((question) => question.id === turnId)
        if (!hasTurn) return

        const confirmedAnswer = nextSession.answers.find((answer) => answer.questionId === turnId)
        if (confirmedAnswer) {
          const isCurrentAnswerProcessing =
            nextSession.currentQuestionId === turnId &&
            (nextSession.phase === 'validating_answer' || nextSession.phase === 'evaluating_answer')

          if (isCurrentAnswerProcessing) {
            if (pendingAnswer.status !== 'cancelling') pendingAnswer.status = 'processing'
          } else {
            delete this.pendingAnswersByTurnId[turnId]
          }
          return
        }

        const answerWasCancelled =
          nextSession.currentQuestionId === turnId &&
          nextSession.phase === 'awaiting_answer' &&
          pendingAnswer.status !== 'cancellable'
        if (answerWasCancelled) {
          delete this.pendingAnswersByTurnId[turnId]
          return
        }

        nextSession.answers.push(pendingAnswer)
      })

      return nextSession
    },

    maybeAnimateIncomingMessage(previousSession: InterviewSession | undefined, nextSession: InterviewSession) {
      if (!previousSession) return false

      const incomingQuestion = nextSession.currentQuestionId
        ? nextSession.questions.find((question) => question.id === nextSession.currentQuestionId)
        : null
      const shouldAnimateQuestion = Boolean(
        incomingQuestion &&
        nextSession.phase === 'awaiting_answer' &&
        previousSession.currentQuestionId !== nextSession.currentQuestionId &&
        !(
          previousSession.phase === 'awaiting_answer' &&
          previousSession.questions.some((item) => item.id === incomingQuestion.id)
        ),
      )
      const previousInteractionIds = new Set(previousSession.interactions.map((interaction) => interaction.id))
      const incomingInteraction = nextSession.interactions.find(
        (interaction) =>
          interaction.role === 'interviewer' &&
          !previousInteractionIds.has(interaction.id) &&
          (interaction.type === 'clarification_response' || interaction.type === 'off_topic_redirect'),
      )

      if (!shouldAnimateQuestion && !incomingInteraction) return false

      if (questionStreamTimers.has(nextSession.id)) {
        questionStreamFinalSessions.set(nextSession.id, nextSession)
        return true
      }

      const hiddenMessageSession: InterviewSession = {
        ...nextSession,
        // 在模拟流式尚未开始前保留上一版评分，避免右侧先“剧透”评估结果。
        overallScore: previousSession.overallScore,
        currentQuestionId: shouldAnimateQuestion ? null : nextSession.currentQuestionId,
        questions: shouldAnimateQuestion
          ? nextSession.questions.filter((question) => question.id !== incomingQuestion?.id)
          : nextSession.questions,
        interactions: incomingInteraction
          ? nextSession.interactions.filter((interaction) => interaction.id !== incomingInteraction.id)
          : nextSession.interactions,
        phase: shouldAnimateQuestion
          ? incomingQuestion?.sequence === 1
            ? 'generating_first_question'
            : 'generating_question'
          : 'clarifying_question',
        streamingText: '',
        streamingKind: shouldAnimateQuestion ? 'question' : 'interaction',
        streamingCreatedAt: shouldAnimateQuestion
          ? (incomingQuestion?.createdAt ?? null)
          : (incomingInteraction?.createdAt ?? null),
      }
      this.sessionsById[nextSession.id] = hiddenMessageSession

      const text =
        shouldAnimateQuestion && incomingQuestion
          ? getQuestionStreamText(incomingQuestion)
          : (incomingInteraction?.content ?? '')
      let cursor = 0
      let hasStartedStreaming = false
      const step = () => {
        const currentSession = this.sessionsById[nextSession.id]
        if (!currentSession || !questionStreamTimers.has(nextSession.id)) return

        if (!hasStartedStreaming) {
          // 第一个字开始出现时再同步新评分，让左右两侧反馈处于同一交互时刻。
          currentSession.overallScore = nextSession.overallScore
          hasStartedStreaming = true
        }

        const chunkSize = randomInteger(1, 4)
        cursor = Math.min(text.length, cursor + chunkSize)
        currentSession.streamingText = text.slice(0, cursor)

        if (cursor >= text.length) {
          const finalSession = questionStreamFinalSessions.get(nextSession.id) ?? nextSession
          clearQuestionStream(nextSession.id)
          this.sessionsById[finalSession.id] = this.mergePendingAnswers(finalSession)
          this.refreshOverview(finalSession.opportunityId)
          return
        }

        const latestCharacter = text.at(Math.max(0, cursor - 1)) ?? ''
        const punctuationPause = /[，。！？；：\n]/.test(latestCharacter) ? randomInteger(55, 130) : 0
        questionStreamTimers.set(nextSession.id, window.setTimeout(step, randomInteger(42, 95) + punctuationPause))
      }

      questionStreamFinalSessions.set(nextSession.id, nextSession)
      questionStreamTimers.set(nextSession.id, window.setTimeout(step, 100))
      return true
    },

    upsertSession(session: InterviewSession) {
      const previousSession = this.sessionsById[session.id]
      restorePersistedHintState(session)
      this.restorePersistedPendingAnswerControl(session)
      this.restorePendingAnswerControl(session)
      let mergedSession = this.mergePendingAnswers(preserveLocalQuestionState(previousSession, session))
      if (previousSession && shouldDeferInterviewScoreUpdate(previousSession, mergedSession)) {
        mergedSession = {
          ...mergedSession,
          overallScore: previousSession.overallScore,
        }
      }
      const ids = (this.sessionIdsByOpportunityId[session.opportunityId] ??= [])
      // 列表排序只由首次加载的 summaries 或新建动作决定；轮询更新不能把旧会话顶到第一位。
      prependIdIfMissing(ids, session.id)
      const summaries = (this.sessionSummariesByOpportunityId[session.opportunityId] ??= [])
      const summary = toSessionSummary(mergedSession)
      const summaryIndex = summaries.findIndex((item) => item.id === session.id)
      if (summaryIndex >= 0) summaries[summaryIndex] = summary
      else summaries.unshift(summary)

      if (this.maybeAnimateIncomingMessage(previousSession, mergedSession)) return

      if (questionStreamTimers.has(session.id)) {
        questionStreamFinalSessions.set(session.id, mergedSession)
        return
      }

      this.sessionsById[session.id] = mergedSession
    },

    async loadInterviewHome(opportunityId: string) {
      if (this.loadingOpportunityIds.includes(opportunityId)) return

      this.loadingOpportunityIds.push(opportunityId)
      delete this.errorsByScope[getOpportunityScope(opportunityId)]
      try {
        const sessions = await interviewApi.listSessions(opportunityId)
        this.sessionIdsByOpportunityId[opportunityId] = sessions.map((session) => session.id)
        this.sessionSummariesByOpportunityId[opportunityId] = sessions
        this.refreshOverview(opportunityId)
      } catch (error) {
        this.errorsByScope[getOpportunityScope(opportunityId)] =
          error instanceof Error ? error.message : '加载模拟面试失败。'
      } finally {
        removeId(this.loadingOpportunityIds, opportunityId)
      }
    },

    async loadSession(sessionId: string, options: { force?: boolean } = {}) {
      if (!options.force && this.sessionsById[sessionId]) return this.sessionsById[sessionId]
      const requestGeneration = getSessionRequestGeneration(sessionId)
      const existingRequest = sessionRequestPromises.get(sessionId)
      if (existingRequest?.generation === requestGeneration) return existingRequest.promise

      if (!this.loadingSessionIds.includes(sessionId)) this.loadingSessionIds.push(sessionId)
      delete this.errorsByScope[getSessionScope(sessionId)]
      const requestToken = Symbol(sessionId)
      const requestController = new AbortController()
      const request = interviewApi
        .getSession(sessionId, { signal: requestController.signal })
        .then((session) => {
          if (session && canApplyInterviewSessionResponse(requestGeneration, getSessionRequestGeneration(sessionId))) {
            this.upsertSession(session)
            this.refreshOverview(session.opportunityId)
            useBackgroundTaskStore().registerMany(
              session.answers
                .filter((answer) => answer.deepReviewStatus === 'processing')
                .map((answer) => ({
                  type: 'answer_deep_evaluation' as const,
                  sessionId,
                  turnId: answer.questionId,
                })),
            )
          }
          return session
        })
        .catch((error) => {
          if (canApplyInterviewSessionResponse(requestGeneration, getSessionRequestGeneration(sessionId))) {
            this.errorsByScope[getSessionScope(sessionId)] =
              error instanceof Error ? error.message : '加载面试记录失败。'
          }
          return null
        })
        .finally(() => {
          if (sessionRequestPromises.get(sessionId)?.token !== requestToken) return

          removeId(this.loadingSessionIds, sessionId)
          sessionRequestPromises.delete(sessionId)
        })

      sessionRequestPromises.set(sessionId, {
        generation: requestGeneration,
        token: requestToken,
        controller: requestController,
        promise: request,
      })
      return request
    },

    /** 轮询期间只请求轻量状态；stateVersion 变化后再拉取完整会话。 */
    async pollSessionStatus(sessionId: string): Promise<InterviewSessionStatusSnapshot | null> {
      try {
        const snapshot = await interviewApi.getSessionStatus(sessionId)
        const current = this.sessionsById[sessionId]
        if (!current || current.stateVersion !== snapshot.stateVersion) {
          await this.loadSession(sessionId, { force: true })
        }
        return snapshot
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] = error instanceof Error ? error.message : '加载面试状态失败。'
        return null
      }
    },

    cancelSessionLoad(sessionId: string) {
      invalidateSessionRequests(sessionId)
      removeId(this.loadingSessionIds, sessionId)
    },

    async createInterview(opportunityId: string, config: CreateInterviewPayload) {
      const settingsStore = useSettingsStore()
      const session = await interviewApi.createSession(opportunityId, config, settingsStore.llm)
      this.upsertSession(session)
      this.refreshOverview(opportunityId)
      return session
    },

    async switchSessionModel(sessionId: string) {
      if (this.generatingSessionIds.includes(sessionId)) return false
      const settingsStore = useSettingsStore()
      this.generatingSessionIds.push(sessionId)
      delete this.errorsByScope[getSessionScope(sessionId)]
      try {
        const updated = await interviewApi.switchSessionModel(sessionId, settingsStore.llm)
        this.upsertSession(updated)
        return true
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '切换本轮面试模型失败。'
        return false
      } finally {
        removeId(this.generatingSessionIds, sessionId)
      }
    },

    refreshOverview(opportunityId: string) {
      this.overviewsByOpportunityId[opportunityId] = createInterviewOverview(
        this.sessionSummariesForOpportunity(opportunityId),
      )
    },

    async submitAnswer(sessionId: string, content: string) {
      const session = this.sessionsById[sessionId]
      const question = session ? getCurrentQuestion(session) : null
      if (!session || !question || session.phase !== 'awaiting_answer') return { type: 'invalid' as const }

      const settingsStore = useSettingsStore()
      const normalizedContent = content.trim()
      const persistedAnswer = readPersistedPendingAnswer(sessionId)
      const canResumePersistedAnswer =
        persistedAnswer?.questionId === question.id && persistedAnswer.content === normalizedContent
      const clientSubmissionId = canResumePersistedAnswer ? persistedAnswer.clientSubmissionId : crypto.randomUUID()
      const submittedAt = canResumePersistedAnswer ? persistedAnswer.submittedAt : new Date().toISOString()
      const hintUsage = canResumePersistedAnswer ? persistedAnswer.assistanceLevel : question.revealedHintLevel
      const pendingAnswer: PendingInterviewAnswer = {
        id: clientSubmissionId,
        questionId: question.id,
        content: normalizedContent,
        assistanceLevel: hintUsage,
        submittedAt,
        evaluation: null,
        deepReviewStatus: 'idle',
        deepReview: null,
        deepReviewError: null,
        status: 'cancellable',
        clientSubmissionId,
      }
      const abortController = new AbortController()

      persistPendingAnswer({
        sessionId,
        questionId: question.id,
        content: pendingAnswer.content,
        assistanceLevel: hintUsage,
        submittedAt,
        clientSubmissionId,
      })

      this.pendingAnswersByTurnId[question.id] = pendingAnswer
      if (!session.answers.some((answer) => answer.questionId === question.id)) session.answers.push(pendingAnswer)
      answerAbortControllers.set(sessionId, abortController)
      session.phase = 'validating_answer'
      delete this.errorsByScope[getSessionScope(sessionId)]

      try {
        const updated = await interviewApi.submitAnswer(
          sessionId,
          question.id,
          {
            content: pendingAnswer.content,
            clientSubmissionId,
            submittedAt,
            hintUsage,
            modelConnection: settingsStore.llm,
          },
          { signal: abortController.signal },
        )
        if (cancelledAnswerSubmissionIds.has(clientSubmissionId)) {
          return { type: 'aborted' as const, content: pendingAnswer.content }
        }
        clearPersistedPendingAnswer(sessionId, clientSubmissionId)
        clearPersistedHintForTurn(sessionId, question.id)
        const activePendingAnswer = this.pendingAnswersByTurnId[question.id]
        if (
          activePendingAnswer?.clientSubmissionId === clientSubmissionId &&
          activePendingAnswer.status !== 'cancelling'
        ) {
          activePendingAnswer.status = 'processing'
        }
        this.upsertSession(updated)
        this.refreshOverview(updated.opportunityId)
        return { type: 'accepted' as const, answerId: question.id }
      } catch (error) {
        const isAbortError = error instanceof DOMException && error.name === 'AbortError'
        if (isAbortError || cancelledAnswerSubmissionIds.has(clientSubmissionId)) {
          return { type: 'aborted' as const, content: pendingAnswer.content }
        }

        if (this.pendingAnswersByTurnId[question.id]?.clientSubmissionId === clientSubmissionId) {
          delete this.pendingAnswersByTurnId[question.id]
        }
        session.phase = 'awaiting_answer'
        session.answers = session.answers.filter((answer) => answer.id !== clientSubmissionId)
        answerAbortControllers.delete(sessionId)
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '提交回答失败，请稍后重试。'
        return { type: 'rejected' as const }
      } finally {
        if (answerAbortControllers.get(sessionId) === abortController) answerAbortControllers.delete(sessionId)
      }
    },

    async resumeInterruptedAnswer(sessionId: string) {
      const persistedAnswer = readPersistedPendingAnswer(sessionId)
      const session = this.sessionsById[sessionId]
      if (!persistedAnswer || !session) return null

      const isCurrentQuestion = session.currentQuestionId === persistedAnswer.questionId
      const serverAnswer = session.answers.find((answer) => answer.questionId === persistedAnswer.questionId)
      const serverHasAcceptedAnswer =
        Boolean(serverAnswer?.clientSubmissionId) &&
        (session.phase === 'validating_answer' ||
          session.phase === 'evaluating_answer' ||
          session.phase === 'answer_processing_failed')
      if (serverHasAcceptedAnswer || !isCurrentQuestion || session.status !== 'active') {
        clearPersistedPendingAnswer(sessionId, persistedAnswer.clientSubmissionId)
        return null
      }

      if (session.phase !== 'awaiting_answer') {
        clearPersistedPendingAnswer(sessionId, persistedAnswer.clientSubmissionId)
        return null
      }

      const result = await this.submitAnswer(sessionId, persistedAnswer.content)
      if (result.type === 'accepted' || result.type === 'aborted') return null

      const authoritativeSession = await this.loadSession(sessionId, { force: true })
      const acceptedAnswer = authoritativeSession?.answers.find(
        (answer) => answer.questionId === persistedAnswer.questionId && Boolean(answer.clientSubmissionId),
      )
      if (acceptedAnswer || authoritativeSession?.phase !== 'awaiting_answer') {
        clearPersistedPendingAnswer(sessionId, persistedAnswer.clientSubmissionId)
        return null
      }

      clearPersistedPendingAnswer(sessionId, persistedAnswer.clientSubmissionId)
      return { type: 'restore_draft' as const, content: persistedAnswer.content }
    },

    cancelPendingAnswer(sessionId: string) {
      const session = this.sessionsById[sessionId]
      const pendingAnswer = session ? this.pendingAnswerForSession(sessionId) : null
      if (!session || !pendingAnswer || this.cancellingAnswerSessionIds.includes(sessionId)) return null

      const sessionSnapshot: InterviewSession = {
        ...session,
        answers: [...session.answers],
      }
      const pendingAnswerSnapshot: PendingInterviewAnswer = { ...pendingAnswer }
      invalidateSessionRequests(sessionId)
      clearPersistedPendingAnswer(sessionId, pendingAnswer.clientSubmissionId)
      cancelledAnswerSubmissionIds.add(pendingAnswer.clientSubmissionId)
      answerAbortControllers.get(sessionId)?.abort()
      answerAbortControllers.delete(sessionId)
      delete this.pendingAnswersByTurnId[pendingAnswer.questionId]
      session.answers = session.answers.filter((answer) => answer.questionId !== pendingAnswer.questionId)
      session.phase = 'awaiting_answer'
      this.cancellingAnswerSessionIds.push(sessionId)

      void interviewApi
        .cancelAnswer(sessionId, pendingAnswer.questionId, pendingAnswer.clientSubmissionId)
        .then((updated) => {
          this.upsertSession(updated)
          this.refreshOverview(updated.opportunityId)
        })
        .catch(async (error: unknown) => {
          const authoritativeSession = await this.loadSession(sessionId, { force: true })
          if (!authoritativeSession) {
            this.sessionsById[sessionId] = sessionSnapshot
            this.pendingAnswersByTurnId[pendingAnswer.questionId] = {
              ...pendingAnswerSnapshot,
              status: 'processing',
            }
            persistPendingAnswer({
              sessionId,
              questionId: pendingAnswer.questionId,
              content: pendingAnswer.content,
              assistanceLevel: pendingAnswer.assistanceLevel,
              submittedAt: pendingAnswer.submittedAt,
              clientSubmissionId: pendingAnswer.clientSubmissionId,
            })
          }
          this.errorsByScope[getSessionScope(sessionId)] =
            error instanceof Error ? error.message : '中止回答失败，已恢复服务端状态。'
        })
        .finally(() => {
          removeId(this.cancellingAnswerSessionIds, sessionId)
          window.setTimeout(() => cancelledAnswerSubmissionIds.delete(pendingAnswer.clientSubmissionId), 60_000)
        })

      return pendingAnswer.content
    },

    revealHint(sessionId: string, level: 'level_1' | 'level_2') {
      const session = this.sessionsById[sessionId]
      const question = session ? getCurrentQuestion(session) : null
      if (!session || !question || session.phase !== 'awaiting_answer') return false
      if (level === 'level_2' && question.revealedHintLevel !== 'level_1') return false

      question.revealedHintLevel = level
      const persisted = readPersistedHintState(sessionId)
      persisted.revealedByTurnId[question.id] = level
      persistHintState(sessionId, persisted)
      return true
    },

    acknowledgeHintImpact(sessionId: string) {
      const session = this.sessionsById[sessionId]
      if (!session || session.hintImpactAcknowledged) return

      session.hintImpactAcknowledged = true
      const persisted = readPersistedHintState(sessionId)
      persisted.impactAcknowledged = true
      persistHintState(sessionId, persisted)
    },

    async skipQuestion(sessionId: string, reason: SkipReason) {
      const session = this.sessionsById[sessionId]
      const question = session ? getCurrentQuestion(session) : null
      if (!session || !question || session.phase !== 'awaiting_answer' || this.skippingSessionIds.includes(sessionId)) {
        return false
      }

      const settingsStore = useSettingsStore()
      this.skippingSessionIds.push(sessionId)
      delete this.errorsByScope[getSessionScope(sessionId)]
      try {
        const updated = await interviewApi.skipQuestion(sessionId, question.id, reason, settingsStore.llm)
        clearPersistedHintForTurn(sessionId, question.id)
        this.upsertSession(updated)
        this.refreshOverview(updated.opportunityId)
        return true
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '跳过问题失败，请稍后重试。'
        return false
      } finally {
        removeId(this.skippingSessionIds, sessionId)
      }
    },

    async submitQuestionFeedback(sessionId: string, questionId: string, feedback: InterviewQuestionFeedback | null) {
      const session = this.sessionsById[sessionId]
      const question = session?.questions.find((item) => item.id === questionId)
      if (!session || !question) return

      if (!feedback) {
        await interviewApi.deleteQuestionFeedback(sessionId, questionId)
        question.feedback = null
        return
      }

      question.feedback = await interviewApi.saveQuestionFeedback(sessionId, questionId, feedback)
    },

    async generateAnswerReview(sessionId: string, answerId: string, displayContext?: BackgroundTaskDisplayContext) {
      const session = this.sessionsById[sessionId]
      const answer = session?.answers.find((item) => item.id === answerId)
      if (!session || !answer || answer.deepReview || this.reviewingAnswerIds.includes(answerId)) {
        return { status: 'ignored' as const }
      }

      const backgroundTaskStore = useBackgroundTaskStore()
      const taskReference = { type: 'answer_deep_evaluation' as const, sessionId, turnId: answerId }
      const reservation = backgroundTaskStore.reserve(taskReference)
      if (!reservation.accepted) {
        return { status: 'capacity_exceeded' as const, message: reservation.message }
      }

      const settingsStore = useSettingsStore()
      this.reviewingAnswerIds.push(answerId)
      // 点击后立即乐观进入 processing，不等待 POST 接口返回。
      answer.deepReviewStatus = 'processing'
      answer.deepReviewError = null
      delete this.errorsByScope[getSessionScope(sessionId)]
      try {
        const state = await interviewApi.generateAnswerReview(sessionId, answerId, settingsStore.llm)
        answer.deepReviewStatus = state.status
        answer.deepReviewError = state.error
        answer.deepReview = state.review
        if (state.status === 'processing') {
          backgroundTaskStore.reset(taskReference)
          backgroundTaskStore.register(taskReference, displayContext)
        }

        if (state.status === 'failed') {
          this.errorsByScope[getSessionScope(sessionId)] = '深度点评生成失败，可以重新点击生成。'
        }
        return { status: 'accepted' as const }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 429) {
          answer.deepReviewStatus = 'idle'
          return { status: 'capacity_exceeded' as const, message: error.message }
        }

        answer.deepReviewStatus = 'failed'
        answer.deepReviewError = null
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '深度点评生成失败，请稍后重试。'
        return { status: 'failed' as const }
      } finally {
        backgroundTaskStore.releaseReservation(taskReference)
        removeId(this.reviewingAnswerIds, answerId)
      }
    },

    async loadAnswerReview(sessionId: string, answerId: string) {
      const answer = this.sessionsById[sessionId]?.answers.find((item) => item.id === answerId)
      if (!answer || answer.deepReview || this.reviewingAnswerIds.includes(answerId)) return
      if (answer.deepReviewStatus !== 'completed' && answer.deepReviewStatus !== 'processing') return

      this.reviewingAnswerIds.push(answerId)
      try {
        const state = await interviewApi.getAnswerReview(sessionId, answerId)
        answer.deepReviewStatus = state.status
        answer.deepReviewError = state.error
        answer.deepReview = state.review
        if (state.status === 'processing') {
          const backgroundTaskStore = useBackgroundTaskStore()
          backgroundTaskStore.reset({ type: 'answer_deep_evaluation', sessionId, turnId: answerId })
          backgroundTaskStore.register({
            type: 'answer_deep_evaluation',
            sessionId,
            turnId: answerId,
          })
        }
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '加载深度点评失败，请稍后重试。'
      } finally {
        removeId(this.reviewingAnswerIds, answerId)
      }
    },

    applyBackgroundDeepEvaluation(task: BackgroundTaskEntry) {
      if (task.type !== 'answer_deep_evaluation') return

      const session = this.sessionsById[task.sessionId]
      const answer = session?.answers.find((item) => item.id === task.turnId)
      if (!session || !answer) return

      if (task.status === 'missing') return
      if (task.status === 'pending' || task.status === 'processing') {
        answer.deepReviewStatus = 'processing'
        answer.deepReviewError = null
        return
      }

      answer.deepReviewStatus = task.status === 'completed' || task.status === 'failed' ? task.status : 'processing'
      answer.deepReviewError = isAiTaskError(task.evaluation?.error) ? task.evaluation.error : null
      if (task.status === 'completed' && task.evaluation?.result) {
        answer.deepReview = {
          ...task.evaluation.result,
          createdAt: task.evaluation.completedAt ?? task.evaluation.updatedAt ?? new Date().toISOString(),
        }
      }
      if (task.status === 'failed') {
        this.errorsByScope[getSessionScope(task.sessionId)] = '深度点评生成失败，可以重新点击生成。'
      }
    },

    async endSession(sessionId: string) {
      const session = this.sessionsById[sessionId]
      if (!session) return

      this.generatingSessionIds.push(sessionId)
      try {
        const updated = await interviewApi.endSession(sessionId)
        this.upsertSession(updated)
        this.refreshOverview(updated.opportunityId)
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '结束模拟面试失败，请稍后重试。'
      } finally {
        removeId(this.generatingSessionIds, sessionId)
      }
    },

    async retryCurrentTask(sessionId: string) {
      const session = this.sessionsById[sessionId]
      const turnId = session?.currentQuestionId
      if (
        !session ||
        !turnId ||
        (session.phase !== 'answer_processing_failed' && session.phase !== 'question_generation_failed') ||
        this.generatingSessionIds.includes(sessionId)
      ) {
        return
      }

      const settingsStore = useSettingsStore()
      this.generatingSessionIds.push(sessionId)
      delete this.errorsByScope[getSessionScope(sessionId)]
      try {
        const updated =
          session.phase === 'question_generation_failed'
            ? await interviewApi.retrySkip(sessionId, turnId, settingsStore.llm)
            : await interviewApi.retryAnswer(sessionId, turnId, settingsStore.llm)
        this.upsertSession(updated)
        this.refreshOverview(updated.opportunityId)
      } catch (error) {
        this.errorsByScope[getSessionScope(sessionId)] =
          error instanceof Error ? error.message : '重新分析失败，请稍后重试。'
      } finally {
        removeId(this.generatingSessionIds, sessionId)
      }
    },
  },
})
