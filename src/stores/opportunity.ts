import { defineStore } from 'pinia'
import type {
  AssessmentRound,
  AssessmentRoundResult,
  AssessmentRoundStatus,
  AssessmentRoundType,
  JobAnalysis,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityStatusChange,
  OpportunityStatusChangeTrigger,
  OpportunityTerminationReasonCode,
  OpportunityIntentionLevel,
  WrittenTestReview,
} from '@/types/opportunity'
import { createMockJobAnalysis, mockJobAnalysis } from '@/pages/opportunity/mocks/analysis'

const opportunityStoreStorageKey = 'agent-seek-employment:opportunity-store'

type OpportunityState = {
  opportunities: JobOpportunity[]
  analyses: JobAnalysis[]
  currentOpportunityId: string | null
  currentAnalysisId: string | null
}

const legacyAnalysisDimensionKeys = new Set([
  'hard_skills',
  'project_experience',
  'ai_native',
  'engineering',
  'location',
  'resume_expression',
])

type CreateOpportunityPayload = {
  company: string
  jobTitle: string
  address?: string[] | string
  introduction?: string
  description: string
}

type UpdateOpportunityPayload = Partial<Omit<CreateOpportunityPayload, 'description'>> & {
  description?: string
  status?: JobOpportunityStatus
  includeWrittenTest?: boolean
  intentionLevel?: OpportunityIntentionLevel
  industry?: string
  note?: string
}

type UpdateWrittenTestReviewPayload = Partial<Pick<WrittenTestReview, 'scheduledAt' | 'reviewNote'>>

type AddInterviewRoundPayload = {
  title: string
  scheduledAt: string
  note: string
}

type UpdateInterviewRoundPayload = Partial<AddInterviewRoundPayload>

type AddAssessmentRoundPayload = {
  type: AssessmentRoundType
  title?: string
  scheduledAt?: string
  status?: AssessmentRoundStatus
  result?: AssessmentRoundResult
  note?: string
  reviewNote?: string
  keyTakeaways?: string[]
}

type UpdateAssessmentRoundPayload = Partial<AddAssessmentRoundPayload>

type TerminateOpportunityPayload = {
  relatedAssessmentRoundId?: string
  reasonCode?: OpportunityTerminationReasonCode
  reasonNote?: string
}

type StoredJobOpportunity = Omit<JobOpportunity, 'assessmentRounds' | 'interviewRounds' | 'writtenTestReview'> & {
  assessmentRounds?: StoredAssessmentRound[]
  interviewRounds?: StoredAssessmentRound[]
  writtenTestReview?: Partial<WrittenTestReview>
}

type StoredAssessmentRound = Partial<Omit<AssessmentRound, 'type'>> & {
  type?: AssessmentRoundType | 'written_test'
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function normalizeCityList(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value.filter((city) => city.trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]

  return []
}

function resolveCurrentIds(state: OpportunityState) {
  const currentOpportunity =
    state.opportunities.find((opportunity) => opportunity.id === state.currentOpportunityId) ??
    state.opportunities[0] ??
    null
  const currentAnalysis =
    state.analyses.find((analysis) => analysis.id === state.currentAnalysisId) ??
    state.analyses.find((analysis) => analysis.jobOpportunityId === currentOpportunity?.id) ??
    null

  return {
    currentOpportunityId: currentOpportunity?.id ?? null,
    currentAnalysisId: currentAnalysis?.id ?? null,
  }
}

function createStatusHistoryItem(
  toStatus: JobOpportunityStatus,
  fromStatus: JobOpportunityStatus | null,
  trigger: OpportunityStatusChangeTrigger = 'user',
  note?: string,
): OpportunityStatusChange {
  return {
    id: crypto.randomUUID(),
    fromStatus,
    toStatus,
    trigger,
    note,
    createdAt: new Date().toISOString(),
  }
}

function normalizeAssessmentRound(round: StoredAssessmentRound, index: number): AssessmentRound {
  const now = new Date().toISOString()

  return {
    id: round.id ?? crypto.randomUUID(),
    type: round.type === 'written_test' ? 'technical_basic' : (round.type ?? 'technical_basic'),
    sequence: round.sequence ?? index + 1,
    title: round.title?.trim() || `第 ${index + 1} 轮`,
    scheduledAt: round.scheduledAt ?? '',
    status: round.status ?? 'planned',
    result: round.result ?? 'pending',
    note: round.note ?? '',
    reviewNote: round.reviewNote ?? '',
    keyTakeaways: Array.isArray(round.keyTakeaways) ? round.keyTakeaways : [],
    createdAt: round.createdAt ?? now,
    updatedAt: round.updatedAt ?? round.createdAt ?? now,
  }
}

function hasLegacyAnalysisDimension(analysis: JobAnalysis) {
  if (!Array.isArray(analysis.scoreBreakdown)) return false

  return analysis.scoreBreakdown.some((item) => legacyAnalysisDimensionKeys.has(String(item.key)))
}

function normalizeAnalysis(analysis: JobAnalysis) {
  if (!hasLegacyAnalysisDimension(analysis)) return analysis

  return {
    ...mockJobAnalysis,
    id: analysis.id,
    jobOpportunityId: analysis.jobOpportunityId,
    resumeId: analysis.resumeId,
    resumeVersionId: analysis.resumeVersionId,
    createdAt: analysis.createdAt,
  }
}

function normalizeOpportunity(opportunity: StoredJobOpportunity): JobOpportunity {
  const sourceRounds = Array.isArray(opportunity.assessmentRounds)
    ? opportunity.assessmentRounds
    : Array.isArray(opportunity.interviewRounds)
      ? opportunity.interviewRounds
      : []
  const writtenTestRound = sourceRounds.find((round) => round.type === 'written_test')
  const assessmentRounds = sourceRounds.filter((round) => round.type !== 'written_test').map(normalizeAssessmentRound)
  const now = new Date().toISOString()
  const writtenTestReview: WrittenTestReview = {
    scheduledAt: opportunity.writtenTestReview?.scheduledAt ?? writtenTestRound?.scheduledAt ?? '',
    reviewNote:
      opportunity.writtenTestReview?.reviewNote ?? writtenTestRound?.reviewNote ?? writtenTestRound?.note ?? '',
    updatedAt:
      opportunity.writtenTestReview?.updatedAt ?? writtenTestRound?.updatedAt ?? writtenTestRound?.createdAt ?? now,
  }

  return {
    ...opportunity,
    status: opportunity.status ?? 'analyzing',
    address: normalizeCityList(opportunity.address),
    includeWrittenTest: opportunity.includeWrittenTest ?? opportunity.status === 'written_test',
    intentionLevel: opportunity.intentionLevel ?? 'B',
    industry: opportunity.industry ?? '',
    note: opportunity.note ?? '',
    writtenTestReview,
    assessmentRounds,
    terminationEvents: Array.isArray(opportunity.terminationEvents) ? opportunity.terminationEvents : [],
    statusHistory: Array.isArray(opportunity.statusHistory) ? opportunity.statusHistory : [],
    // 兼容旧页面：当前 UI 仍使用 interviewRounds，后面会逐步迁移到 assessmentRounds。
    interviewRounds: assessmentRounds,
  }
}

export const useOpportunityStore = defineStore('opportunity', {
  state: (): OpportunityState => ({
    opportunities: [],
    analyses: [],
    currentOpportunityId: null,
    currentAnalysisId: null,
  }),

  getters: {
    currentOpportunity: (state) => {
      return state.opportunities.find((opportunity) => opportunity.id === state.currentOpportunityId) ?? null
    },

    currentAnalysis: (state) => {
      return state.analyses.find((analysis) => analysis.id === state.currentAnalysisId) ?? null
    },
  },

  actions: {
    hydrateFromStorage() {
      if (!canUseLocalStorage()) return

      const storedState = localStorage.getItem(opportunityStoreStorageKey)
      if (!storedState) return

      try {
        const parsedState = JSON.parse(storedState) as OpportunityState
        const opportunities = Array.isArray(parsedState.opportunities)
          ? parsedState.opportunities.map((opportunity) => normalizeOpportunity(opportunity))
          : []
        const storedAnalyses = Array.isArray(parsedState.analyses) ? parsedState.analyses : []
        const analyses = storedAnalyses.map((analysis) => normalizeAnalysis(analysis))
        const hasMigratedAnalysis = analyses.some((analysis, index) => analysis !== storedAnalyses[index])
        const currentIds = resolveCurrentIds({
          opportunities,
          analyses,
          currentOpportunityId: parsedState.currentOpportunityId ?? null,
          currentAnalysisId: parsedState.currentAnalysisId ?? null,
        })

        this.opportunities = opportunities
        this.analyses = analyses
        this.currentOpportunityId = currentIds.currentOpportunityId
        this.currentAnalysisId = currentIds.currentAnalysisId

        if (hasMigratedAnalysis) this.persistToStorage()
      } catch {
        localStorage.removeItem(opportunityStoreStorageKey)
      }
    },

    persistToStorage() {
      if (!canUseLocalStorage()) return

      localStorage.setItem(
        opportunityStoreStorageKey,
        JSON.stringify({
          opportunities: this.opportunities,
          analyses: this.analyses,
          currentOpportunityId: this.currentOpportunityId,
          currentAnalysisId: this.currentAnalysisId,
        }),
      )
    },

    createOpportunity(payload: CreateOpportunityPayload) {
      const now = new Date().toISOString()
      const opportunity: JobOpportunity = {
        id: crypto.randomUUID(),
        company: payload.company.trim(),
        jobTitle: payload.jobTitle.trim(),
        address: normalizeCityList(payload.address),
        introduction: payload.introduction?.trim() ?? '',
        description: payload.description.trim(),
        status: 'analyzing',
        includeWrittenTest: false,
        intentionLevel: 'B',
        industry: '',
        note: '',
        writtenTestReview: {
          scheduledAt: '',
          reviewNote: '',
          updatedAt: now,
        },
        assessmentRounds: [],
        terminationEvents: [],
        statusHistory: [createStatusHistoryItem('analyzing', null, 'system', '创建机会后进入分析中')],
        interviewRounds: [],
        createdAt: now,
        updatedAt: now,
      }

      this.opportunities.unshift(opportunity)
      this.currentOpportunityId = opportunity.id
      this.currentAnalysisId = null
      this.persistToStorage()

      return opportunity
    },

    updateWrittenTestReview(opportunityId: string, payload: UpdateWrittenTestReviewPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const now = new Date().toISOString()

      opportunity.writtenTestReview = {
        scheduledAt: payload.scheduledAt ?? opportunity.writtenTestReview.scheduledAt,
        reviewNote: payload.reviewNote?.trim() ?? opportunity.writtenTestReview.reviewNote,
        updatedAt: now,
      }
      opportunity.updatedAt = now
      this.persistToStorage()

      return opportunity.writtenTestReview
    },

    updateOpportunity(opportunityId: string, payload: UpdateOpportunityPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      if (payload.company !== undefined) opportunity.company = payload.company.trim()
      if (payload.jobTitle !== undefined) opportunity.jobTitle = payload.jobTitle.trim()
      if (payload.address !== undefined) opportunity.address = normalizeCityList(payload.address)
      if (payload.introduction !== undefined) opportunity.introduction = payload.introduction.trim()
      if (payload.description !== undefined) opportunity.description = payload.description.trim()
      if (payload.status !== undefined && payload.status !== opportunity.status) {
        opportunity.statusHistory.unshift(createStatusHistoryItem(payload.status, opportunity.status))
        opportunity.status = payload.status
      }
      if (payload.includeWrittenTest !== undefined) opportunity.includeWrittenTest = payload.includeWrittenTest
      if (payload.intentionLevel !== undefined) opportunity.intentionLevel = payload.intentionLevel
      if (payload.industry !== undefined) opportunity.industry = payload.industry.trim()
      if (payload.note !== undefined) opportunity.note = payload.note.trim()

      opportunity.updatedAt = new Date().toISOString()
      this.persistToStorage()

      return opportunity
    },

    updateOpportunityStatus(opportunityId: string, status: JobOpportunityStatus) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity || opportunity.status === status) return

      opportunity.statusHistory.unshift(createStatusHistoryItem(status, opportunity.status))
      opportunity.status = status
      opportunity.updatedAt = new Date().toISOString()
      this.persistToStorage()
    },

    addAssessmentRound(opportunityId: string, payload: AddAssessmentRoundPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const now = new Date().toISOString()
      const nextSequence = opportunity.assessmentRounds.length + 1
      const round: AssessmentRound = {
        id: crypto.randomUUID(),
        type: payload.type,
        sequence: nextSequence,
        title: payload.title?.trim() || `第 ${nextSequence} 轮`,
        scheduledAt: payload.scheduledAt ?? '',
        status: payload.status ?? 'planned',
        result: payload.result ?? 'pending',
        note: payload.note?.trim() ?? '',
        reviewNote: payload.reviewNote?.trim() ?? '',
        keyTakeaways: payload.keyTakeaways ?? [],
        createdAt: now,
        updatedAt: now,
      }

      opportunity.assessmentRounds.unshift(round)
      opportunity.interviewRounds = opportunity.assessmentRounds
      opportunity.updatedAt = now
      this.persistToStorage()

      return round
    },

    updateAssessmentRound(opportunityId: string, roundId: string, payload: UpdateAssessmentRoundPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = opportunity.assessmentRounds.find((item) => item.id === roundId)
      if (!round) return null

      if (payload.type !== undefined) round.type = payload.type
      if (payload.title !== undefined) round.title = payload.title.trim()
      if (payload.scheduledAt !== undefined) round.scheduledAt = payload.scheduledAt
      if (payload.status !== undefined) round.status = payload.status
      if (payload.result !== undefined) round.result = payload.result
      if (payload.note !== undefined) round.note = payload.note.trim()
      if (payload.reviewNote !== undefined) round.reviewNote = payload.reviewNote.trim()
      if (payload.keyTakeaways !== undefined) round.keyTakeaways = payload.keyTakeaways

      round.updatedAt = new Date().toISOString()
      opportunity.interviewRounds = opportunity.assessmentRounds
      opportunity.updatedAt = round.updatedAt
      this.persistToStorage()

      return round
    },

    deleteAssessmentRound(opportunityId: string, roundId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return

      opportunity.assessmentRounds = opportunity.assessmentRounds.filter((round) => round.id !== roundId)
      opportunity.interviewRounds = opportunity.assessmentRounds
      opportunity.updatedAt = new Date().toISOString()
      this.persistToStorage()
    },

    addInterviewRound(opportunityId: string, payload: AddInterviewRoundPayload) {
      return this.addAssessmentRound(opportunityId, {
        type: 'technical_basic',
        title: payload.title,
        scheduledAt: payload.scheduledAt,
        note: payload.note,
      })
    },

    updateInterviewRound(opportunityId: string, roundId: string, payload: UpdateInterviewRoundPayload) {
      return this.updateAssessmentRound(opportunityId, roundId, payload)
    },

    deleteInterviewRound(opportunityId: string, roundId: string) {
      this.deleteAssessmentRound(opportunityId, roundId)
    },

    terminateOpportunity(opportunityId: string, payload: TerminateOpportunityPayload = {}) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity || opportunity.status === 'closed') return null

      const relatedRound = payload.relatedAssessmentRoundId
        ? opportunity.assessmentRounds.find((round) => round.id === payload.relatedAssessmentRoundId)
        : null
      const now = new Date().toISOString()
      const termination = {
        id: crypto.randomUUID(),
        opportunityId,
        fromStatus: opportunity.status,
        relatedAssessmentRoundId: relatedRound?.id,
        relatedAssessmentRoundTitle: relatedRound?.title,
        reasonCode: payload.reasonCode ?? 'other',
        reasonNote: payload.reasonNote?.trim() ?? '',
        createdAt: now,
      }

      opportunity.terminationEvents.unshift(termination)
      opportunity.statusHistory.unshift(createStatusHistoryItem('closed', opportunity.status, 'user', '流程终止'))
      opportunity.status = 'closed'
      opportunity.updatedAt = now
      this.persistToStorage()

      return termination
    },

    generateMockAnalysis(opportunityId: string, resumeId: string, resumeVersionId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const analysis: JobAnalysis = createMockJobAnalysis({
        jobOpportunityId: opportunity.id,
        resumeId,
        resumeVersionId,
      })

      this.analyses.unshift(analysis)
      this.currentAnalysisId = analysis.id
      opportunity.statusHistory.unshift(
        createStatusHistoryItem('pending_apply', opportunity.status, 'analysis', '生成 JD 匹配分析'),
      )
      opportunity.status = 'pending_apply'
      opportunity.updatedAt = new Date().toISOString()
      this.persistToStorage()

      return analysis
    },

    selectOpportunity(opportunityId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return

      this.currentOpportunityId = opportunity.id
      this.currentAnalysisId =
        this.analyses.find((analysis) => analysis.jobOpportunityId === opportunity.id)?.id ?? null
      this.persistToStorage()
    },

    selectAnalysis(analysisId: string) {
      const analysis = this.analyses.find((item) => item.id === analysisId)
      if (!analysis) return

      this.currentAnalysisId = analysis.id
      this.currentOpportunityId = analysis.jobOpportunityId
      this.persistToStorage()
    },
  },
})
