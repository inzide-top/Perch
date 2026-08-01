import type { JobOpportunityStatus } from './opportunity'
import type { AnalysisRecommendation } from '@/shared/opportunity/analysisPresentation'

export type DashboardAbilityDataStatus = 'empty' | 'partial' | 'sufficient'

export type DashboardEvidenceReference = {
  type: 'interview_session' | 'real_review'
  id: string
}

export type DashboardAbilityInsight = {
  capabilityKey: string
  label: string
  evidenceCount: number
  sourceCount: number
  confidence: 'low' | 'medium' | 'high'
  lastObservedAt: string | null
  references: DashboardEvidenceReference[]
}

export type DashboardHistoricalWeakness = {
  topicKey: string
  topicLabel: string
  summary: string
  masteryScore: number
  confidence: 'high' | 'medium' | 'low'
  lastObservedAt: string
}

export type DashboardAbilitySummary = {
  dataStatus: DashboardAbilityDataStatus
  strengths: DashboardAbilityInsight[]
  weaknesses: DashboardAbilityInsight[]
  historicalWeaknesses: DashboardHistoricalWeakness[]
  sourceCounts: {
    simulatedSessions: number
    writtenTestReviews: number
    interviewReviews: number
  }
}

export type DashboardCountItem<TKey extends string = string> = {
  key: TKey
  label: string
  count: number
}

export type DashboardOpportunityPipeline = {
  total: number
  stages: DashboardCountItem<JobOpportunityStatus>[]
}

export type DashboardMatchBucketKey = 'not_recommended' | 'risky' | 'worth_trying' | 'strong_match'

export type DashboardMatchDistribution = {
  buckets: DashboardCountItem<DashboardMatchBucketKey>[]
  completedCount: number
  pendingCount: number
  failedCount: number
  withoutAnalysisCount: number
}

export type DashboardRecentActivity = {
  type: 'opportunity' | 'interview_session'
  title: string
  detail: string
  occurredAt: string
  opportunityId: string
  sessionId?: string
}

export type DashboardOverview = {
  generatedAt: string
  ability: DashboardAbilitySummary
  opportunityPipeline: DashboardOpportunityPipeline
  matchDistribution: DashboardMatchDistribution
  recentActivities: DashboardRecentActivity[]
}

export type DashboardWidgetKey =
  'ability_insights' | 'opportunity_pipeline' | 'match_distribution' | 'recent_activities'

export type DashboardWidgetVisibility = Record<DashboardWidgetKey, boolean>

export type DashboardAnalysisRecommendation = AnalysisRecommendation
