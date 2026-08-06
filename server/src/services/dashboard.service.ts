import type {
  DashboardAbilityInsight,
  DashboardCountItem,
  DashboardMatchBucketKey,
  DashboardOverview,
} from '@/types/dashboard'
import type { JobOpportunityStatus, JobAnalysisListSummary } from '@/types/opportunity'
import type { InterviewSessionEvaluation } from '@/shared/interview/schemas'
import { getRecommendationFromScore } from '@/shared/opportunity/analysisPresentation'
import { dashboardRepository, type DashboardInterviewEvidenceRecord } from '../repositories/dashboard.repository'
import { opportunityRepository, type JobOpportunityRecord } from '../repositories/opportunity.repository'
import { getJobAnalysisListSummaries } from './job-analysis.service'
import { collectHistoricalWeaknesses } from './interview/history-context'
import { getCurrentUserId } from '../context/current-user'

const opportunityStageLabels: Record<JobOpportunityStatus, string> = {
  pending_apply: '待投递',
  applied: '已投递',
  written_test: '笔试中',
  interviewing: '面试中',
  oc: 'OC',
  offered: '已 Offer',
  closed: '已终止',
}

const matchBucketLabels: Record<DashboardMatchBucketKey, string> = {
  not_recommended: '不建议',
  risky: '谨慎投递',
  worth_trying: '值得投递',
  strong_match: '强匹配',
}

const opportunityStageOrder: JobOpportunityStatus[] = [
  'pending_apply',
  'applied',
  'written_test',
  'interviewing',
  'oc',
  'offered',
  'closed',
]

const matchBucketOrder: DashboardMatchBucketKey[] = ['not_recommended', 'risky', 'worth_trying', 'strong_match']
const maxAbilityInsightsPerGroup = 30

type AbilityAccumulator = {
  capabilityKey: string
  label: string
  scores: number[]
  confidences: Array<'high' | 'medium' | 'low'>
  evidenceCount: number
  references: Set<string>
  lastObservedAt: string
  latestStatus: InterviewSessionEvaluation['topicEvaluations'][number]['status']
  latestScore: number
}

export type DashboardAggregationInput = {
  opportunities: JobOpportunityRecord[]
  analysisByOpportunityId: Map<string, JobAnalysisListSummary>
  interviewEvidence: DashboardInterviewEvidenceRecord[]
  reviewSourceCounts: {
    writtenTestReviews: number
    interviewReviews: number
  }
  generatedAt?: string
}

function combineConfidence(confidences: Array<'high' | 'medium' | 'low'>, evidenceCount: number) {
  if (evidenceCount >= 2 || confidences.includes('high')) return 'high' as const
  if (confidences.includes('medium')) return 'medium' as const
  return 'low' as const
}

function resolveTopicLabel(record: DashboardInterviewEvidenceRecord, topicKey: string) {
  return record.assessmentPlan?.topics.find((topic) => topic.key === topicKey)?.label ?? topicKey
}

function addTopicEvidence(
  target: Map<string, AbilityAccumulator>,
  record: DashboardInterviewEvidenceRecord,
  topic: InterviewSessionEvaluation['topicEvaluations'][number],
) {
  const existing = target.get(topic.topicKey)
  if (existing) {
    existing.scores.push(topic.masteryScore)
    existing.confidences.push(topic.evidenceConfidence)
    existing.evidenceCount += 1
    existing.references.add(record.sessionId)
    if (record.observedAt > existing.lastObservedAt) {
      existing.lastObservedAt = record.observedAt
      existing.label = resolveTopicLabel(record, topic.topicKey)
      existing.latestStatus = topic.status
      existing.latestScore = topic.masteryScore
    }
    return
  }

  target.set(topic.topicKey, {
    capabilityKey: topic.topicKey,
    label: resolveTopicLabel(record, topic.topicKey),
    scores: [topic.masteryScore],
    confidences: [topic.evidenceConfidence],
    evidenceCount: 1,
    references: new Set([record.sessionId]),
    lastObservedAt: record.observedAt,
    latestStatus: topic.status,
    latestScore: topic.masteryScore,
  })
}

function toAbilityInsight(accumulator: AbilityAccumulator): DashboardAbilityInsight {
  return {
    capabilityKey: accumulator.capabilityKey,
    label: accumulator.label,
    evidenceCount: accumulator.evidenceCount,
    sourceCount: accumulator.references.size,
    confidence: combineConfidence(accumulator.confidences, accumulator.evidenceCount),
    lastObservedAt: accumulator.lastObservedAt,
    references: [...accumulator.references].map((id) => ({ type: 'interview_session' as const, id })),
  }
}

function collectAbilityInsights(records: DashboardInterviewEvidenceRecord[]) {
  const topics = new Map<string, AbilityAccumulator>()

  for (const record of records) {
    const seenTopics = new Set<string>()
    for (const topic of record.evaluation.topicEvaluations) {
      if (seenTopics.has(topic.topicKey)) continue
      seenTopics.add(topic.topicKey)

      addTopicEvidence(topics, record, topic)
    }
  }

  const sortInsights = (left: DashboardAbilityInsight, right: DashboardAbilityInsight) => {
    if (right.evidenceCount !== left.evidenceCount) return right.evidenceCount - left.evidenceCount
    if (right.sourceCount !== left.sourceCount) return right.sourceCount - left.sourceCount
    return (right.lastObservedAt ?? '').localeCompare(left.lastObservedAt ?? '')
  }

  const toPublicInsights = (
    predicate: (item: AbilityAccumulator, averageScore: number) => boolean,
    descending: boolean,
  ) => {
    return [...topics.values()]
      .map((item) => {
        const averageScore = Math.round(item.scores.reduce((total, score) => total + score, 0) / item.scores.length)
        return { item, insight: toAbilityInsight(item), averageScore }
      })
      .filter(({ item, averageScore }) => predicate(item, averageScore))
      .sort((left, right) => {
        if (right.item.evidenceCount !== left.item.evidenceCount) {
          return right.item.evidenceCount - left.item.evidenceCount
        }
        if (right.item.references.size !== left.item.references.size) {
          return right.item.references.size - left.item.references.size
        }
        if (right.averageScore !== left.averageScore) {
          return descending ? right.averageScore - left.averageScore : left.averageScore - right.averageScore
        }

        return sortInsights(left.insight, right.insight)
      })
      .slice(0, maxAbilityInsightsPerGroup)
      .map(({ insight }) => insight)
  }

  return {
    strengths: toPublicInsights(
      (item, averageScore) =>
        averageScore >= 70 &&
        (item.latestStatus === 'mastered' || item.latestStatus === 'solid') &&
        item.latestScore >= 70,
      true,
    ),
    weaknesses: toPublicInsights(
      (item, averageScore) =>
        averageScore < 60 || item.latestScore < 60 || item.latestStatus === 'weak' || item.latestStatus === 'unknown',
      false,
    ),
  }
}

function createCountItems<TKey extends string>(keys: TKey[], labels: Record<TKey, string>, counts: Map<TKey, number>) {
  return keys.map((key) => ({ key, label: labels[key], count: counts.get(key) ?? 0 })) as DashboardCountItem<TKey>[]
}

function createPipeline(opportunities: JobOpportunityRecord[]) {
  const counts = new Map<JobOpportunityStatus, number>()
  for (const opportunity of opportunities) counts.set(opportunity.status, (counts.get(opportunity.status) ?? 0) + 1)

  return {
    total: opportunities.length,
    stages: createCountItems(opportunityStageOrder, opportunityStageLabels, counts),
  }
}

function createMatchDistribution(
  opportunities: JobOpportunityRecord[],
  analysisByOpportunityId: Map<string, JobAnalysisListSummary>,
) {
  const counts = new Map<DashboardMatchBucketKey, number>()
  let completedCount = 0
  let pendingCount = 0
  let failedCount = 0
  let withoutAnalysisCount = 0

  for (const opportunity of opportunities) {
    const analysis = analysisByOpportunityId.get(opportunity.id)
    if (!analysis) {
      withoutAnalysisCount += 1
      continue
    }

    if (analysis.status === 'pending' || analysis.status === 'processing') {
      pendingCount += 1
      continue
    }
    if (analysis.status === 'failed') {
      failedCount += 1
      continue
    }
    if (analysis.matchScore === null) {
      withoutAnalysisCount += 1
      continue
    }

    completedCount += 1
    const bucket = getRecommendationFromScore(analysis.matchScore)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return {
    buckets: createCountItems(matchBucketOrder, matchBucketLabels, counts),
    completedCount,
    pendingCount,
    failedCount,
    withoutAnalysisCount,
  }
}

function createRecentActivities(input: DashboardAggregationInput) {
  const opportunityActivities = input.opportunities.map((opportunity) => ({
    type: 'opportunity' as const,
    title: `${opportunity.company} · ${opportunity.jobTitle}`,
    detail: `机会状态：${opportunityStageLabels[opportunity.status]}`,
    occurredAt: opportunity.updatedAt,
    opportunityId: opportunity.id,
  }))
  const interviewActivities = input.interviewEvidence.map((record) => ({
    type: 'interview_session' as const,
    title: `${record.company} · ${record.jobTitle}`,
    detail: '模拟面试已完成，可查看本轮复盘',
    occurredAt: record.observedAt,
    opportunityId: record.opportunityId,
    sessionId: record.sessionId,
  }))

  return [...opportunityActivities, ...interviewActivities]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 10)
}

export function buildDashboardOverview(input: DashboardAggregationInput): DashboardOverview {
  const abilityInsights = collectAbilityInsights(input.interviewEvidence)
  const historicalWeaknesses = collectHistoricalWeaknesses(input.interviewEvidence)
  const sourceCounts = {
    simulatedSessions: input.interviewEvidence.length,
    writtenTestReviews: input.reviewSourceCounts.writtenTestReviews,
    interviewReviews: input.reviewSourceCounts.interviewReviews,
  }
  const hasEvidence =
    sourceCounts.simulatedSessions > 0 || sourceCounts.writtenTestReviews > 0 || sourceCounts.interviewReviews > 0
  const dataStatus = !hasEvidence ? 'empty' : input.interviewEvidence.length >= 2 ? 'sufficient' : 'partial'

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ability: {
      dataStatus,
      strengths: abilityInsights.strengths,
      weaknesses: abilityInsights.weaknesses,
      historicalWeaknesses,
      sourceCounts,
    },
    opportunityPipeline: createPipeline(input.opportunities),
    matchDistribution: createMatchDistribution(input.opportunities, input.analysisByOpportunityId),
    recentActivities: createRecentActivities(input),
  }
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const userId = await getCurrentUserId()
  const opportunities = await opportunityRepository.findOpportunitiesByUserId(userId)
  const opportunityIds = opportunities.map((opportunity) => opportunity.id)
  const [analysisByOpportunityId, interviewEvidence, reviewSourceCounts] = await Promise.all([
    getJobAnalysisListSummaries(opportunityIds),
    dashboardRepository.findInterviewEvidenceByUserId(userId),
    dashboardRepository.findReviewSourceCountsByUserId(userId),
  ])

  return buildDashboardOverview({
    opportunities,
    analysisByOpportunityId,
    interviewEvidence,
    reviewSourceCounts,
  })
}
