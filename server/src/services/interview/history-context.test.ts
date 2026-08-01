import assert from 'node:assert/strict'
import test from 'node:test'
import type { InterviewRound, WrittenTestReview } from '@/types/opportunity'
import type { ReviewDocumentResult } from '@/types/review'
import type { InterviewAssessmentPlan, InterviewSessionEvaluation } from '@/shared/interview/schemas'
import { collectHistoricalReviews, collectHistoricalWeaknesses } from './history-context'

const assessmentPlan = {
  topics: [
    { key: 'frontend_core', label: '前端基础与框架' },
    { key: 'agent_basics', label: 'Agent 基础' },
  ],
} as InterviewAssessmentPlan

function createEvaluation(
  topicKey: string,
  masteryScore: number,
  status: InterviewSessionEvaluation['topicEvaluations'][number]['status'],
): InterviewSessionEvaluation {
  return {
    status: 'provisional',
    score: masteryScore,
    masteryScore,
    communicationScore: null,
    coverage: { plannedTopics: 2, evaluatedTopics: 1, sufficientTopics: masteryScore >= 70 ? 1 : 0 },
    consistency: 'unknown',
    topicEvaluations: [
      {
        assessmentPlanId: crypto.randomUUID(),
        topicKey,
        status,
        masteryScore,
        evidenceConfidence: 'medium',
        supportingTurnIds: [crypto.randomUUID()],
        summary: `${topicKey} 的关键评估点没有稳定覆盖。`,
      },
    ],
    summary: '测试评估',
    strengths: [],
    weaknesses: [],
    suggestions: [],
    finalReview: null,
  }
}

const writtenTestReview: WrittenTestReview = {
  scheduledAt: '2026-08-01T10:00:00.000Z',
  reviewNote: '算法题完成较好，但边界条件处理需要加强。',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const interviewRound: InterviewRound = {
  id: crypto.randomUUID(),
  type: 'technical_basic',
  sequence: 1,
  title: '技术一面',
  scheduledAt: '2026-08-02T10:00:00.000Z',
  status: 'completed',
  result: 'failed',
  note: '对工程化问题的回答不够完整。',
  reviewNote: '需要补充异常处理和验证方案。',
  keyTakeaways: ['工程化基础尚可', '异常分支覆盖不足'],
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
}

test('只收集可定位到主题且重复出现的历史薄弱项', () => {
  const weaknesses = collectHistoricalWeaknesses([
    {
      evaluation: createEvaluation('frontend_core', 45, 'partial'),
      assessmentPlan,
      observedAt: '2026-08-03T10:00:00.000Z',
    },
    {
      evaluation: createEvaluation('frontend_core', 35, 'weak'),
      assessmentPlan,
      observedAt: '2026-08-01T10:00:00.000Z',
    },
    {
      evaluation: createEvaluation('agent_basics', 85, 'mastered'),
      assessmentPlan,
      observedAt: '2026-08-02T10:00:00.000Z',
    },
  ])

  assert.equal(weaknesses.length, 1)
  assert.equal(weaknesses[0].topicKey, 'frontend_core')
  assert.equal(weaknesses[0].topicLabel, '前端基础与框架')
  assert.equal(weaknesses[0].masteryScore, 40)
  assert.equal(weaknesses[0].confidence, 'high')
  assert.match(weaknesses[0].summary, /2 场历史模拟面试/)
})

test('真实笔试和面试复盘会被压缩成有限的历史复盘输入', () => {
  const reviews = collectHistoricalReviews({
    writtenTestReview,
    interviewRounds: [interviewRound],
  })

  assert.equal(reviews.length, 2)
  assert.equal(reviews[0].source, 'interview_round')
  assert.equal(reviews[0].outcome, 'failed')
  assert.equal(reviews[1].source, 'written_test')
  assert.match(reviews[0].summary, /异常处理/)
  assert.deepEqual(reviews[0].keyTakeaways, ['工程化基础尚可', '异常分支覆盖不足'])
})

test('数据库时间格式会在进入面试计划前转换为 ISO 时间', () => {
  const reviews = collectHistoricalReviews({
    writtenTestReview: {
      ...writtenTestReview,
      updatedAt: '2026-08-01 12:00:00.000+00',
    },
    interviewRounds: [
      {
        ...interviewRound,
        updatedAt: '2026-08-02 12:00:00.000+00',
      },
    ],
  })

  assert.equal(reviews[0].observedAt, '2026-08-02T12:00:00.000Z')
  assert.equal(reviews[1].observedAt, '2026-08-01T12:00:00.000Z')

  const weaknesses = collectHistoricalWeaknesses([
    {
      evaluation: createEvaluation('frontend_core', 45, 'partial'),
      assessmentPlan,
      observedAt: '2026-08-03 10:00:00.000+00',
    },
  ])

  assert.equal(weaknesses[0].lastObservedAt, '2026-08-03T10:00:00.000Z')
})

test('没有真实复盘文本的计划轮次不会进入模型输入', () => {
  const reviews = collectHistoricalReviews({
    writtenTestReview: { ...writtenTestReview, reviewNote: '' },
    interviewRounds: [
      {
        ...interviewRound,
        status: 'planned',
        result: 'pending',
        note: '',
        reviewNote: '',
        keyTakeaways: [],
      },
    ],
  })

  assert.deepEqual(reviews, [])
})

test('计划轮次即使带有安排备注也不会进入模型复盘输入', () => {
  const reviews = collectHistoricalReviews({
    writtenTestReview: null,
    interviewRounds: [
      {
        ...interviewRound,
        status: 'planned',
        result: 'pending',
        note: '明天下午线上面试，提前准备项目架构。',
        reviewNote: '',
        keyTakeaways: [],
      },
    ],
  })

  assert.deepEqual(reviews, [])
})

test('已完成的结构化复盘优先于原始备注进入下一轮计划', () => {
  const result: ReviewDocumentResult = {
    segments: [
      {
        kind: 'question',
        sourceType: 'interview',
        content: '面试官追问了异常处理和验证方案。',
        sourceQuote: '异常处理和验证方案',
        confidence: 'high',
        sourceStartOffset: 0,
        sourceEndOffset: 10,
      },
      {
        kind: 'candidate_answer',
        sourceType: 'interview',
        content: '候选人没有完整说明异常分支。',
        sourceQuote: '没有完整说明异常分支',
        confidence: 'high',
        answerStatus: 'partial',
        sourceStartOffset: 11,
        sourceEndOffset: 22,
      },
    ],
  }

  const reviews = collectHistoricalReviews({
    writtenTestReview: null,
    interviewRounds: [interviewRound],
    reviewDocuments: [
      {
        sourceType: 'interview',
        interviewRoundId: interviewRound.id,
        status: 'completed',
        result,
        updatedAt: '2026-08-03T12:00:00.000Z',
      },
    ],
  })

  assert.equal(reviews.length, 1)
  assert.match(reviews[0].summary, /没有完整说明异常分支/)
  assert.equal(reviews[0].keyTakeaways.length, 2)
})
