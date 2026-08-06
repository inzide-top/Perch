import assert from 'node:assert/strict'
import test from 'node:test'
import type { AnswerDeepEvaluationModelOutput } from '../../schemas/interview-deep-evaluation.schema'
import type { AnswerEvidence, InterviewAssessmentPlan, InterviewQuestionContent } from '@/shared/interview/schemas'
import { buildAnswerDeepEvaluationRunInput } from './deep-evaluation-input'
import { materializeAnswerDeepEvaluationResult } from './deep-evaluation'
import {
  buildAnswerDeepEvaluationRepairPrompt,
  buildAnswerDeepEvaluationSystemPrompt,
  buildAnswerDeepEvaluationUserPrompt,
  parseAnswerDeepEvaluationModelOutput,
} from './deep-evaluation-prompt'

const pointIds = {
  diagnosis: '4772aef8-a321-475d-98e2-632153e94388',
  validation: '96fe3054-e925-424a-8c3b-68733f6fc624',
  communication: 'fe34665c-f1b0-431d-a08b-13d99d5075e5',
}

const assessmentPlan: InterviewAssessmentPlan = {
  difficultyRubric: {
    basic: '能够解释基本概念。',
    standard: '能够结合场景说明实施和验证方式。',
    advanced: '能够处理复杂约束、异常和方案权衡。',
  },
  topics: [
    {
      id: '3a8baeca-c724-4193-9474-99252cd7e8f6',
      key: 'performance_optimization',
      label: '性能优化',
      objective: '验证候选人定位、优化和验证性能问题的能力。',
      priority: 'high',
      sources: [{ type: 'jd', evidence: '岗位要求具备复杂页面性能优化经验。' }],
      initialDifficulty: 'standard',
      evaluationPoints: [
        {
          id: pointIds.diagnosis,
          key: 'problem_diagnosis',
          label: '问题定位',
          description: '能够说明如何发现瓶颈并定位根因。',
          weight: 50,
        },
        {
          id: pointIds.validation,
          key: 'result_validation',
          label: '结果验证',
          description: '能够使用量化指标验证结果。',
          weight: 30,
        },
        {
          id: pointIds.communication,
          key: 'stakeholder_communication',
          label: '协作沟通',
          description: '能够同步性能方案和风险。',
          weight: 20,
        },
      ],
    },
  ],
}

const question: InterviewQuestionContent = {
  topicKey: 'performance_optimization',
  targetEvaluationPointKeys: ['problem_diagnosis', 'result_validation'],
  format: 'compound',
  content: '请分别说明定位和验证过程。',
  subQuestions: ['你如何定位性能瓶颈？', '你如何验证优化结果？'],
  focusLabel: '性能优化闭环',
}

const answerEvidence: AnswerEvidence = {
  relevance: 'relevant',
  explicitlyUnknown: false,
  confidence: 'medium',
  hintUsage: 'level_1',
  pointResults: [
    {
      pointId: pointIds.diagnosis,
      status: 'covered',
      evidence: '使用性能指标和 DevTools 定位长任务。',
      score: 80,
    },
    {
      pointId: pointIds.validation,
      status: 'partially_covered',
      evidence: '提到对照实验，但缺少量化结果。',
      score: 70,
    },
  ],
  communication: {
    clarity: 80,
    structure: 75,
    conciseness: 85,
    note: '表达清楚，但案例细节不足。',
  },
  summary: '定位思路基本合理，验证闭环仍需补充。',
}

const turns = [
  {
    id: '20ad7c8e-63a8-4d9e-b892-bd701bbbc8e5',
    rootTurnId: null,
    kind: 'main' as const,
    sequenceNumber: 1,
    question,
    hints: { level1: '先说明工具和指标。', level2: '再说明基线、对照和回归。' },
    answer: {
      content: '我会先看性能指标，用 DevTools 定位长任务，再通过对照实验验证优化效果。',
      submittedAt: '2026-08-04T10:00:00.000Z',
      acceptedAt: '2026-08-04T10:00:01.000Z',
    },
    hintUsage: 'level_1' as const,
    answerEvidence,
  },
]

const runInput = buildAnswerDeepEvaluationRunInput({
  jobTitle: '前端开发工程师',
  interviewType: 'foundation',
  configuredDifficulty: 'adaptive',
  difficultyRubric: assessmentPlan.difficultyRubric,
  topic: assessmentPlan.topics[0],
  turn: turns[0],
  turns,
})

const modelOutput: AnswerDeepEvaluationModelOutput = {
  summary: '回答覆盖了定位和验证方向，但缺少完整根因链路和量化结果。',
  contextRelation: { type: 'independent' },
  questionPartEvaluations: [
    { partKey: 'part_1', status: 'answered', analysis: '说明了指标和 DevTools。' },
    { partKey: 'part_2', status: 'partial', analysis: '提到对照实验，但没有指标结果。' },
  ],
  pointEvaluations: [
    {
      pointKey: 'problem_diagnosis',
      status: 'partially_met',
      score: 80,
      analysis: '定位方向正确，根因判断过程不完整。',
      evidenceExcerpt: '用 DevTools 定位长任务',
      missingOrIncorrectPoints: ['缺少根因判断依据'],
      improvement: '补充从现象到根因的排查链路。',
    },
    {
      pointKey: 'result_validation',
      status: 'partially_met',
      score: 70,
      analysis: '有验证意识，但缺少量化结果。',
      evidenceExcerpt: '通过对照实验验证优化效果',
      missingOrIncorrectPoints: ['缺少优化前后数据'],
      improvement: '补充核心指标、对照范围和回归结论。',
    },
  ],
  communication: {
    score: 80,
    clarity: 'strong',
    structure: 'adequate',
    conciseness: 'strong',
    analysis: '表达清楚简洁，但案例结构不完整。',
  },
  strengths: [
    {
      title: '方向正确',
      analysis: '能够从指标和工具入手。',
      relatedPointKeys: ['problem_diagnosis'],
    },
  ],
  improvements: [
    {
      title: '补足量化结果',
      analysis: '缺少优化前后指标。',
      relatedPointKeys: ['result_validation'],
      priority: 'high',
      action: '按背景、定位、动作和结果组织回答。',
    },
  ],
  answerRevision: {
    mode: 'revision',
    revisedAnswer: '我会先看性能指标，用 DevTools 定位长任务，再通过对照实验验证优化效果，并补充【优化前后数据】。',
    changes: [
      { type: 'retain', description: '保留原回答的工具和验证路径。' },
      { type: 'supplement', description: '提示补充真实量化结果。' },
    ],
    placeholders: [{ placeholder: '【优化前后数据】', reason: '原回答没有提供真实指标。' }],
  },
}

test('深度点评输入只保留本题目标评估点并重新归一化权重', () => {
  assert.equal(runInput.roleContext.expectedDifficulty, 'standard')
  assert.deepEqual(
    runInput.assessmentTarget.evaluationPoints.map((point) => [point.key, point.relativeWeight]),
    [
      ['problem_diagnosis', 62.5],
      ['result_validation', 37.5],
    ],
  )
  assert.deepEqual(runInput.targetTurn.assistance.revealedHints, ['先说明工具和指标。'])
  assert.deepEqual(
    runInput.targetTurn.question.parts.map((part) => part.key),
    ['part_1', 'part_2'],
  )
})

test('深度点评总分和提示折损由服务端确定性计算', () => {
  const result = materializeAnswerDeepEvaluationResult(runInput, modelOutput)

  assert.equal(result.score.masteryScore, 76)
  assert.equal(result.score.contentScore, 75)
  assert.equal(result.score.assistanceFactor, 0.75)
  assert.equal(result.score.creditedScore, 56)
  assert.equal(result.score.level, 'solid')
})

test('深度点评 Prompt 限制证据来源、改写边界和总体计分职责', () => {
  const systemPrompt = buildAnswerDeepEvaluationSystemPrompt()
  const userPrompt = buildAnswerDeepEvaluationUserPrompt(runInput)

  assert.match(systemPrompt, /evidenceExcerpt 必须逐字摘自 targetTurn\.answer\.content/)
  assert.match(systemPrompt, /禁止改写、纠错、补字、删字、拼接多段/)
  assert.match(systemPrompt, /strengths 最多三条，improvements 最多三条/)
  assert.match(systemPrompt, /禁止使用 dependencySummary/)
  assert.match(systemPrompt, /不能把它改写成结构和事实完全无关的标准答案/)
  assert.match(systemPrompt, /不得编造候选人的项目、数据、职责、经历或结果/)
  assert.match(systemPrompt, /只回答其中一部分时只能判为 partial/)
  assert.match(systemPrompt, /90～100：当前问题对该评估点的显式要求全部覆盖/)
  assert.match(systemPrompt, /preliminaryEvidence 只是前序快速评估提供的参考/)
  assert.match(userPrompt, /<exact_quote_source>/)
  assert.match(userPrompt, /我会先看性能指标，用 DevTools 定位长任务/)
  assert.match(userPrompt, /不确定时返回 null/)
  assert.match(userPrompt, /不得输出总体 score/)
  assert.doesNotMatch(userPrompt, /apiKey/)
  assert.doesNotMatch(userPrompt, /resumeVersionId/)
})

test('合法模型输出可以解析，非原文证据会被拒绝', () => {
  assert.deepEqual(parseAnswerDeepEvaluationModelOutput(JSON.stringify(modelOutput), runInput), modelOutput)

  const invalidOutput = structuredClone(modelOutput)
  invalidOutput.pointEvaluations[0].evidenceExcerpt = '原回答中不存在的内容'
  assert.throws(() => parseAnswerDeepEvaluationModelOutput(JSON.stringify(invalidOutput), runInput))
})

test('修复 Prompt 携带失败字段并要求重新输出完整结果', () => {
  const repairPrompt = buildAnswerDeepEvaluationRepairPrompt(runInput, {
    validationIssues: [
      {
        path: ['pointEvaluations', 0, 'pointKey'],
        code: 'custom',
        message: 'pointEvaluations 必须覆盖全部目标评估点',
        receivedValue: 'unknown_point',
      },
    ],
    invalidFieldValues: '[{"path":["pointEvaluations",0,"pointKey"],"value":"unknown_point"}]',
  })

  assert.match(repairPrompt, /pointEvaluations/)
  assert.match(repairPrompt, /unknown_point/)
  assert.match(repairPrompt, /exact_quote_source/)
  assert.match(repairPrompt, /strengths 和 improvements 各最多 3 条/)
  assert.match(repairPrompt, /不要机械复制上一版的错误结构/)
  assert.match(repairPrompt, /重新输出完整 JSON/)
})
