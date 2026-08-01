import assert from 'node:assert/strict'
import test from 'node:test'
import { createInterviewSessionInputSchema, submitInterviewAnswerInputSchema } from './interview.schema'
import {
  answerEvidenceSchema,
  interviewAnswerContentMaxLength,
  interviewPlanModelOutputSchema,
  interviewTurnModelOutputSchema,
  interviewQuestionSchema,
} from '@/shared/interview/schemas'
import type { InterviewPlanModelOutput } from '@/shared/interview/schemas'
import { interviewModelSnapshotSchema } from '@/shared/interview/schemas'

const modelConnection = {
  modelName: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
}

test('创建会话要求提供完整的临时模型连接', () => {
  const valid = createInterviewSessionInputSchema.safeParse({
    configuration: {
      type: 'foundation',
      scale: 'standard',
      difficulty: 'adaptive',
      referenceHistoricalWeaknesses: true,
      budget: {
        mainTopicBudget: 8,
        totalQuestionBudget: 20,
        maxFollowUpsPerRoot: 3,
      },
    },
    modelConnection,
  })

  assert.equal(valid.success, true)

  const missingApiKey = createInterviewSessionInputSchema.safeParse({
    configuration: valid.success ? valid.data.configuration : undefined,
    modelConnection: {
      baseUrl: modelConnection.baseUrl,
      modelName: modelConnection.modelName,
    },
  })

  assert.equal(missingApiKey.success, false)
})

test('回答内容最多允许 4000 个字符', () => {
  const commonInput = {
    clientSubmissionId: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    hintUsage: 'none' as const,
    modelConnection,
  }

  assert.equal(
    submitInterviewAnswerInputSchema.safeParse({
      ...commonInput,
      content: '答'.repeat(interviewAnswerContentMaxLength),
    }).success,
    true,
  )
  assert.equal(
    submitInterviewAnswerInputSchema.safeParse({
      ...commonInput,
      content: '答'.repeat(interviewAnswerContentMaxLength + 1),
    }).success,
    false,
  )
})

test('复合问题最多包含三个可在一次回答中完成的子问题', () => {
  const result = interviewQuestionSchema.safeParse({
    topicKey: 'performance_optimization',
    targetEvaluationPointKeys: ['problem_diagnosis'],
    format: 'compound',
    content: '请说明你的项目性能优化方案。',
    subQuestions: ['如何定位？', '如何验证？', '如何回归？', '如何发布？'],
    focusLabel: '性能优化',
  })

  assert.equal(result.success, false)
})

const validPlanOutput: InterviewPlanModelOutput = {
  difficultyRubric: {
    basic: '能够解释岗位基础概念和标准工作流程。',
    standard: '能够结合常见业务场景分析并应用相关能力。',
    advanced: '能够在复杂约束下完成方案取舍并说明影响。',
  },
  topics: [
    {
      key: 'performance_optimization',
      label: '性能优化',
      objective: '验证候选人定位、优化和验证性能问题的完整能力。',
      priority: 'high',
      sources: [
        {
          type: 'jd',
          evidence: '岗位要求具备复杂业务场景的性能优化能力。',
        },
      ],
      initialDifficulty: 'standard',
      evaluationPoints: [
        {
          key: 'problem_diagnosis',
          label: '问题定位',
          description: '能够说明如何发现瓶颈、收集指标并定位根因。',
          weight: 60,
        },
        {
          key: 'result_validation',
          label: '结果验证',
          description: '能够使用量化指标验证优化效果并进行回归检查。',
          weight: 40,
        },
      ],
    },
  ],
  firstQuestion: {
    topicKey: 'performance_optimization',
    targetEvaluationPointKeys: ['problem_diagnosis'],
    format: 'single',
    content: '请讲一个你实际定位前端性能瓶颈的案例。',
    subQuestions: [],
    focusLabel: '性能问题定位',
    hints: {
      level1: '可以从现象、指标和定位工具三个方向组织回答。',
      level2: '尝试说明如何利用性能指标和开发工具逐步缩小问题范围。',
    },
  },
}

test('面试计划模型输出可以通过完整的跨字段校验', () => {
  assert.equal(interviewPlanModelOutputSchema.safeParse(validPlanOutput).success, true)
})

test('主题内评估点权重合计必须为 100', () => {
  const invalidOutput = structuredClone(validPlanOutput)
  invalidOutput.topics[0].evaluationPoints[0].weight = 50

  assert.equal(interviewPlanModelOutputSchema.safeParse(invalidOutput).success, false)
})

test('首题只能引用所属主题内真实存在的评估点', () => {
  const invalidOutput = structuredClone(validPlanOutput)
  invalidOutput.firstQuestion.targetEvaluationPointKeys = ['unknown_point']

  assert.equal(interviewPlanModelOutputSchema.safeParse(invalidOutput).success, false)
})

test('single 问题不能携带复合子问题', () => {
  const invalidOutput = structuredClone(validPlanOutput)
  invalidOutput.firstQuestion.subQuestions = ['如何定位？', '如何验证？']

  assert.equal(interviewPlanModelOutputSchema.safeParse(invalidOutput).success, false)
})

test('回答证据必须绑定预设评估点并使用受控结论', () => {
  const result = answerEvidenceSchema.safeParse({
    relevance: 'relevant',
    explicitlyUnknown: false,
    confidence: 'high',
    hintUsage: 'none',
    pointResults: [
      {
        pointId: crypto.randomUUID(),
        status: 'covered',
        evidence: '解释了定位、方案与验证闭环',
        score: 90,
      },
    ],
    communication: {
      clarity: 90,
      structure: 85,
      conciseness: 80,
      note: '表达清晰且结构完整',
    },
    summary: '已覆盖当前问题的主要评估点',
  })

  assert.equal(result.success, true)
})

const validAnswerEvidence = {
  relevance: 'relevant' as const,
  explicitlyUnknown: false,
  confidence: 'high' as const,
  hintUsage: 'none' as const,
  pointResults: [
    {
      pointKey: 'problem_diagnosis',
      status: 'partially_covered' as const,
      evidence: '解释了定位方式，但缺少量化验证',
      score: 68,
    },
  ],
  communication: {
    clarity: 82,
    structure: 76,
    conciseness: 72,
    note: '表达清楚，但结构可以更聚焦。',
  },
  summary: '回答覆盖了部分评估点，适合继续追问验证深度。',
}

const nextQuestion = {
  topicKey: 'performance_optimization',
  targetEvaluationPointKeys: ['result_validation'],
  format: 'single' as const,
  content: '如果优化后线上指标没有明显变化，你会如何继续排查？',
  subQuestions: [],
  focusLabel: '优化结果验证',
  hints: {
    level1: '可以从指标、样本量和对照实验三个方向思考。',
    level2: '说明如何验证优化是否真正影响用户体验，而不只是局部指标变化。',
  },
}

test('正式回答后追问必须携带下一题结构', () => {
  const result = interviewTurnModelOutputSchema.safeParse({
    inputClassification: 'formal_answer',
    answerEvidence: validAnswerEvidence,
    nextAction: {
      type: 'ask_follow_up',
      reason: '回答覆盖了定位过程，但结果验证还不充分。',
    },
    nextQuestion,
    sessionEvaluationPatch: {
      topicEvaluation: {
        topicKey: 'performance_optimization',
        status: 'partial',
        masteryScore: 68,
        evidenceConfidence: 'medium',
        summary: '候选人具备定位思路，但验证闭环不足。',
      },
      strengths: ['能够描述基础定位路径'],
      weaknesses: ['缺少优化后指标验证'],
      suggestions: ['补充量化指标和回归验证方法'],
    },
  })

  assert.equal(result.success, true)
})

test('澄清请求不生成回答评分，且必须返回澄清回复', () => {
  const result = interviewTurnModelOutputSchema.safeParse({
    inputClassification: 'clarification_request',
    answerEvidence: null,
    nextAction: {
      type: 'clarify_current_question',
      reason: '候选人没有直接回答，而是在询问题目含义。',
    },
    clarificationResponse: {
      content: '这里想考察你如何定位性能瓶颈，可以从现象、指标和工具三个方向回答。',
    },
  })

  assert.equal(result.success, true)
})

test('跑题内容不能携带正式回答证据', () => {
  const result = interviewTurnModelOutputSchema.safeParse({
    inputClassification: 'off_topic',
    answerEvidence: validAnswerEvidence,
    nextAction: {
      type: 'redirect_to_current_question',
      reason: '候选人回答内容和当前问题无关。',
    },
    clarificationResponse: {
      content: '我们先回到刚才的问题，请你说明一次性能瓶颈定位过程。',
    },
  })

  assert.equal(result.success, false)
})

test('明确不会时不允许继续追问同一主题', () => {
  const result = interviewTurnModelOutputSchema.safeParse({
    inputClassification: 'explicit_unknown',
    answerEvidence: {
      ...validAnswerEvidence,
      explicitlyUnknown: true,
      confidence: 'high',
      pointResults: validAnswerEvidence.pointResults.map((point) => ({
        ...point,
        status: 'missed',
        evidence: '候选人明确表示不了解该问题',
        score: 0,
      })),
      summary: '候选人明确表示不了解当前主题。',
    },
    nextAction: {
      type: 'ask_follow_up',
      reason: '继续验证同一主题。',
    },
    nextQuestion,
  })

  assert.equal(result.success, false)
})

test('持久化模型快照拒绝 API Key', () => {
  const result = interviewModelSnapshotSchema.safeParse({
    baseUrl: modelConnection.baseUrl,
    modelName: modelConnection.modelName,
    apiKey: modelConnection.apiKey,
  })

  assert.equal(result.success, false)
})
