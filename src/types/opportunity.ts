/**
 * jd信息
 */
export type JobOpportunityStatus =
  'analyzing' | 'pending_apply' | 'applied' | 'written_test' | 'interviewing' | 'oc' | 'offered' | 'closed'

export type JobOpportunity = {
  id: string
  company: string
  jobTitle: string
  address?: string[]
  introduction: string
  description: string
  status: JobOpportunityStatus
  includeWrittenTest: boolean
  intentionLevel: OpportunityIntentionLevel
  industry: string
  note: string
  writtenTestReview: WrittenTestReview
  assessmentRounds: AssessmentRound[]
  terminationEvents: OpportunityTermination[]
  statusHistory: OpportunityStatusChange[]
  /**
   * @deprecated 旧页面暂时仍读取 interviewRounds；后续统一迁移到 assessmentRounds。
   */
  interviewRounds: InterviewRound[]
  createdAt: string
  updatedAt: string
}

export type OpportunityIntentionLevel = 'S' | 'A' | 'B' | 'C'

export type AssessmentRoundType = 'technical_basic' | 'project' | 'business' | 'hr' | 'manager' | 'other'

export type AssessmentRoundStatus = 'planned' | 'completed' | 'passed' | 'failed' | 'canceled'

export type AssessmentRoundResult = 'pending' | 'passed' | 'failed' | 'unknown'

export type AssessmentRound = {
  id: string
  type: AssessmentRoundType
  sequence: number
  title: string
  scheduledAt: string
  status: AssessmentRoundStatus
  result: AssessmentRoundResult
  note: string
  reviewNote: string
  keyTakeaways: string[]
  createdAt: string
  updatedAt: string
}

export type InterviewRound = AssessmentRound

export type WrittenTestReview = {
  scheduledAt: string
  reviewNote: string
  updatedAt: string
}

export type OpportunityStatusChangeTrigger = 'user' | 'system' | 'analysis'

export type OpportunityStatusChange = {
  id: string
  fromStatus: JobOpportunityStatus | null
  toStatus: JobOpportunityStatus
  trigger: OpportunityStatusChangeTrigger
  note?: string
  createdAt: string
}

export type OpportunityTerminationReasonCode =
  | 'candidate_give_up'
  | 'resume_rejected'
  | 'written_test_failed'
  | 'interview_failed'
  | 'salary_unmatched'
  | 'offer_rejected'
  | 'hiring_freeze'
  | 'other'

export type OpportunityTermination = {
  id: string
  opportunityId: string
  fromStatus: JobOpportunityStatus
  relatedAssessmentRoundId?: string
  relatedAssessmentRoundTitle?: string
  reasonCode: OpportunityTerminationReasonCode
  reasonNote: string
  createdAt: string
}

/**
 * jd分析结果
 */
export type JobAnalysis = {
  id: string
  jobOpportunityId: string
  resumeId: string
  resumeVersionId: string

  matchScore: number
  recommendation: 'strong_match' | 'worth_trying' | 'risky' | 'not_recommended'

  summary: string
  locationMatch: LocationMatch
  scoreBreakdown: MatchScoreBreakdownItem[]
  requirementMatches: RequirementMatch[]
  strengths: AnalysisItem[]
  gaps: AnalysisItem[]
  resumeSuggestions: ResumeSuggestion[]
  interviewFocus: InterviewFocusItem[]

  createdAt: string
}

export type MatchDimensionKey =
  | 'core_requirements'
  | 'related_experience'
  | 'seniority_depth'
  | 'business_context'
  | 'bonus_points'
  | 'job_constraints'

export type MatchScoreBreakdownItem = {
  key: MatchDimensionKey
  label: string
  weight: number
  score: number
  reason: string
  evidenceFromJD?: string
  evidenceFromResume?: string
}

export type LocationMatch = {
  resumeCities: string[]
  jobAddress?: string
  isMatched: boolean
  impact: 'minor'
  reason: string
}

export type JobRequirementSignal = {
  requirement: string
  category: MatchDimensionKey
  requiredLevel: 'expert' | 'proficient' | 'familiar' | 'basic' | 'preferred'
  importance: 'must_have' | 'nice_to_have'
  evidenceFromJD: string
}

export type JobRequirementAnalysis = {
  id: string
  jobOpportunityId: string
  company: string
  jobTitle: string
  address?: string[]
  summary: string
  businessContext: string
  requirementSignals: JobRequirementSignal[]
  scoringFramework: MatchScoreBreakdownItem[]
  createdAt: string
}

export type AnalysisItem = {
  title: string
  evidenceFromJD: string
  evidenceFromResume?: string
  level: 'high' | 'medium' | 'low'
  reason: string
}

export type ResumeSuggestion = {
  targetSection: 'summary' | 'skills' | 'project' | 'experience'
  title: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  relatedJDText?: string
}

export type InterviewFocusItem = {
  topic: string
  reason: string
  difficulty: 'basic' | 'medium' | 'advanced'
}

export type RequirementMatch = {
  requirement: string
  requiredLevel: 'expert' | 'proficient' | 'familiar' | 'basic' | 'preferred'
  resumeEvidence?: string
  candidateLevel: 'expert' | 'proficient' | 'familiar' | 'basic' | 'missing'
  matchStatus: 'matched' | 'partial' | 'missing' | 'overqualified'
  importance: 'must_have' | 'nice_to_have'
  risk: 'high' | 'medium' | 'low'
  suggestion?: string
}
