import { ZodError } from 'zod'
import type {
  AgentRunError,
  AgentTokenUsage,
  JobAnalysisResult,
  JobAnalysisRunInput,
  JobAnalysisTask,
} from '@/types/opportunity'
import { opportunityRepository } from '../repositories/opportunity.repository'
import { jobAnalysisRepository } from '../repositories/job-analysis.repository'
import { resumeRepository } from '../repositories/resume.repository'
import {
  jobAnalysisResultSchema,
  startJobAnalysisInputSchema,
  type StartJobAnalysisInput,
} from '../schemas/job-analysis.schema'
import { getCurrentUserId } from './resume.service'

const maxAnalysisAttempts = 3
const modelRequestTimeoutMs = 60_000
const jobAnalysisPromptVersion = 'job-analysis.v1'
const jobAnalysisRepairPromptVersion = 'job-analysis.v1.repair'

type ModelConnection = StartJobAnalysisInput['modelConnection']

type ModelCompletion = {
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
}

type AnalysisExecutionContext = {
  analysisId: string
  runId: string
  firstAttemptNumber: number
  resumeVersionId: string
  input: JobAnalysisRunInput
  modelConnection: ModelConnection
}

type ValidationRepairContext = {
  validationIssues: AgentRunError['validationIssues']
  invalidFieldValues: string
}

class JobAnalysisInputError extends Error {
  statusCode = 400
}

class JobAnalysisConflictError extends Error {
  statusCode = 409
}

export class JobAnalysisNotFoundError extends Error {
  statusCode = 404
}

class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly code: AgentRunError['code'],
    readonly retryable: boolean,
    readonly rawOutput: string | null = null,
    readonly tokenUsage: AgentTokenUsage | null = null,
  ) {
    super(message)
    this.name = 'ModelRequestError'
  }
}

function toJobAnalysisTask(analysis: {
  id: string
  opportunityId: string
  resumeId: string
  resumeVersionId: string
  status: JobAnalysisTask['status']
  result: JobAnalysisResult | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}): JobAnalysisTask {
  return {
    id: analysis.id,
    opportunityId: analysis.opportunityId,
    resumeId: analysis.resumeId,
    resumeVersionId: analysis.resumeVersionId,
    status: analysis.status,
    result: analysis.result,
    createdAt: new Date(analysis.createdAt).toISOString(),
    updatedAt: new Date(analysis.updatedAt).toISOString(),
    completedAt: analysis.completedAt ? new Date(analysis.completedAt).toISOString() : null,
  }
}

function createRunInput(input: {
  opportunityId: string
  resumeId: string
  resumeVersionId: string
  resume: JobAnalysisRunInput['resume']
  opportunity: JobAnalysisRunInput['opportunity']
}): JobAnalysisRunInput {
  return input
}

function createAgentRun(input: {
  id: string
  analysisId: string
  attemptNumber: number
  runInput: JobAnalysisRunInput
  modelName: string
  promptVersion: string
  createdAt: string
}) {
  return {
    id: input.id,
    analysisId: input.analysisId,
    attemptNumber: input.attemptNumber,
    status: 'pending' as const,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    input: input.runInput,
    startedAt: input.createdAt,
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')

  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function toTokenUsage(value: unknown): AgentTokenUsage | null {
  if (!value || typeof value !== 'object') return null

  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  const inputTokens = Number(usage.prompt_tokens)
  const outputTokens = Number(usage.completion_tokens)
  const totalTokens = Number(usage.total_tokens)

  if (![inputTokens, outputTokens, totalTokens].every(Number.isFinite)) return null

  return { inputTokens, outputTokens, totalTokens }
}

function getModelErrorDetails(status: number, body: string) {
  if (status === 429) {
    return { code: 'rate_limited' as const, retryable: true, message: '模型服务触发限流，请稍后重试' }
  }

  if (status >= 500) {
    return { code: 'model_request_failed' as const, retryable: true, message: '模型服务暂时不可用' }
  }

  return {
    code: 'model_request_failed' as const,
    retryable: false,
    message: body || `模型服务请求失败（HTTP ${status}）`,
  }
}

async function requestModelCompletion(
  modelConnection: ModelConnection,
  systemPrompt: string,
  userPrompt: string,
): Promise<ModelCompletion> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), modelRequestTimeoutMs)

  try {
    const response = await fetch(normalizeBaseUrl(modelConnection.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${modelConnection.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelConnection.modelName,
        temperature: 0.2,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    const rawResponse = await response.text()
    if (!response.ok) {
      const details = getModelErrorDetails(response.status, rawResponse)
      throw new ModelRequestError(details.message, details.code, details.retryable, rawResponse)
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawResponse)
    } catch {
      throw new ModelRequestError('模型服务返回了非 JSON 响应', 'model_request_failed', true, rawResponse)
    }

    const completion = payload as {
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: unknown
    }
    const rawOutput = completion.choices?.[0]?.message?.content

    if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
      throw new ModelRequestError('模型服务未返回可用内容', 'model_request_failed', true, rawResponse, toTokenUsage(completion.usage))
    }

    return {
      rawOutput: rawOutput.trim(),
      tokenUsage: toTokenUsage(completion.usage),
    }
  } catch (error) {
    if (error instanceof ModelRequestError) throw error

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ModelRequestError('模型请求超时', 'timeout', true)
    }

    throw new ModelRequestError(
      error instanceof Error ? error.message : '模型请求发生未知错误',
      'model_request_failed',
      true,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function buildSystemPrompt() {
  return `你是 PERCH 的 JD-简历匹配分析 Agent。请只基于输入中明确提供的 JD 和简历证据分析；没有证据时必须标记为 missing 或 partial，不能臆测候选人能力。

必须只返回一个完整、合法的 JSON 对象：不要 Markdown、不要代码块、不要解释文字。所有字段都必须存在，数组可为空。JSON 的字段骨架必须是：
{
  "matchScore": 0,
  "recommendation": "worth_trying",
  "summary": "",
  "locationMatch": { "resumeCities": [], "jobAddress": "", "isMatched": false, "impact": "minor", "reason": "" },
  "scoreBreakdown": [{ "key": "core_requirements", "label": "", "weight": 0, "score": 0, "reason": "", "evidenceFromJD": "", "evidenceFromResume": "" }],
  "requirementMatches": [{ "requirement": "", "requiredLevel": "proficient", "resumeEvidence": "", "candidateLevel": "familiar", "matchStatus": "partial", "importance": "must_have", "risk": "medium", "suggestion": "" }],
  "strengths": [{ "title": "", "evidenceFromJD": "", "evidenceFromResume": "", "level": "low", "reason": "" }],
  "gaps": [{ "title": "", "evidenceFromJD": "", "evidenceFromResume": "", "level": "high", "reason": "" }],
  "resumeSuggestions": [{ "targetSection": "skills", "title": "", "reason": "", "priority": "medium", "relatedJDText": "" }],
  "interviewFocus": [{ "topic": "", "reason": "", "difficulty": "medium" }]
}

scoreBreakdown 必须且只能包含下列六个固定 key 各一次；它们在任何行业、岗位中均适用，weight 必须依据该 JD 动态分配且总和恰好为 100：
1. core_requirements：岗位明确的核心专业能力或资格
2. related_experience：与岗位任务直接相关的项目、工作或实践经验
3. seniority_depth：职责复杂度、独立性、影响范围、交付深度或成熟度
4. business_context：行业、业务场景、目标用户或可迁移的领域经验
5. bonus_points：JD 的加分项、偏好项或非核心差异化能力
6. job_constraints：城市、到岗形式、身份、语言、证书等岗位约束；城市只作轻量参考

locationMatch.impact 固定为 "minor"。matchScore、每个 score 都是 0 到 100 的数字。recommendation 只能是 strong_match、worth_trying、risky、not_recommended。`
}

function buildInitialUserPrompt(input: JobAnalysisRunInput) {
  return `请分析以下岗位与候选人简历，并返回完整 JSON。\n\nJD：\n${JSON.stringify(input.opportunity, null, 2)}\n\n简历：\n${JSON.stringify(input.resume, null, 2)}`
}

function getValueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined

    return (current as Record<string | number, unknown>)[key]
  }, value)
}

function createValidationRepairContext(rawOutput: string, error: ZodError): ValidationRepairContext {
  let parsedOutput: unknown = rawOutput

  try {
    parsedOutput = JSON.parse(rawOutput)
  } catch {
    // 非法 JSON 没有可定位字段，直接把原始片段作为修复参考。
  }

  const validationIssues = error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)),
    code: issue.code,
    message: issue.message,
  }))
  const invalidFieldValues = validationIssues.map((issue) => ({
    path: issue.path,
    value: getValueAtPath(parsedOutput, issue.path),
  }))

  return {
    validationIssues,
    invalidFieldValues: JSON.stringify(invalidFieldValues).slice(0, 8_000),
  }
}

function buildRepairUserPrompt(input: JobAnalysisRunInput, repairContext: ValidationRepairContext) {
  return `${buildInitialUserPrompt(input)}\n\n你上一次输出未通过结构化校验。\n\n必须只返回一个完整、合法的 JSON 对象：\n- 不要 Markdown\n- 不要代码块\n- 不要解释文字\n- 不要只返回修复字段\n- 必须保留所有既定字段\n- scoreBreakdown 必须包含六个固定维度各一次，weight 总和必须为 100\n\n以下字段未通过校验：\n${JSON.stringify(repairContext.validationIssues)}\n\n这些字段在上一版输出中的原始值：\n${repairContext.invalidFieldValues}\n\n请在保留正确分析语义的前提下，修复上述字段，并重新输出完整 JSON。`
}

function toValidationError(rawOutput: string, error: ZodError): AgentRunError {
  const repairContext = createValidationRepairContext(rawOutput, error)

  return {
    code: 'structured_output_validation_failed',
    message: '模型输出未通过 JobAnalysis Zod 校验',
    retryable: true,
    validationIssues: repairContext.validationIssues,
  }
}

async function executeJobAnalysis(context: AnalysisExecutionContext) {
  let runId = context.runId
  let attemptNumber = context.firstAttemptNumber
  let repairContext: ValidationRepairContext | null = null

  for (let localAttempt = 1; localAttempt <= maxAnalysisAttempts; localAttempt += 1) {
    const startedAt = new Date().toISOString()

    if (localAttempt === 1) {
      await jobAnalysisRepository.markRunProcessing({ analysisId: context.analysisId, runId, startedAt })
    } else {
      await jobAnalysisRepository.markRetryRunProcessing({ analysisId: context.analysisId, runId, startedAt })
    }

    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null

    try {
      const completion = await requestModelCompletion(
        context.modelConnection,
        buildSystemPrompt(),
        repairContext ? buildRepairUserPrompt(context.input, repairContext) : buildInitialUserPrompt(context.input),
      )
      rawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage

      let rawJson: unknown
      try {
        rawJson = JSON.parse(rawOutput)
      } catch {
        throw new ModelRequestError('模型输出不是合法 JSON', 'structured_output_validation_failed', true, rawOutput, tokenUsage)
      }

      const parsedResult = jobAnalysisResultSchema.safeParse(rawJson)
      if (!parsedResult.success) {
        const validationError = toValidationError(rawOutput, parsedResult.error)
        repairContext = createValidationRepairContext(rawOutput, parsedResult.error)
        throw new ModelRequestError(
          validationError.message,
          validationError.code,
          validationError.retryable,
          rawOutput,
          tokenUsage,
        )
      }

      const finishedAt = new Date().toISOString()
      return jobAnalysisRepository.completeRunAndAnalysis({
        analysisId: context.analysisId,
        runId,
        resumeVersionId: context.resumeVersionId,
        result: parsedResult.data,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const runError: AgentRunError =
        error instanceof ModelRequestError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              validationIssues:
                error.code === 'structured_output_validation_failed' && repairContext
                  ? repairContext.validationIssues
                  : undefined,
            }
          : {
              code: 'unknown',
              message: error instanceof Error ? error.message : 'JD 分析发生未知错误',
              retryable: false,
            }

      await jobAnalysisRepository.failRun({
        analysisId: context.analysisId,
        runId,
        error: runError,
        rawOutput: error instanceof ModelRequestError ? error.rawOutput ?? rawOutput : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? error.tokenUsage ?? tokenUsage : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })

      const canRetry = runError.retryable && localAttempt < maxAnalysisAttempts
      if (!canRetry) {
        return jobAnalysisRepository.markAnalysisFailed({ analysisId: context.analysisId, failedAt: finishedAt })
      }

      attemptNumber += 1
      runId = crypto.randomUUID()
      await jobAnalysisRepository.createRetryRun(
        createAgentRun({
          id: runId,
          analysisId: context.analysisId,
          attemptNumber,
          runInput: context.input,
          modelName: context.modelConnection.modelName,
          promptVersion: jobAnalysisRepairPromptVersion,
          createdAt: finishedAt,
        }),
      )
    }
  }
}

async function getAnalysisInputs(opportunityId: string, input: StartJobAnalysisInput) {
  const [userId, opportunity, resume, resumeVersion] = await Promise.all([
    getCurrentUserId(),
    opportunityRepository.findOpportunityById(opportunityId),
    resumeRepository.findResumeById(input.resumeId),
    resumeRepository.findVersionById(input.resumeVersionId),
  ])

  if (!opportunity || opportunity.userId !== userId) throw new JobAnalysisNotFoundError('岗位机会不存在')
  if (!resume || resume.userId !== userId) throw new JobAnalysisNotFoundError('简历不存在')
  if (!resumeVersion || resumeVersion.resumeId !== resume.id) {
    throw new JobAnalysisInputError('简历版本不属于当前简历')
  }

  return {
    runInput: createRunInput({
      opportunityId: opportunity.id,
      resumeId: resume.id,
      resumeVersionId: resumeVersion.id,
      resume: resumeVersion.content,
      opportunity: {
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        address: opportunity.address,
        introduction: opportunity.introduction,
        description: opportunity.description,
      },
    }),
    resume,
    resumeVersion,
  }
}

export async function startJobAnalysis(opportunityId: string, input: unknown): Promise<JobAnalysisTask> {
  const parsedInput = startJobAnalysisInputSchema.parse(input)
  const { runInput, resume, resumeVersion } = await getAnalysisInputs(opportunityId, parsedInput)
  const existingAnalysis = await jobAnalysisRepository.findAnalysisByOpportunityId(opportunityId)

  if (existingAnalysis?.status === 'pending' || existingAnalysis?.status === 'processing') {
    throw new JobAnalysisConflictError('该 JD 正在分析中，请等待当前任务完成')
  }

  const now = new Date().toISOString()
  const existingRuns = existingAnalysis ? await jobAnalysisRepository.findRunsByAnalysisId(existingAnalysis.id) : []
  const firstAttemptNumber = (existingRuns[0]?.attemptNumber ?? 0) + 1
  const analysisId = existingAnalysis?.id ?? crypto.randomUUID()
  const runId = crypto.randomUUID()
  const run = createAgentRun({
    id: runId,
    analysisId,
    attemptNumber: firstAttemptNumber,
    runInput,
    modelName: parsedInput.modelConnection.modelName,
    promptVersion: jobAnalysisPromptVersion,
    createdAt: now,
  })

  const queued = existingAnalysis
    ? await jobAnalysisRepository.queueExistingAnalysisWithRun({
        analysisId,
        resumeId: resume.id,
        resumeVersionId: resumeVersion.id,
        queuedAt: now,
        run,
      })
    : await jobAnalysisRepository.createAnalysisWithInitialRun({
        analysis: {
          id: analysisId,
          opportunityId,
          resumeId: resume.id,
          resumeVersionId: resumeVersion.id,
          status: 'pending',
          result: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
        run,
      })

  void executeJobAnalysis({
    analysisId: queued.analysis.id,
    runId: queued.run.id,
    firstAttemptNumber,
    resumeVersionId: resumeVersion.id,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
  }).catch((error: unknown) => {
    console.error('Job analysis background execution crashed', {
      analysisId: queued.analysis.id,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  })

  return toJobAnalysisTask(queued.analysis)
}

export async function getJobAnalysis(opportunityId: string): Promise<JobAnalysisTask | null> {
  const opportunity = await opportunityRepository.findOpportunityById(opportunityId)
  const userId = await getCurrentUserId()
  if (!opportunity || opportunity.userId !== userId) throw new JobAnalysisNotFoundError('岗位机会不存在')

  const analysis = await jobAnalysisRepository.findAnalysisByOpportunityId(opportunityId)

  return analysis ? toJobAnalysisTask(analysis) : null
}
