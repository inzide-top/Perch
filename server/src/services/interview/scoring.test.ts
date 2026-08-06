import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyExplicitUnknownSkipEvaluation,
  applyInterviewAssistanceFactor,
  calculateInterviewOverallScore,
  calculateWeightedEvaluationPointScore,
  getInterviewAssistanceFactor,
} from './scoring'
import type { InterviewAssessmentPlan, InterviewSessionEvaluation } from '@/shared/interview/schemas'

test('表达能力只在岗位掌握度基础上产生 5% 以内的调节', () => {
  assert.equal(calculateInterviewOverallScore(80, 100), 80)
  assert.equal(calculateInterviewOverallScore(80, 0), 76)
})

test('表达能力不能把错误答案变成高分答案', () => {
  assert.equal(calculateInterviewOverallScore(10, 100), 10)
  assert.equal(calculateInterviewOverallScore(10, 0), 10)
})

test('评分输入会限制在 0 到 100', () => {
  assert.equal(calculateInterviewOverallScore(120, 120), 100)
  assert.equal(calculateInterviewOverallScore(-10, 100), 0)
})

test('提示折损由服务端按固定系数计算', () => {
  assert.equal(getInterviewAssistanceFactor('none'), 1)
  assert.equal(getInterviewAssistanceFactor('level_1'), 0.75)
  assert.equal(getInterviewAssistanceFactor('level_2'), 0.5)
  assert.equal(applyInterviewAssistanceFactor(92, 'none'), 92)
  assert.equal(applyInterviewAssistanceFactor(92, 'level_1'), 69)
  assert.equal(applyInterviewAssistanceFactor(92, 'level_2'), 46)
})

test('单题只覆盖 Topic 部分评估点时会归一化权重', () => {
  assert.equal(
    calculateWeightedEvaluationPointScore([
      { score: 90, weight: 40 },
      { score: 75, weight: 35 },
    ]),
    83,
  )
  assert.equal(calculateWeightedEvaluationPointScore([{ score: 95, weight: 25 }]), 95)
})

test('评估点权重不可用时不会生成虚假分数', () => {
  assert.equal(calculateWeightedEvaluationPointScore([]), 0)
  assert.equal(calculateWeightedEvaluationPointScore([{ score: 95, weight: 0 }]), 0)
})

test('明确选择不会回答会作为 0 分证据并入主题，而不是清空既有证据', () => {
  const topicId = crypto.randomUUID()
  const previousTurnId = crypto.randomUUID()
  const skippedTurnId = crypto.randomUUID()
  const assessmentPlan: InterviewAssessmentPlan = {
    difficultyRubric: { basic: '基础', standard: '标准', advanced: '进阶' },
    topics: [
      {
        id: topicId,
        key: 'vue_reactivity',
        label: 'Vue 响应式',
        objective: '验证响应式理解。',
        priority: 'high',
        sources: [{ type: 'jd', evidence: '岗位要求掌握 Vue。' }],
        initialDifficulty: 'standard',
        evaluationPoints: [
          {
            id: crypto.randomUUID(),
            key: 'reactivity_principle',
            label: '响应式原理',
            description: '说明依赖收集和触发更新。',
            weight: 100,
          },
        ],
      },
    ],
  }
  const current: InterviewSessionEvaluation = {
    status: 'evaluating',
    score: 80,
    masteryScore: 80,
    communicationScore: 100,
    coverage: { plannedTopics: 1, evaluatedTopics: 1, sufficientTopics: 1 },
    consistency: 'unknown',
    topicEvaluations: [
      {
        assessmentPlanId: topicId,
        topicKey: 'vue_reactivity',
        status: 'solid',
        masteryScore: 80,
        evidenceConfidence: 'medium',
        supportingTurnIds: [previousTurnId],
        summary: '已有一次有效回答。',
      },
    ],
    summary: '已有一次有效回答。',
    strengths: [],
    weaknesses: [],
    suggestions: [],
    finalReview: null,
  }

  const result = applyExplicitUnknownSkipEvaluation(current, assessmentPlan, assessmentPlan.topics[0], skippedTurnId)

  assert.equal(result.masteryScore, 40)
  assert.equal(result.score, 40)
  assert.deepEqual(result.topicEvaluations[0].supportingTurnIds, [previousTurnId, skippedTurnId])
})
