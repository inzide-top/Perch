import assert from 'node:assert/strict'
import test from 'node:test'
import { createValidationRepairContext } from '../../utils/model-validation'
import type { InterviewTurnRunInput } from '../../schemas/interview-turn.schema'
import {
  buildInterviewTurnRepairPrompt,
  buildInterviewTurnPromptInput,
  buildInterviewTurnSystemPrompt,
  buildInterviewTurnUserPrompt,
  parseInterviewTurnModelOutput,
} from './turn-prompt'
import { interviewTurnModelOutputSchema, type InterviewTurnModelOutput } from '@/shared/interview/schemas'

const runInput: InterviewTurnRunInput = {
  configuration: {
    type: 'foundation',
    scale: 'standard',
    difficulty: 'adaptive',
    referenceHistoricalWeaknesses: false,
    budget: {
      mainTopicBudget: 6,
      totalQuestionBudget: 20,
      maxFollowUpsPerRoot: 3,
    },
  },
  budgetProgress: {
    mainQuestionsAsked: 1,
    totalQuestionsAsked: 1,
    followUpsForCurrentRoot: 0,
    remainingMainQuestions: 5,
    remainingTotalQuestions: 19,
    remainingFollowUpsForCurrentRoot: 3,
    compoundQuestionsAsked: 0,
    remainingCompoundQuestions: 2,
  },
  assessmentPlan: {
    difficultyRubric: {
      basic: '能够解释前端核心概念。',
      standard: '能够结合业务场景说明应用方式。',
      advanced: '能够处理复杂约束和方案权衡。',
    },
    topics: [
      {
        key: 'performance_optimization',
        label: '性能优化',
        objective: '验证候选人定位、优化和验证性能问题的能力。',
        priority: 'high',
        sources: [
          {
            type: 'jd',
            evidence: 'JD 要求具备复杂业务场景的性能优化能力。',
          },
        ],
        initialDifficulty: 'standard',
        evaluationPoints: [
          {
            key: 'problem_diagnosis',
            label: '问题定位',
            description: '能够说明如何发现瓶颈、收集指标并定位根因。',
            weight: 50,
          },
          {
            key: 'result_validation',
            label: '结果验证',
            description: '能够使用量化指标验证优化效果并进行回归检查。',
            weight: 50,
          },
        ],
      },
      {
        key: 'agent_workflow_design',
        label: 'Agent 工作流设计',
        objective: '验证候选人对 AI 工作流拆解和可靠性处理的理解。',
        priority: 'medium',
        sources: [
          {
            type: 'job_analysis',
            evidence: '分析结果认为 Agent 工作流经验需要进一步验证。',
          },
        ],
        initialDifficulty: 'standard',
        evaluationPoints: [
          {
            key: 'workflow_decomposition',
            label: '流程拆解',
            description: '能够把 Agent 任务拆解成状态、输入、输出和失败处理。',
            weight: 60,
          },
          {
            key: 'failure_handling',
            label: '失败处理',
            description: '能够说明模型失败、校验失败和重试策略。',
            weight: 40,
          },
        ],
      },
    ],
  },
  currentTurn: {
    kind: 'main',
    sequenceNumber: 1,
    mainQuestionNumber: 1,
    followUpNumber: 0,
    question: {
      topicKey: 'performance_optimization',
      targetEvaluationPointKeys: ['problem_diagnosis', 'result_validation'],
      format: 'single',
      content: '请讲一个你实际定位前端性能瓶颈的案例。',
      subQuestions: [],
      focusLabel: '性能问题定位',
    },
    hintUsage: 'none',
  },
  candidateAnswer: {
    content: '我会先看页面加载和交互性能指标，用 DevTools 定位长任务，再结合日志验证是不是接口或渲染问题。',
    submittedAt: '2026-08-03T10:00:00.000Z',
    acceptedAt: '2026-08-03T10:00:01.000Z',
  },
  recentHistory: [],
  reviewEvidence: [
    {
      referenceKey: 'T1',
      sequenceNumber: 1,
      kind: 'main',
      format: 'single',
      topicKey: 'frontend_performance',
      focusLabel: '性能优化',
      question: '请说明一次性能优化。',
      answerSummary: '候选人回答了性能优化流程。',
      evidenceSummary: '能够定位问题并验证结果。',
      pointResults: [{ pointKey: 'performance_diagnosis', status: 'covered', score: 85 }],
      hintUsage: 'none',
      skipReason: null,
    },
  ],
}

const followUpOutput: InterviewTurnModelOutput = {
  inputClassification: 'formal_answer',
  answerEvidence: {
    relevance: 'relevant',
    explicitlyUnknown: false,
    confidence: 'medium',
    hintUsage: 'none',
    pointResults: [
      {
        pointKey: 'problem_diagnosis',
        status: 'covered',
        evidence: '候选人说明了指标观察和 DevTools 定位。',
        score: 82,
      },
      {
        pointKey: 'result_validation',
        status: 'partially_covered',
        evidence: '提到结合日志验证，但没有说明量化指标和回归。',
        score: 55,
      },
    ],
    communication: {
      clarity: 82,
      structure: 76,
      conciseness: 78,
      note: '回答表达清楚，但验证闭环不够完整。',
    },
    summary: '候选人具备性能问题定位思路，但结果验证需要继续追问。',
  },
  nextAction: {
    type: 'ask_follow_up',
    reason: '结果验证不充分，需要继续验证优化闭环。',
  },
  nextQuestion: {
    topicKey: 'performance_optimization',
    targetEvaluationPointKeys: ['result_validation'],
    format: 'single',
    content: '如果你完成优化后，线上核心指标没有明显变化，你会如何判断优化是否有效？',
    subQuestions: [],
    focusLabel: '优化结果验证',
    hints: {
      level1: '可以从指标选择、样本对照和回归验证三个方向思考。',
      level2: '说明如何判断局部性能改善是否真正转化为用户体验或业务指标改善。',
    },
  },
  sessionEvaluationPatch: {
    topicEvaluation: {
      topicKey: 'performance_optimization',
      status: 'partial',
      masteryScore: 68,
      evidenceConfidence: 'medium',
      summary: '定位思路较清晰，验证闭环证据不足。',
    },
    strengths: ['能描述基础定位路径'],
    weaknesses: ['缺少量化验证闭环'],
    suggestions: ['补充优化前后指标和回归方法'],
  },
}

test('System Prompt 限制模型先分类再输出受控证据和下一步动作', () => {
  const prompt = buildInterviewTurnSystemPrompt()

  assert.match(prompt, /formal_answer/)
  assert.match(prompt, /clarification_request/)
  assert.match(prompt, /off_topic/)
  assert.match(prompt, /explicit_unknown/)
  assert.match(prompt, /answerEvidence 只能围绕 currentTurn\.question\.targetEvaluationPointKeys/)
  assert.match(prompt, /复合问题的特别规则/)
  assert.match(prompt, /必须归类为 formal_answer，而不是 explicit_unknown/)
  assert.match(prompt, /ask_follow_up/)
  assert.match(prompt, /finish_session/)
  assert.match(prompt, /clarity: number/)
  assert.match(prompt, /note: string/)
  assert.match(prompt, /正式回答和明确不会必须输出完整 answerEvidence 与完整 sessionEvaluationPatch/)
})

test('User Prompt 使用明确边界包裹回答处理输入', () => {
  const prompt = buildInterviewTurnUserPrompt(runInput)

  assert.match(prompt, /<interview_turn_input>/)
  assert.match(prompt, /<\/interview_turn_input>/)
  assert.match(prompt, /allowedFormalAnswerActionTypes = \["ask_follow_up","ask_next_topic","finish_session"\]/)
  assert.match(prompt, /ask_next_topic 可选的 nextQuestion\.topicKey 只能来自 \["agent_workflow_design"\]/)
  assert.match(prompt, /topicEvaluation\.status 只能是 mastered、solid、partial、weak、unknown/)
  assert.match(prompt, /"topicKey"\s*:\s*"performance_optimization"/)
  assert.match(prompt, /"content"\s*:\s*"请讲一个你实际定位前端性能瓶颈的案例。"/)
  assert.doesNotMatch(prompt, /apiKey/)
  assert.doesNotMatch(prompt, /resumeId/)
})

test('模型输入移除与 reviewEvidence 重复的历史和可推导预算字段', () => {
  const promptInput = buildInterviewTurnPromptInput(runInput)
  const prompt = buildInterviewTurnUserPrompt(runInput)
  const fullPrettyInput = JSON.stringify(runInput, null, 2)

  assert.equal('recentHistory' in promptInput, false)
  assert.equal('budget' in promptInput.configuration, false)
  assert.equal('mainQuestionsAsked' in promptInput.budgetProgress, false)
  assert.equal('totalQuestionsAsked' in promptInput.budgetProgress, false)
  assert.deepEqual(promptInput.reviewEvidence, runInput.reviewEvidence)
  assert.match(prompt, /"reviewEvidence"/)
  assert.doesNotMatch(prompt, /"recentHistory"/)
  assert.ok(JSON.stringify(promptInput).length < fullPrettyInput.length * 0.8)
})

test('合法回答处理 JSON 可以完成解析和上下文校验', () => {
  const result = parseInterviewTurnModelOutput(JSON.stringify(followUpOutput), runInput)

  assert.deepEqual(result, followUpOutput)
})

test('解析层使用服务端事实补齐并覆盖提示级别与明确不会标记', () => {
  const input = structuredClone(runInput)
  input.currentTurn.hintUsage = 'level_1'
  const rawOutput = structuredClone(followUpOutput) as unknown as Record<string, unknown>
  const answerEvidence = rawOutput.answerEvidence as Record<string, unknown>
  delete answerEvidence.explicitlyUnknown
  delete answerEvidence.hintUsage

  const result = parseInterviewTurnModelOutput(JSON.stringify(rawOutput), input)
  assert.equal(result.answerEvidence?.explicitlyUnknown, false)
  assert.equal(result.answerEvidence?.hintUsage, 'level_1')

  rawOutput.inputClassification = 'explicit_unknown'
  answerEvidence.explicitlyUnknown = false
  answerEvidence.hintUsage = 'none'
  rawOutput.nextAction = {
    type: 'ask_next_topic',
    reason: '候选人明确不会当前主题，继续验证其他主题。',
  }
  rawOutput.nextQuestion = {
    topicKey: 'agent_workflow_design',
    targetEvaluationPointKeys: ['workflow_decomposition'],
    format: 'single',
    content: '请说明你会如何拆解一个 Agent 工作流。',
    subQuestions: [],
    focusLabel: '工作流拆解',
    hints: {
      level1: '可以从输入、处理和输出三个部分思考。',
      level2: '还可以补充状态流转和失败处理。',
    },
  }
  const unknownResult = parseInterviewTurnModelOutput(JSON.stringify(rawOutput), input)
  assert.equal(unknownResult.answerEvidence?.explicitlyUnknown, true)
  assert.equal(unknownResult.answerEvidence?.hintUsage, 'level_1')
})

test('结束面试时可以生成带 T 题次引用的最终复盘', () => {
  const completedOutput = structuredClone(followUpOutput)
  completedOutput.nextAction = {
    type: 'finish_session',
    reason: '本轮问题已完成。',
  }
  completedOutput.nextQuestion = undefined
  completedOutput.finalReview = {
    summary: '本轮回答覆盖了性能定位和结果验证。',
    strengths: [
      {
        title: '定位路径清晰',
        detail: '能够从指标、开发者工具和日志逐步定位问题。',
        referenceKeys: ['T1'],
      },
    ],
    gaps: [],
    nextPractice: ['补充优化前后的量化对照。'],
  }

  const result = parseInterviewTurnModelOutput(JSON.stringify(completedOutput), runInput)
  assert.equal(result.nextAction.type, 'finish_session')
  assert.equal(result.finalReview?.strengths[0]?.referenceKeys[0], 'T1')
})

test('最终复盘引用不存在的题次时只保留可用的核心回答结果', () => {
  const completedOutput = structuredClone(followUpOutput)
  completedOutput.nextAction = {
    type: 'finish_session',
    reason: '本轮问题已完成。',
  }
  completedOutput.nextQuestion = undefined
  completedOutput.finalReview = {
    summary: '复盘引用错误。',
    strengths: [
      {
        title: '无效引用',
        detail: '该引用不在输入证据中。',
        referenceKeys: ['T99'],
      },
    ],
    gaps: [],
    nextPractice: [],
  }

  const result = parseInterviewTurnModelOutput(JSON.stringify(completedOutput), runInput)
  assert.equal(result.nextAction.type, 'finish_session')
  assert.equal(result.finalReview, undefined)
  assert.ok(result.answerEvidence)
})

test('回答证据只能引用当前问题目标评估点', () => {
  const invalidOutput = structuredClone(followUpOutput)
  if (!invalidOutput.answerEvidence) return
  invalidOutput.answerEvidence.pointResults = invalidOutput.answerEvidence.pointResults.filter(
    (point) => point.pointKey !== 'result_validation',
  )

  assert.throws(() => {
    parseInterviewTurnModelOutput(JSON.stringify(invalidOutput), runInput)
  })
})

test('追问必须继续围绕当前主题', () => {
  const invalidOutput = structuredClone(followUpOutput)
  if (!invalidOutput.nextQuestion) return
  invalidOutput.nextQuestion.topicKey = 'agent_workflow_design'
  invalidOutput.nextQuestion.targetEvaluationPointKeys = ['workflow_decomposition']

  assert.throws(() => {
    parseInterviewTurnModelOutput(JSON.stringify(invalidOutput), runInput)
  })
})

test('复合问题额度用尽后拒绝继续生成 compound', () => {
  const input = structuredClone(runInput)
  input.budgetProgress.remainingCompoundQuestions = 0
  const invalidOutput = structuredClone(followUpOutput)
  if (!invalidOutput.nextQuestion) return
  invalidOutput.nextQuestion.format = 'compound'
  invalidOutput.nextQuestion.content = '请按顺序回答以下两个相关问题。'
  invalidOutput.nextQuestion.subQuestions = ['你会选择哪些量化指标？', '你会如何设计优化前后的对照验证？']

  assert.throws(() => {
    parseInterviewTurnModelOutput(JSON.stringify(invalidOutput), input)
  })
})

test('主问题额度用尽后拒绝进入新主题，并允许结束面试', () => {
  const input = structuredClone(runInput)
  input.budgetProgress.remainingMainQuestions = 0

  const invalidOutput = structuredClone(followUpOutput)
  invalidOutput.nextAction = {
    type: 'ask_next_topic',
    reason: '当前主题已经充分验证，准备进入新主题。',
  }
  if (!invalidOutput.nextQuestion) return
  invalidOutput.nextQuestion.topicKey = 'agent_workflow_design'
  invalidOutput.nextQuestion.targetEvaluationPointKeys = ['workflow_decomposition']

  assert.throws(
    () => parseInterviewTurnModelOutput(JSON.stringify(invalidOutput), input),
    /主问题额度已用尽，不能进入新主题/,
  )

  const completedOutput = structuredClone(followUpOutput)
  completedOutput.nextAction = {
    type: 'finish_session',
    reason: '主问题额度已经用尽，本轮面试结束。',
  }
  completedOutput.nextQuestion = undefined
  completedOutput.finalReview = {
    summary: '本轮面试总结。',
    strengths: [{ title: '基础扎实', detail: '能够准确回答当前评估点。', referenceKeys: ['T1'] }],
    gaps: [],
    nextPractice: ['继续练习边界条件。'],
  }

  const result = parseInterviewTurnModelOutput(JSON.stringify(completedOutput), input)
  assert.equal(result.nextAction.type, 'finish_session')
  assert.equal(result.nextQuestion, undefined)
})

test('User Prompt 和修复 Prompt 会显式写入当前题目预算硬约束', () => {
  const input = structuredClone(runInput)
  input.budgetProgress.remainingMainQuestions = 0

  const userPrompt = buildInterviewTurnUserPrompt(input)
  assert.match(userPrompt, /剩余主问题额度：0/)
  assert.match(userPrompt, /禁止使用 ask_next_topic/)
  assert.match(userPrompt, /必须使用 finish_session/)
  assert.match(userPrompt, /allowedFormalAnswerActionTypes = \["ask_follow_up","finish_session"\]/)

  const invalidOutput = structuredClone(followUpOutput)
  invalidOutput.nextAction = {
    type: 'ask_next_topic',
    reason: '进入新主题。',
  }
  const result = interviewTurnModelOutputSchema.safeParse(invalidOutput)
  assert.equal(result.success, true)
  if (!result.success) return

  const contextualError = (() => {
    try {
      parseInterviewTurnModelOutput(JSON.stringify(invalidOutput), input)
      return null
    } catch (error) {
      return error
    }
  })()
  assert.ok(contextualError instanceof Error)

  const repairContext = createValidationRepairContext(
    JSON.stringify(invalidOutput),
    contextualError as Parameters<typeof createValidationRepairContext>[1],
  )
  const repairPrompt = buildInterviewTurnRepairPrompt(input, repairContext)
  assert.match(repairPrompt, /禁止使用 ask_next_topic/)
  assert.match(repairPrompt, /主问题额度已用尽，不能进入新主题/)
  assert.match(repairPrompt, /修复一个字段时不得破坏其他字段/)
})

test('没有其他候选主题时运行时契约禁止 ask_next_topic', () => {
  const input = structuredClone(runInput)
  input.assessmentPlan.topics = input.assessmentPlan.topics.filter(
    (topic) => topic.key === input.currentTurn.question.topicKey,
  )

  const prompt = buildInterviewTurnUserPrompt(input)
  assert.match(prompt, /allowedFormalAnswerActionTypes = \["ask_follow_up","finish_session"\]/)
  assert.match(prompt, /ask_next_topic 可选的 nextQuestion\.topicKey 只能来自 \[\]/)
  assert.match(prompt, /数组为空时禁止 ask_next_topic/)
})

test('修复 Prompt 会携带校验路径、错误值并要求重输完整结果', () => {
  const invalidOutput = structuredClone(followUpOutput)
  invalidOutput.nextQuestion = undefined
  const result = interviewTurnModelOutputSchema.safeParse(invalidOutput)

  assert.equal(result.success, false)
  if (result.success) return

  const repairContext = createValidationRepairContext(JSON.stringify(invalidOutput), result.error)
  const prompt = buildInterviewTurnRepairPrompt(runInput, repairContext)

  assert.match(prompt, /nextQuestion/)
  assert.match(prompt, /重新生成一个完整、合法的 JSON 对象/)
  assert.match(prompt, /不得为了修复少数字段而缩写/)
  assert.match(prompt, /"topicKey"\s*:\s*"performance_optimization"/)
})
