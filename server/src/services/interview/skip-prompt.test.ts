import assert from 'node:assert/strict'
import test from 'node:test'
import type { InterviewSkipRunInput } from '../../schemas/interview-skip.schema'
import {
  buildInterviewSkipSystemPrompt,
  buildInterviewSkipUserPrompt,
  parseInterviewSkipModelOutput,
} from './skip-prompt'

const baseInput: InterviewSkipRunInput = {
  configuration: {
    type: 'foundation',
    scale: 'standard',
    difficulty: 'standard',
    referenceHistoricalWeaknesses: false,
    budget: { mainTopicBudget: 5, totalQuestionBudget: 9, maxFollowUpsPerRoot: 3 },
  },
  budgetProgress: { remainingMainQuestions: 4, remainingTotalQuestions: 8, remainingCompoundQuestions: 2 },
  assessmentPlan: {
    difficultyRubric: { basic: '解释概念。', standard: '结合场景。', advanced: '分析边界与取舍。' },
    topics: [
      {
        key: 'vue_foundation',
        label: 'Vue 基础',
        objective: '验证 Vue 核心机制。',
        priority: 'high',
        sources: [{ type: 'jd', evidence: '岗位要求熟悉 Vue。' }],
        initialDifficulty: 'standard',
        evaluationPoints: [{ key: 'reactivity', label: '响应式', description: '解释响应式机制。', weight: 100 }],
      },
      {
        key: 'engineering',
        label: '工程化',
        objective: '验证工程化能力。',
        priority: 'medium',
        sources: [{ type: 'jd', evidence: '岗位要求工程化经验。' }],
        initialDifficulty: 'standard',
        evaluationPoints: [{ key: 'build_tooling', label: '构建工具', description: '说明构建工具实践。', weight: 100 }],
      },
    ],
  },
  currentTurn: {
    kind: 'main',
    sequenceNumber: 1,
    mainQuestionNumber: 1,
    followUpNumber: 0,
    question: {
      topicKey: 'vue_foundation',
      targetEvaluationPointKeys: ['reactivity'],
      format: 'single',
      content: '请解释 Vue 响应式机制。',
      subQuestions: [],
      focusLabel: '响应式机制',
    },
  },
  skip: { reason: 'unclear', note: null, skippedAt: '2026-08-04T10:00:00.000Z' },
  consumesBudget: false,
  recentHistory: [],
}

function nextQuestion(topicKey: string, pointKey: string) {
  return {
    nextAction: { type: 'ask_next_question' as const, reason: '继续验证。' },
    nextQuestion: {
      topicKey,
      targetEvaluationPointKeys: [pointKey],
      format: 'single' as const,
      content: '请从数据变化如何触发视图更新开始说明。',
      subQuestions: [],
      focusLabel: '响应式机制',
      hints: { level1: '从数据和视图关系思考。', level2: '结合依赖收集和触发更新说明。' },
    },
  }
}

test('跳过 Prompt 明确区分是否消耗题目额度', () => {
  const prompt = buildInterviewSkipSystemPrompt()
  assert.match(prompt, /consumesBudget 为 false/)
  assert.match(prompt, /继续验证当前 topicKey/)
  assert.match(prompt, /不得把未说明原因自动解释为能力不足/)
})

test('问题不清楚时只允许同主题替代问题', () => {
  assert.deepEqual(
    parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('vue_foundation', 'reactivity')), baseInput),
    nextQuestion('vue_foundation', 'reactivity'),
  )
  assert.throws(() =>
    parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('engineering', 'build_tooling')), baseInput),
  )
})

test('消耗额度的跳过必须切换主题', () => {
  const input = structuredClone(baseInput)
  input.consumesBudget = true
  input.skip.reason = 'unknown'

  assert.throws(() =>
    parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('vue_foundation', 'reactivity')), input),
  )
  assert.doesNotThrow(() =>
    parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('engineering', 'build_tooling')), input),
  )
})

test('消耗额度的跳过在主问题额度用尽后必须结束面试', () => {
  const input = structuredClone(baseInput)
  input.consumesBudget = true
  input.skip.reason = 'unknown'
  input.budgetProgress.remainingMainQuestions = 0

  assert.throws(
    () => parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('engineering', 'build_tooling')), input),
    /主问题额度已用尽，消耗额度的跳过必须结束面试/,
  )

  const completedOutput = {
    nextAction: { type: 'finish_session' as const, reason: '主问题额度已用尽，本轮面试结束。' },
  }
  assert.deepEqual(parseInterviewSkipModelOutput(JSON.stringify(completedOutput), input), completedOutput)
})

test('消耗额度的跳过在总问题额度用尽后必须结束面试', () => {
  const input = structuredClone(baseInput)
  input.consumesBudget = true
  input.skip.reason = 'unknown'
  input.budgetProgress.remainingTotalQuestions = 0

  assert.throws(
    () => parseInterviewSkipModelOutput(JSON.stringify(nextQuestion('engineering', 'build_tooling')), input),
    /总问题额度已用尽，消耗额度的跳过必须结束面试/,
  )
})

test('跳过 User Prompt 会显式写入剩余额度和强制结束规则', () => {
  const input = structuredClone(baseInput)
  input.consumesBudget = true
  input.skip.reason = 'unknown'
  input.budgetProgress.remainingMainQuestions = 0

  const prompt = buildInterviewSkipUserPrompt(input)
  assert.match(prompt, /本次跳过是否消耗额度：是/)
  assert.match(prompt, /剩余主问题额度：0/)
  assert.match(prompt, /nextAction\.type 必须为 finish_session/)
  assert.match(prompt, /禁止返回 nextQuestion/)
})

test('结束面试时不能额外返回下一题', () => {
  assert.throws(() =>
    parseInterviewSkipModelOutput(
      JSON.stringify({
        nextAction: { type: 'finish_session', reason: '题目额度已用尽。' },
        nextQuestion: nextQuestion('vue_foundation', 'reactivity').nextQuestion,
      }),
      baseInput,
    ),
  )
})
