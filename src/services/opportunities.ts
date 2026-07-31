import type {
  InterviewRound,
  InterviewRoundResult,
  InterviewRoundStatus,
  InterviewRoundType,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
  OpportunityTerminationReasonCode,
  WrittenTestReview,
} from '@/types/opportunity'
import { request } from './http'

export type JobOpportunityListItem = Pick<
  JobOpportunity,
  'id' | 'company' | 'jobTitle' | 'address' | 'status' | 'intentionLevel' | 'industry' | 'createdAt' | 'updatedAt'
>

export type CreateOpportunityPayload = {
  company: string
  jobTitle: string
  address?: string[] | string
  introduction?: string
  description: string
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

export type UpdateWrittenTestReviewPayload = Partial<Pick<WrittenTestReview, 'scheduledAt' | 'reviewNote'>>

export type AddInterviewRoundPayload = {
  type: InterviewRoundType
  title?: string
  scheduledAt?: string
  status?: InterviewRoundStatus
  result?: InterviewRoundResult
  note?: string
  reviewNote?: string
  keyTakeaways?: string[]
}

export type UpdateInterviewRoundPayload = Partial<AddInterviewRoundPayload>

export type TerminateOpportunityPayload = {
  relatedInterviewRoundId?: string
  reasonCode?: OpportunityTerminationReasonCode
  reasonNote?: string
}

export const opportunityApi = {
  getOpportunities() {
    return request.get<JobOpportunityListItem[]>('/opportunities')
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
