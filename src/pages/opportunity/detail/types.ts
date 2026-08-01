import type { InterviewRoundType, JobOpportunityStatus, OpportunityIntentionLevel } from '@/types/opportunity'

export type DetailNavKey = 'dashboard' | 'info' | 'mock-interview' | `chat-${number}`

export type DetailNavItem = {
  key: DetailNavKey
  label: string
  icon: string
  description: string
}

export type OpportunityInfoForm = {
  company: string
  jobTitle: string
  address: string[]
  introduction: string
  description: string
  status: JobOpportunityStatus
  includeWrittenTest: boolean
  intentionLevel: OpportunityIntentionLevel
  industry: string
  note: string
}

export type InterviewRoundForm = {
  type: InterviewRoundType
  title: string
  date: string
  note: string
}

export type WrittenTestReviewForm = {
  scheduledAt: string
  reviewNote: string
}

export type ChatItem = {
  id: number
  title: string
  preview: string
}

export type MockInterviewMessage =
  | {
      role: 'interviewer'
      content: string
    }
  | {
      role: 'candidate'
      content: string
      score: number
      feedback: string
    }

export type OverallInterviewScore = {
  score: number
  summary: string
  dimensions: {
    label: string
    score: number
  }[]
}
