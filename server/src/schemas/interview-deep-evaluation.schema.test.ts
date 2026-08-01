import assert from 'node:assert/strict'
import test from 'node:test'
import { answerDeepEvaluationResultSchema } from '@/shared/interview/schemas'
import {
  answerDeepEvaluationRunInputSchema,
  createAnswerDeepEvaluationModelOutputSchema,
  type AnswerDeepEvaluationRunInput,
} from './interview-deep-evaluation.schema'

const validInput: AnswerDeepEvaluationRunInput = {
  roleContext: {
    jobTitle: '前端开发工程师',
    interviewType: 'foundation',
    expectedDifficulty: 'standard',
    difficultyStandard: '能结合实际业务解释技术方案、边界和验证方法。',
  },
  assessmentTarget: {
    topicKey: 'performance_optimization',
    topicLabel: '前端性能优化',
    objective: '验证候选人定位、优化和验证性能问题的能力。',
    sources: [{ type: 'jd', evidence: '岗位要求具备复杂页面性能优化经验。' }],
    evaluationPoints: [
      {
        key: 'problem_diagnosis',
        label: '问题定位',
        description: '能够说明如何发现瓶颈、收集指标并定位根因。',
        relativeWeight: 60,
      },
      {
        key: 'result_validation',
        label: '结果验证',
        description: '能够使用量化指标验证优化效果并进行回归检查。',
        relativeWeight: 40,
      },
    ],
  },
  targetTurn: {
    kind: 'main',
    focusLabel: '性能问题定位',
    question: {
      format: 'single',
      content: '请讲一个你实际定位前端性能瓶颈的案例。',
      parts: [{ key: 'part_1', content: '请讲一个你实际定位前端性能瓶颈的案例。' }],
    },
    answer: {
      content: '我会先看页面加载和交互性能指标，用 DevTools 定位长任务，再通过对照实验验证优化效果。',
    },
    assistance: {
      level: 'level_1',
      revealedHints: ['可以从指标、工具和验证方式三个方向组织回答。'],
    },
    preliminaryEvidence: {
      relevance: 'relevant',
      explicitlyUnknown: false,
      confidence: 'medium',
      hintUsage: 'level_1',
      pointResults: [
        {
          pointKey: 'problem_diagnosis',
          status: 'covered',
          evidence: '说明了性能指标和 DevTools。',
          score: 82,
        },
        {
          pointKey: 'result_validation',
          status: 'partially_covered',
          evidence: '提到对照实验，但没有量化指标。',
          score: 65,
        },
      ],
      communication: {
        clarity: 82,
        structure: 76,
        conciseness: 86,
        note: '表达清楚，但案例细节不足。',
      },
      summary: '定位路径基本合理，验证闭环仍需补充。',
    },
  },
  previousContext: null,
}

const validModelOutput = {
  summary: '回答给出了基本定位和验证路径，但缺少具体指标、根因和结果数据。',
  contextRelation: { type: 'independent' as const },
  questionPartEvaluations: [
    {
      partKey: 'part_1',
      status: 'answered' as const,
      analysis: '候选人正面回答了性能瓶颈定位问题。',
    },
  ],
  pointEvaluations: [
    {
      pointKey: 'problem_diagnosis',
      status: 'partially_met' as const,
      score: 80,
      analysis: '说明了指标和 DevTools，但没有给出定位根因的完整过程。',
      evidenceExcerpt: '用 DevTools 定位长任务',
      missingOrIncorrectPoints: ['缺少从现象到根因的排查链路'],
      improvement: '补充采样指标、定位过程和根因判断依据。',
    },
    {
      pointKey: 'result_validation',
      status: 'partially_met' as const,
      score: 70,
      analysis: '提到了对照实验，但没有说明指标和回归范围。',
      evidenceExcerpt: '通过对照实验验证优化效果',
      missingOrIncorrectPoints: ['缺少优化前后的量化对比'],
      improvement: '补充具体指标、样本范围和回归结论。',
    },
  ],
  communication: {
    score: 80,
    clarity: 'strong' as const,
    structure: 'adequate' as const,
    conciseness: 'strong' as const,
    analysis: '表达简洁清楚，但案例结构可以更完整。',
  },
  strengths: [
    {
      title: '定位方向正确',
      analysis: '能够主动从性能指标和开发工具入手。',
      relatedPointKeys: ['problem_diagnosis'],
    },
  ],
  improvements: [
    {
      title: '补足量化验证',
      analysis: '当前回答没有展示优化前后的指标变化。',
      relatedPointKeys: ['result_validation'],
      priority: 'high' as const,
      action: '按问题现象、定位过程、优化动作、指标结果组织案例。',
    },
  ],
  answerRevision: {
    mode: 'revision' as const,
    revisedAnswer:
      '我会先看页面加载和交互性能指标，用 DevTools 定位长任务，再通过对照实验验证优化效果；实际指标可以补充为【优化前后数据】。',
    changes: [
      { type: 'retain' as const, description: '保留原回答中的指标、DevTools 和对照实验路径。' },
      { type: 'supplement' as const, description: '提示补充真实的优化前后数据。' },
    ],
    placeholders: [{ placeholder: '【优化前后数据】', reason: '原回答没有提供真实量化结果，不能编造。' }],
  },
}

test('深度点评 RunInput 只接受当前题目的有界上下文', () => {
  assert.deepEqual(answerDeepEvaluationRunInputSchema.parse(validInput), validInput)

  assert.throws(() => {
    answerDeepEvaluationRunInputSchema.parse({
      ...validInput,
      resumeVersionId: '02d1ca8e-7e44-4ccd-979a-520206e721bd',
      apiKey: 'secret',
    })
  })
})

test('目标评估点权重必须归一化为 100', () => {
  const invalidInput = structuredClone(validInput)
  invalidInput.assessmentTarget.evaluationPoints[1].relativeWeight = 30

  assert.throws(() => answerDeepEvaluationRunInputSchema.parse(invalidInput))
})

test('初步证据必须完整覆盖目标评估点且提示级别一致', () => {
  const missingPointInput = structuredClone(validInput)
  missingPointInput.targetTurn.preliminaryEvidence.pointResults.pop()
  assert.throws(() => answerDeepEvaluationRunInputSchema.parse(missingPointInput))

  const wrongHintInput = structuredClone(validInput)
  wrongHintInput.targetTurn.preliminaryEvidence.hintUsage = 'none'
  assert.throws(() => answerDeepEvaluationRunInputSchema.parse(wrongHintInput))
})

test('single 与 compound 问题必须使用完整且连续的 partKey', () => {
  const invalidSingleInput = structuredClone(validInput)
  invalidSingleInput.targetTurn.question.parts[0].content = '另一段问题'
  assert.throws(() => answerDeepEvaluationRunInputSchema.parse(invalidSingleInput))

  const validCompoundInput = structuredClone(validInput)
  validCompoundInput.targetTurn.question = {
    format: 'compound',
    content: '请分别回答定位与验证方式。',
    parts: [
      { key: 'part_1', content: '你如何定位性能问题？' },
      { key: 'part_2', content: '你如何验证优化结果？' },
    ],
  }
  assert.doesNotThrow(() => answerDeepEvaluationRunInputSchema.parse(validCompoundInput))
})

test('模型输出必须完整覆盖问题部分和目标评估点', () => {
  const schema = createAnswerDeepEvaluationModelOutputSchema(validInput)
  assert.deepEqual(schema.parse(validModelOutput), validModelOutput)

  const missingPointOutput = structuredClone(validModelOutput)
  missingPointOutput.pointEvaluations.pop()
  assert.throws(() => schema.parse(missingPointOutput))

  const wrongPartOutput = structuredClone(validModelOutput)
  wrongPartOutput.questionPartEvaluations[0].partKey = 'part_2'
  assert.throws(() => schema.parse(wrongPartOutput))
})

test('模型证据摘录必须来自当前回答原文', () => {
  const invalidOutput = structuredClone(validModelOutput)
  invalidOutput.pointEvaluations[0].evidenceExcerpt = '用户从未说过的性能数据'

  assert.throws(() => createAnswerDeepEvaluationModelOutputSchema(validInput).parse(invalidOutput))
})

test('没有历史上下文时不能输出 depends_on_previous', () => {
  const invalidOutput = {
    ...structuredClone(validModelOutput),
    contextRelation: {
      type: 'depends_on_previous',
      summary: '当前回答依赖前一轮追问。',
    },
  }

  assert.throws(() => createAnswerDeepEvaluationModelOutputSchema(validInput).parse(invalidOutput))
})

test('落库结果使用确定性公式计算内容分、计入分和等级', () => {
  const result = {
    ...validModelOutput,
    score: {
      masteryScore: 76,
      communicationScore: 80,
      contentScore: 75,
      creditedScore: 56,
      assistanceFactor: 0.75 as const,
      level: 'solid' as const,
    },
    pointEvaluations: validModelOutput.pointEvaluations.map((point, index) => ({
      ...point,
      label: validInput.assessmentTarget.evaluationPoints[index].label,
      relativeWeight: validInput.assessmentTarget.evaluationPoints[index].relativeWeight,
    })),
  }

  assert.doesNotThrow(() => answerDeepEvaluationResultSchema.parse(result))

  assert.throws(() =>
    answerDeepEvaluationResultSchema.parse({
      ...result,
      score: { ...result.score, masteryScore: 80 },
    }),
  )

  assert.throws(() =>
    answerDeepEvaluationResultSchema.parse({
      ...result,
      score: { ...result.score, creditedScore: 80, level: 'excellent' },
    }),
  )
})
