import type {
  InterviewRound,
  InterviewRoundResult,
  InterviewRoundStatus,
  InterviewRoundType,
  JobAnalysisListSummary,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
  OpportunityTerminationReasonCode,
  WrittenTestReview,
} from '@/types/opportunity'
import type { AnalysisRecommendation } from '@/shared/opportunity/analysisPresentation'
import type { OpportunityRegion } from '@/shared/opportunity/geography'
import type { LlmConnectionSettings } from '@/types/settings'
import type { ReviewDocumentSummary } from '@/types/review'
import { ApiRequestError, request, type RequestOptions } from './http'

export type JobOpportunityListItem = Pick<
  JobOpportunity,
  'id' | 'company' | 'jobTitle' | 'address' | 'status' | 'intentionLevel' | 'industry' | 'createdAt' | 'updatedAt'
> & {
  analysis: JobAnalysisListSummary | null
}

export type OpportunityListFilters = {
  statuses?: JobOpportunityStatus[]
  intentionLevels?: OpportunityIntentionLevel[]
  recommendations?: AnalysisRecommendation[]
  regions?: OpportunityRegion[]
}

export type CreateOpportunityPayload = {
  company: string
  jobTitle: string
  address?: string[] | string
  introduction?: string
  description: string
}

export type DuplicateOpportunityConflict = {
  code: 'duplicate_opportunity'
  details: {
    existingOpportunity: Pick<JobOpportunity, 'id' | 'company' | 'jobTitle' | 'address'> & {
      analysisStatus: 'pending' | 'processing' | 'completed' | 'failed' | null
    }
  }
}

export function getDuplicateOpportunityConflict(error: unknown): DuplicateOpportunityConflict | null {
  if (
    !(error instanceof ApiRequestError) ||
    error.status !== 409 ||
    typeof error.data !== 'object' ||
    error.data === null
  ) {
    return null
  }

  const data = error.data as Partial<DuplicateOpportunityConflict>
  if (data.code !== 'duplicate_opportunity' || !data.details?.existingOpportunity) return null

  return data as DuplicateOpportunityConflict
}

export type UpdateOpportunityPayload = Partial<Omit<CreateOpportunityPayload, 'description'>> & {
  description?: string
  includeWrittenTest?: boolean
  intentionLevel?: OpportunityIntentionLevel
  industry?: string
  note?: string
}

export type UpdateOpportunityStatusPayload = {
  status: Exclude<JobOpportunityStatus, 'closed'>
  expectedStatus: Exclude<JobOpportunityStatus, 'closed'>
  note?: string
}

export type UpdateWrittenTestReviewPayload = Partial<Pick<WrittenTestReview, 'scheduledAt' | 'reviewNote'>> & {
  modelConnection?: LlmConnectionSettings
}

export type AddInterviewRoundPayload = {
  type: InterviewRoundType
  title?: string
  scheduledAt?: string
  status?: InterviewRoundStatus
  result?: InterviewRoundResult
  note?: string
  reviewNote?: string
  keyTakeaways?: string[]
  modelConnection?: LlmConnectionSettings
}

export type UpdateInterviewRoundPayload = Partial<AddInterviewRoundPayload>

export type CompleteInterviewRoundPayload = {
  result?: Exclude<InterviewRoundResult, 'pending'>
}

export type TerminateOpportunityPayload = {
  relatedInterviewRoundId?: string
  reasonCode?: OpportunityTerminationReasonCode
  reasonNote?: string
}

export const opportunityApi = {
  getOpportunities(filters: OpportunityListFilters = {}, options: RequestOptions = {}) {
    const query = new URLSearchParams()
    if (filters.statuses?.length) query.set('statuses', filters.statuses.join(','))
    if (filters.intentionLevels?.length) query.set('intentionLevels', filters.intentionLevels.join(','))
    if (filters.recommendations?.length) query.set('recommendations', filters.recommendations.join(','))
    if (filters.regions?.length) query.set('regions', filters.regions.join(','))
    const suffix = query.size > 0 ? `?${query.toString()}` : ''

    return request.get<JobOpportunityListItem[]>(`/opportunities${suffix}`, options)
  },

  getOpportunityById(opportunityId: string) {
    return request.get<JobOpportunity>(`/opportunities/${encodeURIComponent(opportunityId)}`)
  },

  createOpportunity(payload: CreateOpportunityPayload) {
    return request.post<JobOpportunity>('/opportunities', {
      ...payload,
      address: normalizeCityList(payload.address),
    })
  },

  deleteOpportunity(opportunityId: string) {
    return request.delete<{ id: string }>(`/opportunities/${encodeURIComponent(opportunityId)}`)
  },

  updateOpportunity(opportunityId: string, payload: UpdateOpportunityPayload) {
    return request.patch<JobOpportunity>(`/opportunities/${encodeURIComponent(opportunityId)}`, {
      ...payload,
      address: payload.address === undefined ? undefined : normalizeCityList(payload.address),
    })
  },

  updateOpportunityStatus(opportunityId: string, payload: UpdateOpportunityStatusPayload) {
    return request.patch<JobOpportunity>(`/opportunities/${encodeURIComponent(opportunityId)}/status`, payload)
  },

  updateWrittenTestReview(opportunityId: string, payload: UpdateWrittenTestReviewPayload) {
    return request.patch<WrittenTestReview>(
      `/opportunities/${encodeURIComponent(opportunityId)}/written-test-review`,
      payload,
    )
  },

  addInterviewRound(opportunityId: string, payload: AddInterviewRoundPayload) {
    return request.post<InterviewRound>(`/opportunities/${encodeURIComponent(opportunityId)}/interview-rounds`, payload)
  },

  updateInterviewRound(opportunityId: string, roundId: string, payload: UpdateInterviewRoundPayload) {
    return request.patch<InterviewRound>(
      `/opportunities/${encodeURIComponent(opportunityId)}/interview-rounds/${encodeURIComponent(roundId)}`,
      payload,
    )
  },

  completeInterviewRound(opportunityId: string, roundId: string, payload: CompleteInterviewRoundPayload = {}) {
    return request.post<InterviewRound>(
      `/opportunities/${encodeURIComponent(opportunityId)}/interview-rounds/${encodeURIComponent(roundId)}/complete`,
      payload,
    )
  },

  cancelInterviewRound(opportunityId: string, roundId: string) {
    return request.post<InterviewRound>(
      `/opportunities/${encodeURIComponent(opportunityId)}/interview-rounds/${encodeURIComponent(roundId)}/cancel`,
      {},
    )
  },

  getReviewDocuments(opportunityId: string) {
    return request.get<ReviewDocumentSummary[]>(`/opportunities/${encodeURIComponent(opportunityId)}/review-documents`)
  },

  retryReviewDocument(opportunityId: string, documentId: string, modelConnection: LlmConnectionSettings) {
    return request.post<ReviewDocumentSummary>(
      `/opportunities/${encodeURIComponent(opportunityId)}/review-documents/${encodeURIComponent(documentId)}/retry`,
      { modelConnection },
    )
  },

  deleteInterviewRound(opportunityId: string, roundId: string) {
    return request.delete<{ id: string }>(
      `/opportunities/${encodeURIComponent(opportunityId)}/interview-rounds/${encodeURIComponent(roundId)}`,
    )
  },

  terminateOpportunity(opportunityId: string, payload: TerminateOpportunityPayload = {}) {
    return request.post<JobOpportunity>(`/opportunities/${encodeURIComponent(opportunityId)}/termination`, payload)
  },
}

function normalizeCityList(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value.filter((city) => city.trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]

  return []
}
