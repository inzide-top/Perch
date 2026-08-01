import type { JobAnalysisProgress } from '@/types/opportunity'
import type { LlmConnectionSettings } from '@/types/settings'
import { request } from './http'

export type StartJobAnalysisPayload = {
  resumeId: string
  resumeVersionId: string
  force?: boolean
  modelConnection: LlmConnectionSettings
}

export type JobAnalysisProgressBatchItem = {
  opportunityId: string
  analysis: JobAnalysisProgress | null
}

export const jobAnalysisApi = {
  getJobAnalyses(opportunityIds: string[], options: { includeResult?: boolean } = {}) {
    const query = new URLSearchParams({
      opportunityIds: opportunityIds.join(','),
      includeResult: String(Boolean(options.includeResult)),
    })

    return request.get<JobAnalysisProgressBatchItem[]>(`/opportunities/analyses?${query.toString()}`)
  },

  startJobAnalysis(opportunityId: string, payload: StartJobAnalysisPayload) {
    return request.post<JobAnalysisProgress>(`/opportunities/${encodeURIComponent(opportunityId)}/analysis`, payload)
  },
}
