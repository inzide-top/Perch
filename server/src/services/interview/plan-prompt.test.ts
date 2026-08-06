import assert from 'node:assert/strict'
import test from 'node:test'
import { interviewPlanModelOutputSchema, type InterviewPlanModelOutput } from '@/shared/interview/schemas'
import type { InterviewPlanRunInput } from '../../schemas/interview-plan.schema'
import {
  buildInterviewPlanRepairPrompt,
  buildInterviewPlanSystemPrompt,
  buildInterviewPlanUserPrompt,
  parseInterviewPlanModelOutput,
} from './plan-prompt'
import { createValidationRepairContext } from '../../utils/model-validation'

const runInput: InterviewPlanRunInput = {
  opportunity: {
    company: 'Bilibili',
    jobTitle: 'AI Native 开发工程师',
    address: ['上海'],
    introduction: '负责 AI 应用相关产品开发。',
    description: '要求具备前端工程能力和 AI 应用经验。',
  },
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
  resume: {
    targetDirection: '前端开发工程师',
    skills: 'TypeScript、Vue、React、前端工程化',
    workExperiences: [],
    projects: [],
  },
  analysis: {
    summary: '候选人前端基础较好，但 AI 应用深度需要验证。',
    scoreBreakdown: [
      {
        key: 'core_requirements',
        label: '核心要求',
        weight: 20,
        score: 80,
        reason: '具备主要前端技能。',
      },
      {
        key: 'related_experience',
        label: '相关经验',
        weight: 20,
        score: 75,
        reason: '存在相关项目经历。',
      },
      {
        key: 'seniority_depth',
        label: '资历深度',
        weight: 15,
        score: 70,
        reason: '职责深度需要进一步验证。',
      },
      {
        key: 'business_context',
        label: '业务场景',
        weight: 15,
        score: 65,
        reason: '部分业务经验可以迁移。',
      },
      {
        key: 'bonus_points',
        label: '加分项',
        weight: 15,
        score: 60,
        reason: '具备部分 AI 应用经验。',
      },
      {
        key: 'job_constraints',
        label: '岗位约束',
        weight: 15,
        score: 50,
        reason: '工作城市不完全匹配。',
      },
    ],
    requirementMatches: [],
    strengths: [],
    gaps: [],
    interviewFocus: [],
  },
  historicalWeaknesses: [],
  historicalReviews: [],
}

const modelOutput: InterviewPlanModelOutput = {
  difficultyRubric: {
    basic: '能够解释前端核心概念和常见开发流程。',
    standard: '能够结合业务场景完成设计、实现和问题定位。',
    advanced: '能够处理复杂约束、架构取舍和稳定性风险。',
  },
  topics: [
    {
      key: 'frontend_foundation',
      label: '前端基础能力',
      objective: '验证候选人对前端核心机制的理解和应用能力。',
      priority: 'high',
      sources: [
        {
          type: 'jd',
          evidence: 'JD 要求具备扎实的前端基础。',
        },
      ],
      initialDifficulty: 'standard',
      evaluationPoints: [
        {
          key: 'concept_understanding',
          label: '概念理解',
          description: '能够准确解释核心机制及其作用。',
          weight: 60,
        },
        {
          key: 'practical_application',
          label: '实际应用',
          description: '能够结合典型场景说明具体使用方式。',
          weight: 40,
        },
      ],
    },
  ],
  firstQuestion: {
    topicKey: 'frontend_foundation',
    targetEvaluationPointKeys: ['concept_understanding', 'practical_application'],
    format: 'single',
    content: '请解释 Vue 响应式系统的基本原理，并说明它在实际开发中的作用。',
    subQuestions: [],
    focusLabel: '响应式原理',
    hints: {
      level1: '可以从数据变化与视图更新的关系开始思考。',
      level2: '可以结合依赖收集、变化触发和组件更新过程组织回答。',
    },
  },
}

test('System Prompt 包含面试计划的三个生成阶段', () => {
  const prompt = buildInterviewPlanSystemPrompt()

  assert.match(prompt, /第一阶段：生成岗位专属难度规则/)
  assert.match(prompt, /第二阶段：规划面试主题和评估点/)
  assert.match(prompt, /第三阶段：生成第一道面试问题及两级提示/)
  assert.match(prompt, /configuration\.type 为 foundation/)
  assert.match(prompt, /configuration\.type 为 project/)
  assert.match(prompt, /historicalReviews/)
  assert.match(prompt, /historical_review/)
})

test('User Prompt 使用明确的数据边界包裹结构化输入', () => {
  const prompt = buildInterviewPlanUserPrompt(runInput)

  assert.match(prompt, /<interview_plan_input>/)
  assert.match(prompt, /<\/interview_plan_input>/)
  assert.match(prompt, /"company"\s*:\s*"Bilibili"/)
  assert.match(prompt, /"type"\s*:\s*"foundation"/)
  assert.doesNotMatch(prompt, /apiKey/)
  assert.doesNotMatch(prompt, /resumeId/)
})

test('基础面 Prompt 明确禁止把项目经历复盘作为首题主线', () => {
  const prompt = buildInterviewPlanSystemPrompt()

  assert.match(prompt, /当 configuration\.type 为 foundation/)
  assert.match(prompt, /问题不能以具体项目经历为主线/)
  assert.match(prompt, /禁止在第一题或主题目标中要求/)
})

test('基础面 Prompt 限制单条历史复盘垄断主题，并要求能力覆盖多样性', () => {
  const prompt = buildInterviewPlanSystemPrompt()

  assert.match(prompt, /单条 historical_review 或 historical_weakness 只能提高相关主题的优先级/)
  assert.match(prompt, /至少保留一个不由该单条历史复盘直接驱动的主题/)
  assert.match(prompt, /单条历史复盘直接驱动的主题最多占主题预算的一半/)
  assert.match(prompt, /每个主题必须验证不同的能力证据/)
  assert.match(prompt, /不强行加入无关主题/)
})

test('面向候选人的面试计划文案必须使用简体中文', () => {
  const prompt = buildInterviewPlanSystemPrompt()

  assert.match(prompt, /所有面向候选人的文案必须使用简体中文/)
})

test('合法面试计划 JSON 可以完成解析和 Zod 校验', () => {
  const result = parseInterviewPlanModelOutput(JSON.stringify(modelOutput))

  assert.deepEqual(result, modelOutput)
})

test('面试计划解析支持 Markdown JSON 代码块', () => {
  const rawOutput = `\`\`\`json
${JSON.stringify(modelOutput)}
\`\`\``

  const result = parseInterviewPlanModelOutput(rawOutput)

  assert.deepEqual(result, modelOutput)
})

test('首题引用不存在的主题时拒绝模型输出', () => {
  const invalidOutput = structuredClone(modelOutput)
  invalidOutput.firstQuestion.topicKey = 'missing_topic'

  assert.throws(() => {
    parseInterviewPlanModelOutput(JSON.stringify(invalidOutput))
  })
})

test('修复 Prompt 会携带校验路径、错误值并要求重新输出完整结果', () => {
  const invalidOutput = structuredClone(modelOutput)
  invalidOutput.firstQuestion.topicKey = 'missing_topic'
  const result = interviewPlanModelOutputSchema.safeParse(invalidOutput)

  assert.equal(result.success, false)
  if (result.success) return

  const repairContext = createValidationRepairContext(JSON.stringify(invalidOutput), result.error)
  const prompt = buildInterviewPlanRepairPrompt(runInput, repairContext)

  assert.match(prompt, /firstQuestion.*topicKey/)
  assert.match(prompt, /missing_topic/)
  assert.match(prompt, /重新生成一个完整、合法的 JSON 对象/)
  assert.match(prompt, /"company"\s*:\s*"Bilibili"/)
})
