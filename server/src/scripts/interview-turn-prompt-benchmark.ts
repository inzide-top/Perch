import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config as loadEnvironment } from 'dotenv'
import { z, ZodError } from 'zod'
import { interviewTurnRunInputSchema } from '../schemas/interview-turn.schema'
import { requestModelCompletion } from '../services/ai/model-client'
import {
  buildInterviewTurnPromptInput,
  buildInterviewTurnSystemPrompt,
  buildInterviewTurnUserPrompt,
  parseInterviewTurnModelOutput,
} from '../services/interview/turn-prompt'
import { createValidationRepairContext } from '../utils/model-validation'

loadEnvironment({ path: '.env.prompt-benchmark.local', quiet: true })

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const inputClassificationSchema = z.enum(['formal_answer', 'clarification_request', 'off_topic', 'explicit_unknown'])
const actionTypeSchema = z.enum([
  'ask_follow_up',
  'ask_next_topic',
  'clarify_current_question',
  'redirect_to_current_question',
  'finish_session',
])
const pointStatusSchema = z.enum(['covered', 'partially_covered', 'missed', 'incorrect'])

const benchmarkConfigSchema = z
  .object({
    PROMPT_BENCHMARK_API_KEY: z.string().trim().min(1),
    PROMPT_BENCHMARK_BASE_URL: z.string().trim().url(),
    PROMPT_BENCHMARK_MODEL_NAME: z.string().trim().min(1),
    PROMPT_BENCHMARK_RUN_ID: z.preprocess(emptyStringToUndefined, z.string().uuid().optional()),
    PROMPT_BENCHMARK_CASES_PATH: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()),
    PROMPT_BENCHMARK_CASE_NAMES: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()),
    PROMPT_BENCHMARK_SAMPLES: z.coerce.number().int().min(1).max(5).default(3),
    PROMPT_BENCHMARK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    PROMPT_BENCHMARK_SEED: z.preprocess(emptyStringToUndefined, z.coerce.number().int().optional()),
    PROMPT_BENCHMARK_AGENT_API: z.string().trim().url().default('http://127.0.0.1:8787/api'),
  })
  .superRefine((config, context) => {
    if (!config.PROMPT_BENCHMARK_RUN_ID && !config.PROMPT_BENCHMARK_CASES_PATH) {
      context.addIssue({
        code: 'custom',
        path: ['PROMPT_BENCHMARK_RUN_ID'],
        message: '必须配置单个 AgentRun ID 或评测清单路径',
      })
    }
  })

const expectedPointResultSchema = z
  .object({
    pointKey: z.string().trim().min(1),
    allowedStatuses: z.array(pointStatusSchema).min(1),
    minimumScore: z.number().int().min(0).max(100).optional(),
    maximumScore: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.minimumScore === undefined || value.maximumScore === undefined || value.minimumScore <= value.maximumScore,
    { message: 'minimumScore 不能大于 maximumScore' },
  )

const benchmarkExpectationSchema = z
  .object({
    inputClassification: inputClassificationSchema,
    allowedActionTypes: z.array(actionTypeSchema).min(1),
    allowedNextTopicKeys: z.array(z.string().trim().min(1)).optional(),
    maximumPointScore: z.number().int().min(0).max(100).optional(),
    hintUsage: z.enum(['none', 'level_1', 'level_2']).optional(),
    pointResults: z.array(expectedPointResultSchema).optional(),
  })
  .strict()

const benchmarkCaseSchema = z
  .object({
    name: z.string().trim().min(1),
    runId: z.string().uuid(),
    candidateAnswerOverride: z.string().trim().min(1).max(4000).optional(),
    budgetProgressOverride: z
      .object({
        remainingMainQuestions: z.number().int().nonnegative().optional(),
        remainingTotalQuestions: z.number().int().nonnegative().optional(),
        remainingFollowUpsForCurrentRoot: z.number().int().nonnegative().optional(),
        remainingCompoundQuestions: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    currentTurnOverride: z
      .object({
        hintUsage: z.enum(['none', 'level_1', 'level_2']).optional(),
        question: z
          .object({
            format: z.enum(['single', 'compound']).optional(),
            content: z.string().trim().min(1).max(500).optional(),
            subQuestions: z.array(z.string().trim().min(1).max(120)).max(3).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    expected: benchmarkExpectationSchema,
  })
  .strict()

const benchmarkSuiteSchema = z
  .object({
    cases: z.array(benchmarkCaseSchema).min(1).max(20),
  })
  .strict()

const runDetailSchema = z.object({
  id: z.string().uuid(),
  input: z.unknown(),
})

type BenchmarkExpectation = z.output<typeof benchmarkExpectationSchema>
type BenchmarkCase = z.output<typeof benchmarkCaseSchema>
type BenchmarkInput = z.output<typeof interviewTurnRunInputSchema>
type BenchmarkSample = {
  sample: number
  passed: boolean
  qualityPassed?: boolean
  qualityIssues?: string[]
  failureStage?: 'transport' | 'validation'
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
  actionType?: string
  inputClassification?: string
  nextTopicKey?: string | null
  pointResults?: Array<{ pointKey: string; status: string; score: number }>
  validationIssues?: ReturnType<typeof createValidationRepairContext>['validationIssues']
  error?: string
}

function countValues(values: Array<string | null | undefined>) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? '(none)'
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function summarizePointResults(samples: BenchmarkSample[]) {
  const resultsByPoint = new Map<string, Array<{ status: string; score: number }>>()

  samples.forEach((sample) => {
    sample.pointResults?.forEach(({ pointKey, status, score }) => {
      const results = resultsByPoint.get(pointKey) ?? []
      results.push({ status, score })
      resultsByPoint.set(pointKey, results)
    })
  })

  return Object.fromEntries(
    [...resultsByPoint.entries()].map(([pointKey, results]) => {
      const scores = results.map((result) => result.score)
      return [
        pointKey,
        {
          statusDistribution: countValues(results.map((result) => result.status)),
          minimumScore: Math.min(...scores),
          maximumScore: Math.max(...scores),
          averageScore: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
        },
      ]
    }),
  )
}

function evaluateExpectedOutput(
  output: ReturnType<typeof parseInterviewTurnModelOutput>,
  expected: BenchmarkExpectation,
) {
  const issues: string[] = []

  if (output.inputClassification !== expected.inputClassification) {
    issues.push(`输入分类应为 ${expected.inputClassification}，实际为 ${output.inputClassification}`)
  }
  if (!expected.allowedActionTypes.includes(output.nextAction.type)) {
    issues.push(`动作 ${output.nextAction.type} 不在允许范围 ${expected.allowedActionTypes.join(', ')}`)
  }
  if (expected.hintUsage !== undefined && output.answerEvidence?.hintUsage !== expected.hintUsage) {
    issues.push(`提示级别应为 ${expected.hintUsage}，实际为 ${output.answerEvidence?.hintUsage ?? '(none)'}`)
  }
  if (expected.allowedNextTopicKeys && !expected.allowedNextTopicKeys.includes(output.nextQuestion?.topicKey ?? '')) {
    issues.push(`下一主题 ${output.nextQuestion?.topicKey ?? '(none)'} 不在允许范围`)
  }

  const pointResults = output.answerEvidence?.pointResults ?? []
  if (expected.maximumPointScore !== undefined) {
    pointResults.forEach((point) => {
      if (point.score > expected.maximumPointScore!) {
        issues.push(`评估点 ${point.pointKey} 分数 ${point.score} 高于上限 ${expected.maximumPointScore}`)
      }
    })
  }

  expected.pointResults?.forEach((pointExpectation) => {
    const point = pointResults.find((item) => item.pointKey === pointExpectation.pointKey)
    if (!point) {
      issues.push(`缺少预期评估点 ${pointExpectation.pointKey}`)
      return
    }
    if (!pointExpectation.allowedStatuses.includes(point.status)) {
      issues.push(`评估点 ${point.pointKey} 状态 ${point.status} 不在允许范围`)
    }
    if (pointExpectation.minimumScore !== undefined && point.score < pointExpectation.minimumScore) {
      issues.push(`评估点 ${point.pointKey} 分数 ${point.score} 低于下限 ${pointExpectation.minimumScore}`)
    }
    if (pointExpectation.maximumScore !== undefined && point.score > pointExpectation.maximumScore) {
      issues.push(`评估点 ${point.pointKey} 分数 ${point.score} 高于上限 ${pointExpectation.maximumScore}`)
    }
  })

  return issues
}

async function loadRunInput(agentApi: string, runId: string) {
  const response = await fetch(`${agentApi.replace(/\/+$/, '')}/developer/agent-runs/${runId}`)
  if (!response.ok) throw new Error(`读取 AgentRun 失败（HTTP ${response.status}）`)

  const detail = runDetailSchema.parse(await response.json())
  return interviewTurnRunInputSchema.parse(detail.input)
}

async function loadCases(config: z.output<typeof benchmarkConfigSchema>): Promise<BenchmarkCase[]> {
  if (config.PROMPT_BENCHMARK_CASES_PATH) {
    const content = await readFile(resolve(config.PROMPT_BENCHMARK_CASES_PATH), 'utf8')
    return benchmarkSuiteSchema.parse(JSON.parse(content)).cases
  }

  return [
    {
      name: 'single-run',
      runId: config.PROMPT_BENCHMARK_RUN_ID!,
      expected: {
        inputClassification: 'formal_answer',
        allowedActionTypes: ['ask_follow_up', 'ask_next_topic', 'finish_session'],
      },
    },
  ]
}

function applyCaseOverrides(input: BenchmarkInput, benchmarkCase: BenchmarkCase) {
  if (
    !benchmarkCase.candidateAnswerOverride &&
    !benchmarkCase.budgetProgressOverride &&
    !benchmarkCase.currentTurnOverride
  ) {
    return input
  }

  return interviewTurnRunInputSchema.parse({
    ...input,
    budgetProgress: {
      ...input.budgetProgress,
      ...benchmarkCase.budgetProgressOverride,
    },
    currentTurn: {
      ...input.currentTurn,
      ...benchmarkCase.currentTurnOverride,
      question: {
        ...input.currentTurn.question,
        ...benchmarkCase.currentTurnOverride?.question,
      },
    },
    candidateAnswer: {
      ...input.candidateAnswer,
      content: benchmarkCase.candidateAnswerOverride ?? input.candidateAnswer.content,
    },
  })
}

function validateCaseConfiguration(input: BenchmarkInput, benchmarkCase: BenchmarkCase) {
  const issues: string[] = []
  const currentTopicKey = input.currentTurn.question.topicKey
  const topicKeys = new Set(input.assessmentPlan.topics.map((topic) => topic.key))
  const currentTargetKeys = new Set(input.currentTurn.question.targetEvaluationPointKeys)
  const allowedRuntimeActions = new Set<string>([
    'clarify_current_question',
    'redirect_to_current_question',
    'finish_session',
  ])

  if (input.budgetProgress.remainingFollowUpsForCurrentRoot > 0 && input.budgetProgress.remainingTotalQuestions > 0) {
    allowedRuntimeActions.add('ask_follow_up')
  }
  if (
    input.budgetProgress.remainingMainQuestions > 0 &&
    input.budgetProgress.remainingTotalQuestions > 0 &&
    input.assessmentPlan.topics.some((topic) => topic.key !== currentTopicKey)
  ) {
    allowedRuntimeActions.add('ask_next_topic')
  }

  benchmarkCase.expected.allowedActionTypes.forEach((actionType) => {
    if (!allowedRuntimeActions.has(actionType)) issues.push(`期望动作 ${actionType} 与当前题目预算冲突`)
  })
  benchmarkCase.expected.allowedNextTopicKeys?.forEach((topicKey) => {
    if (!topicKeys.has(topicKey)) issues.push(`期望下一主题 ${topicKey} 不存在于面试蓝图`)
    if (topicKey === currentTopicKey) issues.push(`期望下一主题 ${topicKey} 仍是当前主题`)
  })
  benchmarkCase.expected.pointResults?.forEach((point) => {
    if (!currentTargetKeys.has(point.pointKey)) issues.push(`期望评估点 ${point.pointKey} 不属于当前问题`)
  })

  return issues
}

async function runBenchmarkSample(
  sample: number,
  modelConnection: { baseUrl: string; modelName: string; apiKey: string },
  input: BenchmarkInput,
  expected: BenchmarkExpectation,
  options: { temperature: number; seed?: number },
): Promise<BenchmarkSample> {
  const startedAt = Date.now()

  try {
    const completion = await requestModelCompletion(
      `interview-turn-prompt-benchmark:${crypto.randomUUID()}`,
      modelConnection,
      buildInterviewTurnSystemPrompt(),
      buildInterviewTurnUserPrompt(input),
      options,
    )

    try {
      const output = parseInterviewTurnModelOutput(completion.rawOutput, input)
      const qualityIssues = evaluateExpectedOutput(output, expected)
      return {
        sample,
        passed: true,
        qualityPassed: qualityIssues.length === 0,
        qualityIssues,
        durationMs: Date.now() - startedAt,
        inputTokens: completion.tokenUsage?.inputTokens ?? null,
        outputTokens: completion.tokenUsage?.outputTokens ?? null,
        inputClassification: output.inputClassification,
        actionType: output.nextAction.type,
        nextTopicKey: output.nextQuestion?.topicKey ?? null,
        pointResults: output.answerEvidence?.pointResults.map(({ pointKey, status, score }) => ({
          pointKey,
          status,
          score,
        })),
      }
    } catch (error) {
      const repairContext =
        error instanceof ZodError ? createValidationRepairContext(completion.rawOutput, error) : null

      return {
        sample,
        passed: false,
        failureStage: 'validation',
        durationMs: Date.now() - startedAt,
        inputTokens: completion.tokenUsage?.inputTokens ?? null,
        outputTokens: completion.tokenUsage?.outputTokens ?? null,
        validationIssues: repairContext?.validationIssues,
        error: error instanceof Error ? error.message : '模型输出无法解析',
      }
    }
  } catch (error) {
    return {
      sample,
      passed: false,
      failureStage: 'transport',
      durationMs: Date.now() - startedAt,
      inputTokens: null,
      outputTokens: null,
      error: error instanceof Error ? error.message : '模型请求失败',
    }
  }
}

async function runBenchmarkCase(
  benchmarkCase: BenchmarkCase,
  config: z.output<typeof benchmarkConfigSchema>,
  modelConnection: { baseUrl: string; modelName: string; apiKey: string },
  modelOptions: { temperature: number; seed?: number },
) {
  const originalInput = await loadRunInput(config.PROMPT_BENCHMARK_AGENT_API, benchmarkCase.runId)
  const input = applyCaseOverrides(originalInput, benchmarkCase)
  const samples: BenchmarkSample[] = []

  for (let sample = 1; sample <= config.PROMPT_BENCHMARK_SAMPLES; sample += 1) {
    samples.push(await runBenchmarkSample(sample, modelConnection, input, benchmarkCase.expected, modelOptions))
  }

  const passedSamples = samples.filter((sample) => sample.passed)
  const responseSamples = samples.filter((sample) => sample.failureStage !== 'transport')
  const qualitySamples = passedSamples.filter((sample) => sample.qualityPassed !== undefined)
  const qualityPassedSamples = qualitySamples.filter((sample) => sample.qualityPassed)
  const systemPromptCharacters = buildInterviewTurnSystemPrompt().length
  const userPromptCharacters = buildInterviewTurnUserPrompt(input).length
  const fullPrettyInputCharacters = JSON.stringify(input, null, 2).length
  const modelInputCharacters = JSON.stringify(buildInterviewTurnPromptInput(input)).length

  return {
    name: benchmarkCase.name,
    runId: benchmarkCase.runId,
    usedCandidateAnswerOverride: benchmarkCase.candidateAnswerOverride !== undefined,
    usedBudgetProgressOverride: benchmarkCase.budgetProgressOverride !== undefined,
    usedCurrentTurnOverride: benchmarkCase.currentTurnOverride !== undefined,
    expected: benchmarkCase.expected,
    sampleCount: samples.length,
    responseCount: responseSamples.length,
    requestSuccessRate: responseSamples.length / samples.length,
    firstPassCount: passedSamples.length,
    firstPassRateAmongResponses: responseSamples.length ? passedSamples.length / responseSamples.length : null,
    qualityPassCount: qualityPassedSamples.length,
    qualityPassRate: qualitySamples.length ? qualityPassedSamples.length / qualitySamples.length : null,
    semanticStability: {
      inputClassificationDistribution: countValues(passedSamples.map((sample) => sample.inputClassification)),
      actionTypeDistribution: countValues(passedSamples.map((sample) => sample.actionType)),
      nextTopicDistribution: countValues(passedSamples.map((sample) => sample.nextTopicKey)),
      pointResults: summarizePointResults(passedSamples),
    },
    promptCharacters: {
      system: systemPromptCharacters,
      user: userPromptCharacters,
      total: systemPromptCharacters + userPromptCharacters,
      fullPrettyInput: fullPrettyInputCharacters,
      modelInput: modelInputCharacters,
      modelInputReductionRate: 1 - modelInputCharacters / fullPrettyInputCharacters,
    },
    averageDurationMs: Math.round(samples.reduce((total, sample) => total + sample.durationMs, 0) / samples.length),
    samples,
  }
}

async function main() {
  const benchmarkConfig = benchmarkConfigSchema.parse(process.env)
  const loadedCases = await loadCases(benchmarkConfig)
  const selectedCaseNames = benchmarkConfig.PROMPT_BENCHMARK_CASE_NAMES?.split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const benchmarkCases = selectedCaseNames?.length
    ? loadedCases.filter((benchmarkCase) => selectedCaseNames.includes(benchmarkCase.name))
    : loadedCases

  if (benchmarkCases.length === 0) {
    throw new Error('PROMPT_BENCHMARK_CASE_NAMES 未匹配到任何评测用例')
  }
  const modelConnection = {
    baseUrl: benchmarkConfig.PROMPT_BENCHMARK_BASE_URL,
    modelName: benchmarkConfig.PROMPT_BENCHMARK_MODEL_NAME,
    apiKey: benchmarkConfig.PROMPT_BENCHMARK_API_KEY,
  }
  const modelOptions = {
    temperature: benchmarkConfig.PROMPT_BENCHMARK_TEMPERATURE,
    ...(benchmarkConfig.PROMPT_BENCHMARK_SEED === undefined ? {} : { seed: benchmarkConfig.PROMPT_BENCHMARK_SEED }),
  }
  const validateCasesOnly = process.argv.includes('--validate-cases')

  if (validateCasesOnly) {
    const cases = []
    for (const benchmarkCase of benchmarkCases) {
      const originalInput = await loadRunInput(benchmarkConfig.PROMPT_BENCHMARK_AGENT_API, benchmarkCase.runId)
      const input = applyCaseOverrides(originalInput, benchmarkCase)
      const issues = validateCaseConfiguration(input, benchmarkCase)
      cases.push({
        name: benchmarkCase.name,
        runId: benchmarkCase.runId,
        valid: issues.length === 0,
        issues,
        promptCharacters: buildInterviewTurnSystemPrompt().length + buildInterviewTurnUserPrompt(input).length,
        modelInputCharacters: JSON.stringify(buildInterviewTurnPromptInput(input)).length,
      })
    }

    console.log(
      JSON.stringify(
        {
          valid: cases.every((benchmarkCase) => benchmarkCase.valid),
          caseCount: cases.length,
          cases,
        },
        null,
        2,
      ),
    )
    return
  }

  const cases = []

  for (const benchmarkCase of benchmarkCases) {
    cases.push(await runBenchmarkCase(benchmarkCase, benchmarkConfig, modelConnection, modelOptions))
  }

  const totalSamples = cases.reduce((total, item) => total + item.sampleCount, 0)
  const totalResponses = cases.reduce((total, item) => total + item.responseCount, 0)
  const totalFirstPasses = cases.reduce((total, item) => total + item.firstPassCount, 0)
  const totalQualityPasses = cases.reduce((total, item) => total + item.qualityPassCount, 0)
  const result = {
    promptVersion: 'mock-interview-turn.v6',
    modelName: modelConnection.modelName,
    temperature: modelOptions.temperature,
    seed: modelOptions.seed ?? null,
    caseCount: cases.length,
    samplesPerCase: benchmarkConfig.PROMPT_BENCHMARK_SAMPLES,
    aggregate: {
      requestSuccessRate: totalSamples ? totalResponses / totalSamples : null,
      firstPassRateAmongResponses: totalResponses ? totalFirstPasses / totalResponses : null,
      qualityPassRateAmongStructuredOutputs: totalFirstPasses ? totalQualityPasses / totalFirstPasses : null,
    },
    cases,
  }

  console.log(JSON.stringify(result, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Prompt benchmark 执行失败')
  process.exitCode = 1
})
