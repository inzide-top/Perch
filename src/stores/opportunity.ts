import { defineStore } from 'pinia'
import type { JobAnalysis, JobAnalysisListSummary, JobAnalysisResult, JobOpportunity } from '@/types/opportunity'
import type { ReviewDocumentSummary } from '@/types/review'
import type { LlmConnectionSettings } from '@/types/settings'
import { jobAnalysisApi, type StartJobAnalysisPayload } from '@/services/job-analyses'
import { useBackgroundTaskStore, type BackgroundTaskEntry } from './background-tasks'
import {
  opportunityApi,
  type AddInterviewRoundPayload,
  type CreateOpportunityPayload,
  type JobOpportunityListItem,
  type OpportunityListFilters,
  type TerminateOpportunityPayload,
  type UpdateInterviewRoundPayload,
  type UpdateOpportunityPayload,
  type UpdateOpportunityStatusPayload,
  type UpdateWrittenTestReviewPayload,
} from '@/services/opportunities'

const opportunityStoreStorageKey = 'agent-seek-employment:opportunity-store'

type JobAnalysisTaskState = JobAnalysisListSummary & {
  opportunityId: string
  result: JobAnalysisResult | null
}

type OpportunityDetailCacheEntry = {
  cachedAt: number
  opportunityUpdatedAt: string
  analysisUpdatedAt: string | null
}

type OpportunityState = {
  opportunities: JobOpportunity[]
  analyses: JobAnalysis[]
  analysisTasks: JobAnalysisTaskState[]
  currentOpportunityId: string | null
  currentAnalysisId: string | null
  opportunityDetailCache: Record<string, OpportunityDetailCacheEntry>
  isInitialLoading: boolean
  isRefreshing: boolean
  opportunitiesLoadedAt: number | null
  opportunityListFilterKey: string
  loadError: string | null
  reviewDocumentsByOpportunity: Record<string, ReviewDocumentSummary[]>
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
    state.analyses.find((analysis) => analysis.opportunityId === currentOpportunity?.id) ??
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

function upsertAnalysisTask(list: JobAnalysisTaskState[], task: JobAnalysisTaskState) {
  const index = list.findIndex((item) => item.opportunityId === task.opportunityId)

  if (index === -1) {
    list.unshift(task)
    return
  }

  list.splice(index, 1, task)
}

function upsertOpportunityAnalysis(list: JobAnalysis[], analysis: JobAnalysis) {
  const index = list.findIndex((item) => item.opportunityId === analysis.opportunityId)

  if (index === -1) {
    list.unshift(analysis)
    return
  }

  list.splice(index, 1, analysis)
}

function removeOpportunityAnalysis(list: JobAnalysis[], opportunityId: string) {
  const index = list.findIndex((item) => item.opportunityId === opportunityId)
  if (index >= 0) list.splice(index, 1)
}

function toDisplayAnalysis(task: JobAnalysisTaskState): JobAnalysis | null {
  if (task.status !== 'completed' || !task.result) return null

  return {
    id: task.opportunityId,
    opportunityId: task.opportunityId,
    resumeId: '',
    resumeVersionId: '',
    ...task.result,
    createdAt: task.createdAt,
  }
}

const opportunityListCacheTtlMs = 60_000
const opportunityDetailCacheMaxAgeMs = 30 * 60 * 1_000
const maxOpportunityDetailCacheEntries = 20
const opportunityDetailRequests = new Map<string, Promise<JobOpportunity>>()
let opportunitiesLoadRequest: { filterKey: string; promise: Promise<void> } | null = null
let opportunitiesLoadAbortController: AbortController | null = null
let opportunityListLoadSequence = 0

function isRequestAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isDetailCacheFresh(
  entry: OpportunityDetailCacheEntry | undefined,
  opportunity: JobOpportunity | undefined,
  analysisTask: JobAnalysisTaskState | undefined,
) {
  if (!entry || !opportunity) return false

  return (
    entry.opportunityUpdatedAt === opportunity.updatedAt &&
    entry.analysisUpdatedAt === (analysisTask?.updatedAt ?? null) &&
    Date.now() - entry.cachedAt < opportunityDetailCacheMaxAgeMs
  )
}

function createOpportunityListFilterKey(filters: OpportunityListFilters) {
  return JSON.stringify({
    statuses: [...(filters.statuses ?? [])].sort(),
    intentionLevels: [...(filters.intentionLevels ?? [])].sort(),
    recommendations: [...(filters.recommendations ?? [])].sort(),
    regions: [...(filters.regions ?? [])].sort(),
  })
}

function cacheOpportunityDetail(
  cache: Record<string, OpportunityDetailCacheEntry>,
  opportunity: JobOpportunity,
  analysisTask: JobAnalysisTaskState | undefined,
) {
  cache[opportunity.id] = {
    cachedAt: Date.now(),
    opportunityUpdatedAt: opportunity.updatedAt,
    analysisUpdatedAt: analysisTask?.updatedAt ?? null,
  }

  const overflowEntries = Object.entries(cache)
    .sort(([, current], [, next]) => current.cachedAt - next.cachedAt)
    .slice(0, Math.max(0, Object.keys(cache).length - maxOpportunityDetailCacheEntries))

  for (const [expiredOpportunityId] of overflowEntries) {
    delete cache[expiredOpportunityId]
  }
}

export const useOpportunityStore = defineStore('opportunity', {
  state: (): OpportunityState => ({
    opportunities: [],
    analyses: [],
    analysisTasks: [],
    currentOpportunityId: null,
    currentAnalysisId: null,
    opportunityDetailCache: {},
    isInitialLoading: false,
    isRefreshing: false,
    opportunitiesLoadedAt: null,
    opportunityListFilterKey: '',
    loadError: null,
    reviewDocumentsByOpportunity: {},
  }),

  getters: {
    currentOpportunity: (state) => {
      return state.opportunities.find((opportunity) => opportunity.id === state.currentOpportunityId) ?? null
    },

    currentAnalysis: (state) => {
      return state.analyses.find((analysis) => analysis.id === state.currentAnalysisId) ?? null
    },

    hasOpportunityDetail: (state) => (opportunityId: string) => {
      return Boolean(state.opportunityDetailCache[opportunityId])
    },

    isOpportunityDetailFresh: (state) => (opportunityId: string) => {
      return isDetailCacheFresh(
        state.opportunityDetailCache[opportunityId],
        state.opportunities.find((opportunity) => opportunity.id === opportunityId),
        state.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
    },

    isOpportunityListFresh:
      (state) =>
      (filters: OpportunityListFilters = {}) => {
        return Boolean(
          state.opportunitiesLoadedAt &&
          state.opportunityListFilterKey === createOpportunityListFilterKey(filters) &&
          Date.now() - state.opportunitiesLoadedAt < opportunityListCacheTtlMs,
        )
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
        const analyses = storedAnalyses.filter((analysis) => !hasLegacyAnalysisDimension(analysis))
        const hasRemovedLegacyAnalysis = analyses.length !== storedAnalyses.length

        this.analyses = analyses
        this.currentOpportunityId = parsedState.currentOpportunityId ?? null
        this.currentAnalysisId = parsedState.currentAnalysisId ?? null

        if (hasRemovedLegacyAnalysis) this.persistToStorage()
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

    async loadOpportunities(options: { force?: boolean; filters?: OpportunityListFilters } = {}) {
      const filters = options.filters ?? {}
      const filterKey = createOpportunityListFilterKey(filters)
      if (!options.force && this.isOpportunityListFresh(filters)) return
      if (opportunitiesLoadRequest?.filterKey === filterKey) return opportunitiesLoadRequest.promise

      opportunitiesLoadAbortController?.abort()
      const abortController = new AbortController()
      opportunitiesLoadAbortController = abortController

      const isInitialLoad = this.opportunities.length === 0
      if (isInitialLoad) this.isInitialLoading = true
      else this.isRefreshing = true
      this.loadError = null

      const requestSequence = ++opportunityListLoadSequence
      const request = (async () => {
        const opportunities = await opportunityApi.getOpportunities(filters, { signal: abortController.signal })
        if (requestSequence !== opportunityListLoadSequence) return
        const normalizedOpportunities = opportunities.map((opportunity) =>
          mergeOpportunitySummary(
            opportunity,
            this.opportunities.find((item) => item.id === opportunity.id),
          ),
        )
        const analysisTasks = opportunities.flatMap((opportunity) =>
          opportunity.analysis ? [{ ...opportunity.analysis, opportunityId: opportunity.id, result: null }] : [],
        )
        const currentIds = resolveCurrentIds({
          opportunities: normalizedOpportunities,
          analyses: this.analyses,
          currentOpportunityId: this.currentOpportunityId,
          currentAnalysisId: this.currentAnalysisId,
        })

        this.opportunities = normalizedOpportunities
        this.analysisTasks = analysisTasks
        this.currentOpportunityId = currentIds.currentOpportunityId
        this.currentAnalysisId = currentIds.currentAnalysisId
        this.opportunitiesLoadedAt = Date.now()
        this.opportunityListFilterKey = filterKey
        this.persistToStorage()

        if (analysisTasks.some((task) => task.status === 'pending' || task.status === 'processing')) {
          void this.pollJobAnalyses()
        }
      })()
      opportunitiesLoadRequest = { filterKey, promise: request }

      try {
        await request
      } catch (error) {
        if (!isRequestAbortError(error) && requestSequence === opportunityListLoadSequence) {
          this.loadError = error instanceof Error ? error.message : 'load opportunities failed'
        }
      } finally {
        if (requestSequence === opportunityListLoadSequence) {
          this.isInitialLoading = false
          this.isRefreshing = false
        }
        if (opportunitiesLoadRequest?.promise === request) opportunitiesLoadRequest = null
        if (opportunitiesLoadAbortController === abortController) opportunitiesLoadAbortController = null
      }
    },

    async loadOpportunityDetail(opportunityId: string, options: { force?: boolean; silent?: boolean } = {}) {
      if (!options.silent) this.loadError = null

      if (!options.force && this.isOpportunityDetailFresh(opportunityId)) {
        return this.opportunities.find((item) => item.id === opportunityId) ?? null
      }

      let detailRequest = opportunityDetailRequests.get(opportunityId)
      if (!detailRequest) {
        detailRequest = (async () => {
          const opportunity = await opportunityApi.getOpportunityById(opportunityId)

          upsertOpportunity(this.opportunities, opportunity)
          const analysisTask = await this.loadJobAnalysis(opportunityId, { select: false })
          cacheOpportunityDetail(this.opportunityDetailCache, opportunity, analysisTask ?? undefined)
          this.persistToStorage()

          return opportunity
        })()
        opportunityDetailRequests.set(opportunityId, detailRequest)
      }

      try {
        const opportunity = await detailRequest

        if (!options.silent) {
          this.currentOpportunityId = opportunity.id
          this.currentAnalysisId =
            this.analyses.find((analysis) => analysis.opportunityId === opportunity.id)?.id ?? this.currentAnalysisId
          this.persistToStorage()
        }

        return opportunity
      } catch (error) {
        if (!options.silent) {
          this.loadError = error instanceof Error ? error.message : 'load opportunity detail failed'
        }
        return null
      } finally {
        if (opportunityDetailRequests.get(opportunityId) === detailRequest) {
          opportunityDetailRequests.delete(opportunityId)
        }
      }
    },

    async createOpportunity(payload: CreateOpportunityPayload) {
      return opportunityApi.createOpportunity(payload)
    },

    async deleteOpportunity(opportunityId: string) {
      const result = await opportunityApi.deleteOpportunity(opportunityId)

      useBackgroundTaskStore().unregister({ type: 'job_analysis', opportunityId: result.id })
      this.opportunities = this.opportunities.filter((opportunity) => opportunity.id !== result.id)
      this.analysisTasks = this.analysisTasks.filter((task) => task.opportunityId !== result.id)
      this.analyses = this.analyses.filter((analysis) => analysis.opportunityId !== result.id)
      delete this.opportunityDetailCache[result.id]

      const currentIds = resolveCurrentIds({
        opportunities: this.opportunities,
        analyses: this.analyses,
        currentOpportunityId: this.currentOpportunityId,
        currentAnalysisId: this.currentAnalysisId,
      })
      this.currentOpportunityId = currentIds.currentOpportunityId
      this.currentAnalysisId = currentIds.currentAnalysisId
      this.opportunitiesLoadedAt = Date.now()
      this.persistToStorage()

      return result
    },

    async loadJobAnalysis(opportunityId: string, options: { select?: boolean } = {}) {
      const [progressItem] = await jobAnalysisApi.getJobAnalyses([opportunityId], { includeResult: true })
      const progress = progressItem?.analysis ?? null
      if (!progress) return null
      const task = { ...progress, opportunityId }

      upsertAnalysisTask(this.analysisTasks, task)
      const analysis = toDisplayAnalysis(task)
      if (analysis) upsertOpportunityAnalysis(this.analyses, analysis)

      if (options.select !== false) this.currentAnalysisId = analysis?.id ?? this.currentAnalysisId
      this.persistToStorage()

      if (task.status === 'pending' || task.status === 'processing') {
        const opportunity = this.opportunities.find((item) => item.id === opportunityId)
        useBackgroundTaskStore().register(
          { type: 'job_analysis', opportunityId },
          opportunity ? { primary: `${opportunity.company} · ${opportunity.jobTitle}` } : undefined,
        )
      }

      return task
    },

    async startJobAnalysis(opportunityId: string, payload: StartJobAnalysisPayload) {
      const progress = await jobAnalysisApi.startJobAnalysis(opportunityId, payload)
      if (progress.status === 'pending' || progress.status === 'processing') {
        const backgroundTaskStore = useBackgroundTaskStore()
        const opportunity = this.opportunities.find((item) => item.id === opportunityId)
        backgroundTaskStore.reset({ type: 'job_analysis', opportunityId })
        backgroundTaskStore.register(
          { type: 'job_analysis', opportunityId },
          opportunity ? { primary: `${opportunity.company} · ${opportunity.jobTitle}` } : undefined,
        )
      }
      return { ...progress, opportunityId }
    },

    async retryJobAnalysis(opportunityId: string, payload: StartJobAnalysisPayload) {
      const task = await this.startJobAnalysis(opportunityId, { ...payload, force: true })

      upsertAnalysisTask(this.analysisTasks, task)
      removeOpportunityAnalysis(this.analyses, opportunityId)
      delete this.opportunityDetailCache[opportunityId]
      this.currentAnalysisId = null
      this.opportunitiesLoadedAt = Date.now()
      this.persistToStorage()

      useBackgroundTaskStore().register({ type: 'job_analysis', opportunityId })

      return task
    },

    publishCreatedOpportunity(opportunity: JobOpportunity, task: JobAnalysisTaskState) {
      upsertOpportunity(this.opportunities, opportunity)
      upsertAnalysisTask(this.analysisTasks, task)
      removeOpportunityAnalysis(this.analyses, opportunity.id)
      delete this.opportunityDetailCache[opportunity.id]
      this.currentOpportunityId = opportunity.id
      this.currentAnalysisId = null
      this.opportunitiesLoadedAt = Date.now()
      this.persistToStorage()

      useBackgroundTaskStore().register(
        { type: 'job_analysis', opportunityId: opportunity.id },
        { primary: `${opportunity.company} · ${opportunity.jobTitle}` },
      )
    },

    applyBackgroundAnalysisTask(task: BackgroundTaskEntry) {
      if (task.type !== 'job_analysis') return

      if (task.status === 'missing') {
        this.analysisTasks = this.analysisTasks.filter((item) => item.opportunityId !== task.opportunityId)
        return
      }

      const taskState: JobAnalysisTaskState = {
        opportunityId: task.opportunityId,
        ...(task.analysis as JobAnalysisListSummary),
        result: task.analysis?.result ?? null,
      }
      upsertAnalysisTask(this.analysisTasks, taskState)
      const analysis = toDisplayAnalysis(taskState)
      if (analysis) upsertOpportunityAnalysis(this.analyses, analysis)
      else removeOpportunityAnalysis(this.analyses, task.opportunityId)
      delete this.opportunityDetailCache[task.opportunityId]
      this.persistToStorage()
    },

    async pollJobAnalyses() {
      useBackgroundTaskStore().registerMany(
        this.analysisTasks
          .filter((task) => task.status === 'pending' || task.status === 'processing')
          .map((task) => ({ type: 'job_analysis' as const, opportunityId: task.opportunityId })),
      )
    },

    async updateWrittenTestReview(opportunityId: string, payload: UpdateWrittenTestReviewPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const writtenTestReview = await opportunityApi.updateWrittenTestReview(opportunityId, payload)

      opportunity.writtenTestReview = writtenTestReview
      opportunity.updatedAt = writtenTestReview.updatedAt
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
      this.persistToStorage()

      return opportunity.writtenTestReview
    },

    async loadReviewDocuments(opportunityId: string) {
      const documents = await opportunityApi.getReviewDocuments(opportunityId)
      this.reviewDocumentsByOpportunity[opportunityId] = documents
      return documents
    },

    async retryReviewDocument(opportunityId: string, documentId: string, modelConnection: LlmConnectionSettings) {
      const document = await opportunityApi.retryReviewDocument(opportunityId, documentId, modelConnection)
      const documents = this.reviewDocumentsByOpportunity[opportunityId] ?? []
      const index = documents.findIndex((item) => item.id === document.id)

      if (index === -1) documents.push(document)
      else documents.splice(index, 1, document)

      this.reviewDocumentsByOpportunity[opportunityId] = documents
      return document
    },

    async updateOpportunity(opportunityId: string, payload: UpdateOpportunityPayload) {
      const opportunity = await opportunityApi.updateOpportunity(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunity.id),
      )
      this.currentOpportunityId = opportunity.id
      this.opportunitiesLoadedAt = Date.now()
      this.persistToStorage()

      return opportunity
    },

    async updateOpportunityStatus(opportunityId: string, payload: UpdateOpportunityStatusPayload) {
      const opportunity = await opportunityApi.updateOpportunityStatus(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunity.id),
      )
      this.currentOpportunityId = opportunity.id
      this.opportunitiesLoadedAt = Date.now()
      this.persistToStorage()

      return opportunity
    },

    async addInterviewRound(opportunityId: string, payload: AddInterviewRoundPayload) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = await opportunityApi.addInterviewRound(opportunityId, payload)

      opportunity.interviewRounds.push(round)
      opportunity.updatedAt = round.updatedAt
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
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
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
      this.persistToStorage()

      return round
    },

    async completeInterviewRound(opportunityId: string, roundId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = await opportunityApi.completeInterviewRound(opportunityId, roundId)
      const roundIndex = opportunity.interviewRounds.findIndex((item) => item.id === round.id)

      if (roundIndex === -1) opportunity.interviewRounds.push(round)
      else opportunity.interviewRounds.splice(roundIndex, 1, round)

      opportunity.updatedAt = round.updatedAt
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
      this.persistToStorage()

      return round
    },

    async cancelInterviewRound(opportunityId: string, roundId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return null

      const round = await opportunityApi.cancelInterviewRound(opportunityId, roundId)
      const roundIndex = opportunity.interviewRounds.findIndex((item) => item.id === round.id)

      if (roundIndex === -1) opportunity.interviewRounds.push(round)
      else opportunity.interviewRounds.splice(roundIndex, 1, round)

      opportunity.updatedAt = round.updatedAt
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
      this.persistToStorage()

      return round
    },

    async deleteInterviewRound(opportunityId: string, roundId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return

      const result = await opportunityApi.deleteInterviewRound(opportunityId, roundId)

      opportunity.interviewRounds = opportunity.interviewRounds.filter((round) => round.id !== result.id)
      opportunity.updatedAt = new Date().toISOString()
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunityId),
      )
      this.persistToStorage()
    },

    async terminateOpportunity(opportunityId: string, payload: TerminateOpportunityPayload = {}) {
      const opportunity = await opportunityApi.terminateOpportunity(opportunityId, payload)

      upsertOpportunity(this.opportunities, opportunity)
      cacheOpportunityDetail(
        this.opportunityDetailCache,
        opportunity,
        this.analysisTasks.find((task) => task.opportunityId === opportunity.id),
      )
      this.currentOpportunityId = opportunity.id
      this.persistToStorage()

      return opportunity.termination ?? null
    },

    selectOpportunity(opportunityId: string) {
      const opportunity = this.opportunities.find((item) => item.id === opportunityId)
      if (!opportunity) return

      this.currentOpportunityId = opportunity.id
      this.currentAnalysisId = this.analyses.find((analysis) => analysis.opportunityId === opportunity.id)?.id ?? null
      this.persistToStorage()
    },

    selectAnalysis(analysisId: string) {
      const analysis = this.analyses.find((item) => item.id === analysisId)
      if (!analysis) return

      this.currentAnalysisId = analysis.id
      this.currentOpportunityId = analysis.opportunityId
      this.persistToStorage()
    },
  },
})
