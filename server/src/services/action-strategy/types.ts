import type {
  ActionStrategyAiSummary,
  ActionStrategyOverview,
  StrategyAction,
  StrategyCapabilityAction,
  StrategyPriority,
  StrategyWaitingStage,
} from '@/types/action-strategy'
import type { JobOpportunityStatus, OpportunityIntentionLevel } from '@/types/opportunity'

export type StrategyOpportunityContext = {
  id: string
  company: string
  jobTitle: string
  status: JobOpportunityStatus
  intentionLevel: OpportunityIntentionLevel
  updatedAt: string
  writtenTestScheduledAt: string | null
  writtenTestReviewedAt: string | null
  analysis: {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    matchScore: number | null
    resumeVersionId: string | null
  } | null
  statusHistory: Array<{
    toStatus: JobOpportunityStatus
    createdAt: string
  }>
  interviewRounds: Array<{
    id: string
    title: string
    scheduledAt: string | null
    status: 'planned' | 'completed' | 'canceled'
    result: 'pending' | 'passed' | 'failed' | 'unknown'
    updatedAt: string
  }>
}

export type StrategyCapabilityContext = {
  capabilityKey: string
  label: string
  confidence: 'low' | 'medium' | 'high'
  evidenceCount: number
  masteryScore: number
  sourceLabel: string
  observedAt: string
}

export type StrategyCandidateInput = {
  key: string
  type: StrategyAction['type']
  priority: StrategyPriority
  company: string
  jobTitle: string
  status: JobOpportunityStatus
  intentionLevel: OpportunityIntentionLevel
  matchScore: number | null
  waitingStage: StrategyWaitingStage | null
  facts: string[]
  opportunityId: string
  cta: StrategyAction['cta']
}

export type StrategyCapabilityCandidateInput = {
  key: string
  capabilityKey: string
  label: string
  confidence: StrategyCapabilityContext['confidence']
  evidenceCount: number
  sourceLabel: string
  masteryScore: number
  opportunityId?: string
  company?: string
  jobTitle?: string
  cta: StrategyAction['cta']
}

export type ActionStrategyRunInput = {
  generatedAt: string
  sourceSummary: {
    opportunityCount: number
    upcomingEventCount: number
    stalledOpportunityCount: number
    completedAnalysisCount: number
    capabilityEvidenceCount: number
  }
  actionCandidates: Array<Omit<StrategyCandidateInput, 'opportunityId' | 'cta'>>
  capabilityCandidates: Array<
    Omit<StrategyCapabilityCandidateInput, 'masteryScore' | 'opportunityId' | 'company' | 'jobTitle' | 'cta'>
  >
}

export type ActionStrategyModelOutput = ActionStrategyAiSummary

export type ActionStrategyBuildResult = {
  generatedAt: string
  currentFingerprint: string
  sourceSummary: ActionStrategyRunInput['sourceSummary']
  actions: StrategyAction[]
  capabilityActions: StrategyCapabilityAction[]
  runInput: ActionStrategyRunInput
  actionCandidates: StrategyCandidateInput[]
  capabilityCandidates: StrategyCapabilityCandidateInput[]
}

export type ActionStrategySnapshotRecord = {
  id: string
  userId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  inputFingerprint: string
  modelName: string | null
  modelBaseUrl: string | null
  promptVersion: string
  result: ActionStrategyAiSummary | null
  error: import('@/types/opportunity').AgentRunError | null
  currentAttempt: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ActionStrategyResponse = ActionStrategyOverview
