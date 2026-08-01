import type { AiTaskError } from './ai'
import type { JobOpportunityStatus, OpportunityIntentionLevel } from './opportunity'

export type StrategyPriority = 'urgent' | 'high' | 'medium' | 'low'

export type StrategyWaitingStage = 'normal' | 'follow_up' | 'stalled' | 'long_stalled'

export type StrategyActionType =
  | 'prepare_interview'
  | 'prepare_written_test'
  | 'complete_event_record'
  | 'submit_application'
  | 'follow_up'
  | 'lower_priority'
  | 'retry_analysis'
  | 'reanalyze_current_resume'
  | 'train_capability'

export type StrategyActionCta = {
  label: string
  to?: string
}

/** 后端规则先生成的可执行候选，也是 AI 唯一可以引用的行动集合。 */
export type StrategyAction = {
  key: string
  type: StrategyActionType
  priority: StrategyPriority
  title: string
  reason: string
  suggestedStep: string
  evidence: string[]
  opportunityId?: string
  company?: string
  jobTitle?: string
  status?: JobOpportunityStatus
  intentionLevel?: OpportunityIntentionLevel
  matchScore?: number | null
  waitingStage?: StrategyWaitingStage
  cta: StrategyActionCta
}

export type StrategyCapabilityAction = StrategyAction & {
  type: 'train_capability'
  capabilityKey: string
  capabilityLabel: string
  confidence: 'low' | 'medium' | 'high'
}

export type ActionStrategyAiSummary = {
  headline: string
  summary: string
  selectedActions: Array<{
    actionKey: string
    reason: string
    suggestedStep: string
  }>
  capabilityFocus: Array<{
    actionKey: string
    reason: string
  }>
}

export type ActionStrategySnapshotStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ActionStrategyFreshness = 'not_generated' | 'fresh' | 'stale' | 'generating' | 'failed'

export type ActionStrategySourceSummary = {
  opportunityCount: number
  upcomingEventCount: number
  stalledOpportunityCount: number
  completedAnalysisCount: number
  capabilityEvidenceCount: number
}

export type ActionStrategyOverview = {
  generatedAt: string
  currentFingerprint: string
  sourceSummary: ActionStrategySourceSummary
  actions: StrategyAction[]
  capabilityActions: StrategyCapabilityAction[]
  ai: {
    freshness: ActionStrategyFreshness
    status: ActionStrategySnapshotStatus | 'not_generated'
    snapshotId: string | null
    modelName: string | null
    generatedAt: string | null
    summary: ActionStrategyAiSummary | null
    error: Pick<AiTaskError, 'code' | 'message'> | null
  }
}

export type ActionStrategyGenerateResult = {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cached'
  snapshotId: string | null
  overview: ActionStrategyOverview
}
