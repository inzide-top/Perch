import type { JobAnalysisTask } from '@/types/opportunity'
import type { LlmConnectionSettings } from '@/types/settings'
import { request } from './http'

export type StartJobAnalysisPayload = {
  resumeId: string
  resumeVersionId: string
  modelConnection: LlmConnectionSettings
}

export const jobAnalysisApi = {
  getJobAnalysis(opportunityId: string) {
    return request.get<JobAnalysisTask | null>(`/opportunities/${encodeURIComponent(opportunityId)}/analysis`)
  },

  startJobAnalysis(opportunityId: string, payload: StartJobAnalysisPayload) {
    return request.post<JobAnalysisTask>(`/opportunities/${encodeURIComponent(opportunityId)}/analysis`, payload)
  },
}
