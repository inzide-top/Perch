import type { ResumeContent } from './resume'

/**
 * jd信息
 */
export type JobOpportunityStatus =
  'pending_apply' | 'applied' | 'written_test' | 'interviewing' | 'oc' | 'offered' | 'closed'

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
  /** 机会关闭后只有一条终止记录；未终止时不存在。 */
  termination?: OpportunityTermination
  statusHistory: OpportunityStatusChange[]
  interviewRounds: InterviewRound[]
  createdAt: string
  updatedAt: string
}

export type OpportunityIntentionLevel = 'S' | 'A' | 'B' | 'C'

export type InterviewRoundType = 'technical_basic' | 'project' | 'business' | 'hr' | 'manager' | 'other'

export type InterviewRoundStatus = 'planned' | 'completed' | 'passed' | 'failed' | 'canceled'

export type InterviewRoundResult = 'pending' | 'passed' | 'failed' | 'unknown'

export type InterviewRound = {
  id: string
  type: InterviewRoundType
  sequence: number
  title: string
  scheduledAt: string
  status: InterviewRoundStatus
  result: InterviewRoundResult
  note: string
  reviewNote: string
  keyTakeaways: string[]
  createdAt: string
  updatedAt: string
}

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
  relatedInterviewRoundId?: string
  relatedInterviewRoundTitle?: string
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

/** AI 分析任务自身的运行状态，与 JobOpportunity 的求职流程状态完全独立。 */
export type JobAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** 持久化的 JD 分析任务；result 为空时，前端只展示任务状态而不渲染匹配结论。 */
/** 服务端内部持久化对象；不直接作为前端 API 响应。 */
export type JobAnalysisTask = {
  id: string
  opportunityId: string
  resumeId: string
  resumeVersionId: string
  status: JobAnalysisStatus
  result: JobAnalysisResult | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** 面向前端的任务进度，不暴露内部关联 ID。 */
export type JobAnalysisProgress = {
  status: JobAnalysisStatus
  currentAttempt: number
  maxAttempts: number
  matchScore: number | null
  result: JobAnalysisResult | null
  error: Pick<AgentRunError, 'code' | 'message'> | null
  updatedAt: string
}

/** 机会列表只需要轻量分析摘要，详情页才拉取完整 result。 */
export type JobAnalysisListSummary = Omit<JobAnalysisProgress, 'result'>

/**
 * 模型成功输出并通过结构化校验后，写入 JobAnalysis.result 的内容。
 * 暂时复用现有前端分析展示字段，后续接入 API 时再将页面 DTO 迁移到这个结构。
 */
export type JobAnalysisResult = Pick<
  JobAnalysis,
  | 'matchScore'
  | 'recommendation'
  | 'summary'
  | 'locationMatch'
  | 'scoreBreakdown'
  | 'requirementMatches'
  | 'strengths'
  | 'gaps'
  | 'resumeSuggestions'
  | 'interviewFocus'
>

/** 单次 Agent 执行状态；一次分析允许产生多次重试执行。 */
export type AgentRunStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** 保存模型调用时的结构化快照，便于日后回放和排错。 */
export type JobAnalysisRunInput = {
  resume: ResumeContent
  opportunity: Pick<JobOpportunity, 'company' | 'jobTitle' | 'address' | 'introduction' | 'description'>
}

/** 不保存原生 Error 实例，保存可序列化、可查询的错误信息。 */
export type AgentRunError = {
  code:
    | 'structured_output_validation_failed'
    | 'model_request_failed'
    | 'timeout'
    | 'rate_limited'
    | 'unknown'
  message: string
  retryable: boolean
  validationIssues?: Array<{
    path: Array<string | number>
    code: string
    message: string
  }>
}

export type AgentTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
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
