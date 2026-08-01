import assert from 'node:assert/strict'
import test from 'node:test'
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'

import type { JobAnalysisListSummary } from '@/types/opportunity'
import type { InterviewSessionEvaluation } from '@/shared/interview/schemas'
import type { DashboardInterviewEvidenceRecord } from '../repositories/dashboard.repository'
import type { JobOpportunityRecord } from '../repositories/opportunity.repository'

const { buildDashboardOverview } = await import('./dashboard.service')

const now = '2026-08-05T00:00:00.000Z'

function createOpportunity(id: string, status: JobOpportunityRecord['status']): JobOpportunityRecord {
  return {
    id,
    userId: 'demo-user',
    company: `公司 ${id}`,
    jobTitle: '前端开发工程师',
    dedupeFingerprint: null,
    address: [],
    introduction: '',
    description: '',
    status,
    includeWrittenTest: false,
    intentionLevel: 'B',
    industry: '',
    note: '',
    writtenTestScheduledAt: null,
    writtenTestReviewNote: null,
    writtenTestReviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createAnalysis(status: JobAnalysisListSummary['status'], matchScore: number | null): JobAnalysisListSummary {
  return {
    status,
    currentAttempt: 1,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    modelName: null,
    matchScore,
    recommendation: null,
    error: null,
  }
}

function createEvaluation(): InterviewSessionEvaluation {
  return {
    status: 'final',
    score: 76,
    masteryScore: 76,
    communicationScore: 80,
    coverage: { plannedTopics: 2, evaluatedTopics: 2, sufficientTopics: 1 },
    consistency: 'stable',
    topicEvaluations: [
      {
        assessmentPlanId: '00000000-0000-4000-8000-000000000001',
        topicKey: 'vue_core',
        status: 'mastered',
        masteryScore: 86,
        evidenceConfidence: 'high',
        supportingTurnIds: [],
        summary: '能够准确解释核心原理。',
      },
      {
        assessmentPlanId: '00000000-0000-4000-8000-000000000001',
        topicKey: 'performance',
        status: 'weak',
        masteryScore: 42,
        evidenceConfidence: 'medium',
        supportingTurnIds: [],
        summary: '性能优化方案不完整。',
      },
    ],
    summary: '本轮完成评估。',
    strengths: [],
    weaknesses: [],
    suggestions: [],
    finalReview: null,
  }
}

function createInterviewEvidence(): DashboardInterviewEvidenceRecord {
  return {
    sessionId: '00000000-0000-4000-8000-000000000010',
    opportunityId: 'opportunity-1',
    company: '公司 opportunity-1',
    jobTitle: '前端开发工程师',
    evaluation: createEvaluation(),
    assessmentPlan: null,
    observedAt: now,
  }
}

test('buildDashboardOverview aggregates pipeline, match buckets, and structured ability evidence', () => {
  const opportunities = [
    createOpportunity('opportunity-1', 'pending_apply'),
    createOpportunity('opportunity-2', 'applied'),
    createOpportunity('opportunity-3', 'closed'),
  ]
  const analysisByOpportunityId = new Map([
    ['opportunity-1', createAnalysis('completed', 92)],
    ['opportunity-2', createAnalysis('failed', null)],
  ])

  const result = buildDashboardOverview({
    opportunities,
    analysisByOpportunityId,
    interviewEvidence: [createInterviewEvidence()],
    reviewSourceCounts: { writtenTestReviews: 1, interviewReviews: 1 },
    generatedAt: now,
  })

  assert.equal(result.opportunityPipeline.total, 3)
  assert.deepEqual(
    result.opportunityPipeline.stages.filter((item) => item.count > 0),
    [
      { key: 'pending_apply', label: '待投递', count: 1 },
      { key: 'applied', label: '已投递', count: 1 },
      { key: 'closed', label: '已终止', count: 1 },
    ],
  )
  assert.equal(result.matchDistribution.completedCount, 1)
  assert.equal(result.matchDistribution.failedCount, 1)
  assert.equal(result.matchDistribution.withoutAnalysisCount, 1)
  assert.equal(result.matchDistribution.buckets.find((item) => item.key === 'strong_match')?.count, 1)
  assert.equal(result.ability.dataStatus, 'partial')
  assert.equal(result.ability.strengths[0]?.capabilityKey, 'vue_core')
  assert.equal(result.ability.weaknesses[0]?.capabilityKey, 'performance')
  assert.equal(result.ability.historicalWeaknesses[0]?.topicKey, 'performance')
  assert.equal(result.ability.historicalWeaknesses[0]?.masteryScore, 42)
  assert.deepEqual(result.ability.sourceCounts, {
    simulatedSessions: 1,
    writtenTestReviews: 1,
    interviewReviews: 1,
  })
})

test('ability insights prioritize repeatedly mentioned evidence before one-off higher scores', () => {
  const repeatedEvidence = createInterviewEvidence()
  const repeatedEvidenceAgain: DashboardInterviewEvidenceRecord = {
    ...repeatedEvidence,
    sessionId: '00000000-0000-4000-8000-000000000011',
    observedAt: '2026-08-04T00:00:00.000Z',
  }
  const oneOffEvaluation = createEvaluation()
  oneOffEvaluation.topicEvaluations = [
    {
      ...oneOffEvaluation.topicEvaluations[0],
      topicKey: 'api_design',
      masteryScore: 100,
      summary: 'API 设计能力很强。',
    },
  ]

  const result = buildDashboardOverview({
    opportunities: [],
    analysisByOpportunityId: new Map(),
    interviewEvidence: [
      repeatedEvidence,
      repeatedEvidenceAgain,
      {
        ...repeatedEvidence,
        sessionId: '00000000-0000-4000-8000-000000000012',
        evaluation: oneOffEvaluation,
      },
    ],
    reviewSourceCounts: { writtenTestReviews: 0, interviewReviews: 0 },
    generatedAt: now,
  })

  assert.equal(result.ability.strengths[0]?.capabilityKey, 'vue_core')
  assert.equal(result.ability.strengths[0]?.evidenceCount, 2)
})

test('dashboard shows an empty historical weakness collection when no topic is repeatedly weak', () => {
  const evaluation = createEvaluation()
  evaluation.topicEvaluations = [evaluation.topicEvaluations[0]]

  const result = buildDashboardOverview({
    opportunities: [],
    analysisByOpportunityId: new Map(),
    interviewEvidence: [
      {
        ...createInterviewEvidence(),
        evaluation,
      },
    ],
    reviewSourceCounts: { writtenTestReviews: 0, interviewReviews: 0 },
    generatedAt: now,
  })

  assert.deepEqual(result.ability.historicalWeaknesses, [])
})

test('dashboard keeps a stable empty state when there are no opportunities or evidence sources', () => {
  const result = buildDashboardOverview({
    opportunities: [],
    analysisByOpportunityId: new Map(),
    interviewEvidence: [],
    reviewSourceCounts: { writtenTestReviews: 0, interviewReviews: 0 },
    generatedAt: now,
  })

  assert.equal(result.ability.dataStatus, 'empty')
  assert.deepEqual(result.ability.sourceCounts, {
    simulatedSessions: 0,
    writtenTestReviews: 0,
    interviewReviews: 0,
  })
  assert.equal(result.opportunityPipeline.total, 0)
  assert.equal(result.matchDistribution.completedCount, 0)
  assert.equal(result.matchDistribution.pendingCount, 0)
  assert.equal(result.matchDistribution.failedCount, 0)
  assert.equal(result.matchDistribution.withoutAnalysisCount, 0)
  assert.deepEqual(result.recentActivities, [])
})
