import { defineStore } from 'pinia'
import type { JobAnalysis, JobAnalysisTask, JobOpportunity } from '@/types/opportunity'
import { createMockJobAnalysis, mockJobAnalysis } from '@/pages/opportunity/mocks/analysis'
import { jobAnalysisApi, type StartJobAnalysisPayload } from '@/services/job-analyses'
import {
  opportunityApi,
  type AddInterviewRoundPayload,
  type CreateOpportunityPayload,
  type JobOpportunityListItem,
  type TerminateOpportunityPayload,
  type UpdateInterviewRoundPayload,
  type UpdateOpportunityPayload,
  type UpdateOpportunityStatusPayload,
  type UpdateWrittenTestReviewPayload,
} from '@/services/opportunities'

const opportunityStoreStorageKey = 'agent-seek-employment:opportunity-store'

type OpportunityState = {
  opportunities: JobOpportunity[]
  analyses: JobAnalysis[]
  analysisTasks: JobAnalysisTask[]
  currentOpportunityId: string | null
  currentAnalysisId: string | null
  isLoading: boolean
  loadError: string | null
}

type OpportunitySelectionState = Pick<
  OpportunityState,
  'opportunities' | 'analyses' | 'currentOpportunityId' | 'currentAnalysisId'
>

const legacyAnalysisDimensionKeys = new Set([
  'hard_skills',
  'project_experience',
  'ai_native',
  'engineering',
  'location',
  'resume_expression',
])

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function normalizeCityList(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value.filter((city) => city.trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]

  return []
}

function resolveCurrentIds(state: OpportunitySelectionState) {
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

function normalizeOpportunitySummary(opportunity: JobOpportunityListItem): JobOpportunity {
  const now = new Date().toISOString()

  return {
    id: opportunity.id,
    company: opportunity.company,
    jobTitle: opportunity.jobTitle,
    address: normalizeCityList(opportunity.address),
    introduction: '',
    description: '',
    status: opportunity.status,
    includeWrittenTest: false,
    intentionLevel: opportunity.intentionLevel,
    industry: opportunity.industry,
    note: '',
    writtenTestReview: {
      scheduledAt: '',
      reviewNote: '',
      updatedAt: opportunity.updatedAt,
    },
    termination: undefined,
    statusHistory: [],
    interviewRounds: [],
    createdAt: opportunity.createdAt || now,
    updatedAt: opportunity.updatedAt || now,
  }
}

function mergeOpportunitySummary(summary: JobOpportunityListItem, currentOpportunity?: JobOpportunity) {
  if (!currentOpportunity) return normalizeOpportunitySummary(summary)

  return {
    ...currentOpportunity,
    company: summary.company,
    jobTitle: summary.jobTitle,
    address: normalizeCityList(summary.address),
    status: summary.status,
    intentionLevel: summary.intentionLevel,
    industry: summary.industry,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  }
}

function upsertOpportunity(list: JobOpportunity[], opportunity: JobOpportunity) {
  const index = list.findIndex((item) => item.id === opportunity.id)

  if (index === -1) {
    list.unshift(opportunity)
    return
  }

  list.splice(index, 1, opportunity)
}

function upsertAnalysisTask(list: JobAnalysisTask[], task: JobAnalysisTask) {
  const index = list.findIndex((item) => item.opportunityId === task.opportunityId)

  if (index === -1) {
    list.unshift(task)
    return
  }

  list.splice(index, 1, task)
}

function upsertOpportunityAnalysis(list: JobAnalysis[], analysis: JobAnalysis) {
  const index = list.findIndex((item) => item.jobOpportunityId === analysis.jobOpportunityId)

  if (index === -1) {
    list.unshift(analysis)
    return
  }

  list.splice(index, 1, analysis)
}

function removeOpportunityAnalysis(list: JobAnalysis[], opportunityId: string) {
  const index = list.findIndex((item) => item.jobOpportunityId === opportunityId)
  if (index >= 0) list.splice(index, 1)
}

function toDisplayAnalysis(task: JobAnalysisTask): JobAnalysis | null {
  if (task.status !== 'completed' || !task.result) return null

  return {
    id: task.id,
    jobOpportunityId: task.opportunityId,
    resumeId: task.resumeId,
    resumeVersionId: task.resumeVersionId,
    ...task.result,
    createdAt: task.completedAt ?? task.createdAt,
  }
}

const analysisPollingOpportunityIds = new Set<string>()

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

export const useOpportunityStore = defineStore('opportunity', {
  state: (): OpportunityState => ({
    opportunities: [],
    analyses: [],
    analysisTasks: [],
    currentOpportunityId: null,
    currentAnalysisId: null,
    isLoading: false,
    loadError: null,
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
        const parsedState = JSON.parse(storedState) as Partial<OpportunityState>
        const storedAnalyses = Array.isArray(parsedState.analyses) ? parsedState.analyses : []
        const analyses = storedAnalyses.map((analysis) => normalizeAnalysis(analysis))
        const hasMigratedAnalysis = analyses.some((analysis, index) => analysis !== storedAnalyses[index])

        this.analyses = analyses
        this.currentOpportunityId = parsedState.currentOpportunityId ?? null
        this.currentAnalysisId = parsedState.currentAnalysisId ?? null

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
          analyses: this.analyses,
          currentOpportunityId: this.currentOpportunityId,
          currentAnalysisId: this.currentAnalysisId,
        }),
      )
    },

    async loadOpportunities() {
      this.isLoading = true
      this.loadError = null

      try {
        const opportunities = await opportunityApi.getOpportunities()
        const normalizedOpportunities = opportunities.map((opportunity) =>
          mergeOpportunitySummary(
            opportunity,
            this.opportunities.find((item) => item.id === opportunity.id),
          ),
        )
        const currentIds = resolveCurrentIds({
          opportunities: normalizedOpportunities,
          analyses: this.analyses,
          currentOpportunityId: this.currentOpportunityId,
          currentAnalysisId: this.currentAnalysisId,
        })

        this.opportunities = normalizedOpportunities
        this.currentOpportunityId = currentIds.currentOpportunityId
        this.currentAnalysisId = currentIds.currentAnalysisId
        this.persistToStorage()
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : 'load opportunities failed'
      } finally {
        this.isLoading = false
      }
    },

    async loadOpportunityDetail(opportunityId: string) {
      this.loadError = null

      try {
        const opportunity = await opportunityApi.getOpportunityById(opportunityId)

        upsertOpportunity(this.opportunities, opportunity)
        await this.loadJobAnalysis(opportunityId)
        this.currentOpportunityId = opportunity.id
        this.currentAnalysisId =
          this.analyses.find((analysis) => analysis.jobOpportunityId === opportunity.id)?.id ?? this.currentAnalysisId
        this.persistToStorage()

        return opportunity
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : 'load opportunity detail failed'
        return null
      }
    },

    async createOpportunity(payload: CreateOpportunityPayload) {
      const opportunity = await opportunityApi.createOpportunity(payload)

      upsertOpportunity(this.opportunities, opportunity)
      this.currentOpportunityId = opportunity.id
      this.currentAnalysisId = null
      this.persistToStorage()

      return opportunity
    },

    async loadJobAnalysis(opportunityId: string) {
      const task = await jobAnalysisApi.getJobAnalysis(opportunityId)
      if (!task) return null

      upsertAnalysisTask(this.analysisTasks, task)
      const analysis = toDisplayAnalysis(task)
      if (analysis) upsertOpportunityAnalysis(this.analyses, analysis)

      this.currentAnalysisId = analysis?.id ?? this.currentAnalysisId
      this.persistToStorage()

      return task
    },

    async startJobAnalysis(opportunityId: string, payload: StartJobAnalysisPayload) {
      const task = await jobAnalysisApi.startJobAnalysis(opportunityId, payload)

      upsertAnalysisTask(this.analysisTasks, task)
      removeOpportunityAnalysis(this.analyses, opportunityId)
      this.currentAnalysisId = null
      this.persistToStorage()

      void this.pollJobAnalysis(opportunityId)

      return task
    },

    async pollJobAnalysis(opportunityId: string) {
      if (analysisPollingOpportunityIds.has(opportunityId)) return

      analysisPollingOpportunityIds.add(opportunityId)
      try {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await delay(1500)
          const task = await this.loadJobAnalysis(opportunityId)
          if (!task || task.status === 'completed' || task.status === 'failed') return
        }
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : 'load job analysis failed'
      } finally {
        analysisPollingOpportunityIds.delete(opportunityId)
      }
    },

    async updateWrittenTestReview(opportunityId: string, payload: UpdateWrittenTestReviewPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const writtenTestReview = await opportunityApi.updateWrittenTestReview(opportunityId, payload)

      opportunity.writtenTestReview = writtenTestReview
      opportunity.updatedAt = writtenTestReview.updatedAt
      this.persistToStorage()

      return opportunity.writtenTestReview
    },

    async updateOpportunity(opportunityId: string, payload: UpdateOpportunityPayload) {
      const opportunity = await opportunityApi.updateOpportunity(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      this.currentOpportunityId = opportunity.id
      this.persistToStorage()

      return opportunity
    },

    async updateOpportunityStatus(opportunityId: string, payload: UpdateOpportunityStatusPayload) {
      const opportunity = await opportunityApi.updateOpportunityStatus(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      this.currentOpportunityId = opportunity.id
      this.persistToStorage()

      return opportunity
    },

    async addInterviewRound(opportunityId: string, payload: AddInterviewRoundPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = await opportunityApi.addInterviewRound(opportunityId, payload)

      opportunity.interviewRounds.push(round)
      opportunity.updatedAt = round.updatedAt
      this.persistToStorage()

      return round
    },

    async updateInterviewRound(opportunityId: string, roundId: string, payload: UpdateInterviewRoundPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = await opportunityApi.updateInterviewRound(opportunityId, roundId, payload)
      const roundIndex = opportunity.interviewRounds.findIndex((item) => item.id === round.id)

      if (roundIndex === -1) {
        opportunity.interviewRounds.push(round)
      } else {
        opportunity.interviewRounds.splice(roundIndex, 1, round)
      }
      opportunity.updatedAt = round.updatedAt
      this.persistToStorage()

      return round
    },

    async deleteInterviewRound(opportunityId: string, roundId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return

      const result = await opportunityApi.deleteInterviewRound(opportunityId, roundId)

      opportunity.interviewRounds = opportunity.interviewRounds.filter((round) => round.id !== result.id)
      opportunity.updatedAt = new Date().toISOString()
      this.persistToStorage()
    },

    async terminateOpportunity(opportunityId: string, payload: TerminateOpportunityPayload = {}) {
      const opportunity = await opportunityApi.terminateOpportunity(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      this.currentOpportunityId = opportunity.id
      this.persistToStorage()

      return opportunity.termination ?? null
    },

    async generateMockAnalysis(opportunityId: string, resumeId: string, resumeVersionId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const analysis: JobAnalysis = createMockJobAnalysis({
        jobOpportunityId: opportunity.id,
        resumeId,
        resumeVersionId,
      })

      this.analyses.unshift(analysis)
      this.currentAnalysisId = analysis.id
      if (opportunity.status !== 'pending_apply' && opportunity.status !== 'closed') {
        const updatedOpportunity = await opportunityApi.updateOpportunityStatus(opportunityId, {
          status: 'pending_apply',
          expectedStatus: opportunity.status,
          note: '生成 JD 匹配分析',
        })
        upsertOpportunity(this.opportunities, updatedOpportunity)
      }
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
