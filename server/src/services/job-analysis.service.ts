import { createHash } from 'node:crypto'
import type {
  AgentRunError,
  AgentTokenUsage,
  JobAnalysisListSummary,
  JobAnalysisProgress,
  JobAnalysisResult,
  JobAnalysisRunInput,
} from '@/types/opportunity'
import { opportunityRepository } from '../repositories/opportunity.repository'
import { jobAnalysisRepository } from '../repositories/job-analysis.repository'
import { resumeRepository } from '../repositories/resume.repository'
import {
  jobAnalysisResultSchema,
  startJobAnalysisInputSchema,
  type StartJobAnalysisInput,
} from '../schemas/job-analysis.schema'
import { getCurrentUserId } from '../context/current-user'
import { getRecommendationFromScore, getScoreDimensionLabel } from '@/shared/opportunity/analysisPresentation'
import {
  cancelJobAnalysisForOpportunity,
  isJobAnalysisCancelled,
  ModelRequestError,
  modelRequestTimeoutGraceMs,
  modelRequestTimeoutMs,
  normalizeBaseUrl,
  requestModelCompletion,
  type ModelConnection,
} from './ai/model-client'
import {
  buildInitialUserPrompt,
  buildRepairUserPrompt,
  buildSystemPrompt,
  createJsonSyntaxRepairContext,
  createValidationRepairContext,
  parseModelOutputJson,
  toValidationError,
  type ValidationRepairContext,
} from './job-analysis/prompt'
import { withBackgroundTaskCapacity } from './background-task.service'

const maxAnalysisAttempts = 3
const retryDelaysMs = [0, 2_000, 5_000]
const jobAnalysisPromptVersion = 'job-analysis.v3'
const jobAnalysisRepairPromptVersion = 'job-analysis.v3.repair'
const jobAnalysisScoringPolicyVersion = 'job-analysis-score.v2'
type AnalysisExecutionContext = {
  opportunityId: string
  analysisId: string
  runId: string
  firstAttemptNumber: number
  resumeVersionId: string
  input: JobAnalysisRunInput
  modelConnection: ModelConnection
}

class JobAnalysisInputError extends Error {
  statusCode = 400
}

class JobAnalysisConflictError extends Error {
  statusCode = 409
}

type AnalysisProgressSource = {
  id: string
  opportunityId: string
  status: JobAnalysisProgress['status']
  sourceAnalysisId: string | null
  currentAttempt: number
  modelName: string | null
  result: JobAnalysisResult | null
  matchScore?: number | null
  recommendation?: JobAnalysisResult['recommendation'] | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type AnalysisProgressRow = Omit<AnalysisProgressSource, 'result' | 'matchScore' | 'recommendation'> & {
  result?: never
  matchScore: string | null
  recommendation: string | null
}

export class JobAnalysisNotFoundError extends Error {
  statusCode = 404
}

export { cancelJobAnalysisForOpportunity }

function toJobAnalysisProgress(
  analysis: {
    status: JobAnalysisProgress['status']
    currentAttempt: number
    createdAt: string
    updatedAt: string
    modelName: string | null
    result: JobAnalysisResult | null
    matchScore?: number | null
    recommendation?: JobAnalysisResult['recommendation'] | null
  },
  currentRun: {
    attemptNumber: number
    error: AgentRunError | null
  } | null,
): JobAnalysisProgress {
  const matchScore = analysis.result?.matchScore ?? analysis.matchScore ?? null
  const recommendation =
    analysis.result?.recommendation ??
    analysis.recommendation ??
    (matchScore === null ? null : getRecommendationFromScore(matchScore))

  return {
    status: analysis.status,
    currentAttempt: analysis.currentAttempt,
    maxAttempts: maxAnalysisAttempts,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    modelName: analysis.status === 'completed' ? analysis.modelName : null,
    matchScore,
    recommendation,
    result: analysis.result,
    error:
      analysis.status === 'failed' && currentRun?.error
        ? {
            code: currentRun.error.code,
            message: currentRun.error.message,
          }
        : null,
  }
}

function toAnalysisProgressSource(row: AnalysisProgressRow): AnalysisProgressSource {
  const parsedMatchScore = row.matchScore === null ? null : Number(row.matchScore)
  const matchScore = parsedMatchScore !== null && Number.isFinite(parsedMatchScore) ? parsedMatchScore : null
  const validRecommendations = ['strong_match', 'worth_trying', 'risky', 'not_recommended'] as const
  const recommendation = validRecommendations.includes(row.recommendation as (typeof validRecommendations)[number])
    ? (row.recommendation as JobAnalysisResult['recommendation'])
    : null

  return {
    ...row,
    result: null,
    matchScore,
    recommendation,
  }
}

export async function getJobAnalysisListSummaries(
  opportunityIds: string[],
): Promise<Map<string, JobAnalysisListSummary>> {
  const analyses = (await jobAnalysisRepository.findAnalysisProgressByOpportunityIds(opportunityIds)).map(
    toAnalysisProgressSource,
  )
  const effectiveAnalyses = await resolveEffectiveAnalyses(analyses, (ids) =>
    jobAnalysisRepository.findAnalysisProgressByIds(ids).then((items) => items.map(toAnalysisProgressSource)),
  )
  const runs = await jobAnalysisRepository.findRunSummariesByAnalysisIds([
    ...new Set(effectiveAnalyses.map((analysis) => analysis.id)),
  ])
  const currentRunByAnalysisId = new Map<string, (typeof runs)[number]>()

  for (const run of runs) {
    if (!run.analysisId) continue
    if (!currentRunByAnalysisId.has(run.analysisId)) currentRunByAnalysisId.set(run.analysisId, run)
  }

  return new Map(
    analyses.map((analysis, index) => {
      const effectiveAnalysis = effectiveAnalyses[index]
      const { result: _, ...summary } = toJobAnalysisProgress(
        effectiveAnalysis,
        currentRunByAnalysisId.get(effectiveAnalysis.id) ?? null,
      )

      return [analysis.opportunityId, summary]
    }),
  )
}

/** follower 分析没有自己的模型 Run，读取时统一解析为它依附的源分析。 */
async function resolveEffectiveAnalyses<T extends { id: string; sourceAnalysisId: string | null }>(
  analyses: T[],
  loadSources: (ids: string[]) => Promise<T[]> = (ids) => jobAnalysisRepository.findAnalysesByIds(ids) as Promise<T[]>,
) {
  const sourceIds = [
    ...new Set(analyses.flatMap((analysis) => (analysis.sourceAnalysisId ? [analysis.sourceAnalysisId] : []))),
  ]
  const sources = await loadSources(sourceIds)
  const sourceById = new Map(sources.map((analysis) => [analysis.id, analysis]))

  return analyses.map((analysis) =>
    analysis.sourceAnalysisId ? (sourceById.get(analysis.sourceAnalysisId) ?? analysis) : analysis,
  )
}

function createRunInput(input: JobAnalysisRunInput): JobAnalysisRunInput {
  return {
    opportunity: input.opportunity,
    resume: input.resume,
  }
}

/**
 * 自动复用只认规范化后完全相同的业务输入。公司别名与疑似拼写错误以后只做重复提示，
 * 不自动合并，避免误把不同岗位当作同一条 JD。
 */
function normalizeFingerprintText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function createAnalysisInputFingerprint(input: {
  resumeVersionId: string
  runInput: JobAnalysisRunInput
  modelConnection: ModelConnection
}) {
  const source = {
    resumeVersionId: input.resumeVersionId,
    opportunity: {
      company: normalizeFingerprintText(input.runInput.opportunity.company),
      jobTitle: normalizeFingerprintText(input.runInput.opportunity.jobTitle),
      address: [...(input.runInput.opportunity.address ?? [])].map(normalizeFingerprintText).sort(),
      introduction: normalizeFingerprintText(input.runInput.opportunity.introduction),
      description: normalizeFingerprintText(input.runInput.opportunity.description),
    },
    promptVersion: jobAnalysisPromptVersion,
    scoringPolicyVersion: jobAnalysisScoringPolicyVersion,
    model: {
      baseUrl: normalizeBaseUrl(input.modelConnection.baseUrl).toLocaleLowerCase('en-US'),
      modelName: input.modelConnection.modelName.trim(),
    },
  }

  return createHash('sha256').update(JSON.stringify(source)).digest('hex')
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
    workflowType: 'job_analysis' as const,
    analysisId: input.analysisId,
    operationKey: `job_analysis:${input.analysisId}`,
    attemptNumber: input.attemptNumber,
    status: 'pending' as const,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    input: input.runInput,
    startedAt: input.createdAt,
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505',
  )
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * 评分是唯一的匹配结论来源。模型可先给出 recommendation 以满足结构化骨架，
 * 但持久化前必须由服务端按统一阈值重算，避免同分出现不同投递结论。
 */
function normalizeJobAnalysisResult(result: JobAnalysisResult): JobAnalysisResult {
  const calculatedScore = Math.round(
    result.scoreBreakdown.reduce((total, item) => total + (item.score * item.weight) / 100, 0),
  )

  return {
    ...result,
    matchScore: calculatedScore,
    recommendation: getRecommendationFromScore(calculatedScore),
    scoreBreakdown: result.scoreBreakdown.map((item) => ({
      ...item,
      label: getScoreDimensionLabel(item.key),
    })),
  }
}

async function executeJobAnalysis(context: AnalysisExecutionContext) {
  let runId = context.runId
  let attemptNumber = context.firstAttemptNumber
  let repairContext: ValidationRepairContext | null = null

  for (let localAttempt = 1; localAttempt <= maxAnalysisAttempts; localAttempt += 1) {
    if (isJobAnalysisCancelled(context.opportunityId)) return

    const startedAt = new Date().toISOString()

    try {
      if (localAttempt === 1) {
        await jobAnalysisRepository.markRunProcessing({ analysisId: context.analysisId, runId, startedAt })
      } else {
        await jobAnalysisRepository.markRetryRunProcessing({ analysisId: context.analysisId, runId, startedAt })
      }
    } catch (error) {
      if (isJobAnalysisCancelled(context.opportunityId)) return

      throw error
    }

    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage: AgentTokenUsage | null = null

    try {
      const completion = await requestModelCompletion(
        context.opportunityId,
        context.modelConnection,
        buildSystemPrompt(),
        repairContext ? buildRepairUserPrompt(context.input, repairContext) : buildInitialUserPrompt(context.input),
      )
      if (isJobAnalysisCancelled(context.opportunityId)) return

      rawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage

      let rawJson: unknown
      try {
        rawJson = parseModelOutputJson(rawOutput)
      } catch (error) {
        repairContext = createJsonSyntaxRepairContext(rawOutput, error)
        throw new ModelRequestError(
          '模型输出不是合法 JSON',
          'structured_output_validation_failed',
          true,
          rawOutput,
          tokenUsage,
        )
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

      const result = normalizeJobAnalysisResult(parsedResult.data)
      const finishedAt = new Date().toISOString()
      return jobAnalysisRepository.completeRunAndAnalysis({
        analysisId: context.analysisId,
        runId,
        resumeVersionId: context.resumeVersionId,
        modelName: context.modelConnection.modelName,
        result,
        rawOutput,
        tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })
    } catch (error) {
      if (isJobAnalysisCancelled(context.opportunityId)) return

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
        rawOutput: error instanceof ModelRequestError ? (error.rawOutput ?? rawOutput) : rawOutput,
        tokenUsage: error instanceof ModelRequestError ? (error.tokenUsage ?? tokenUsage) : tokenUsage,
        durationMs: Date.now() - startedAtMs,
        finishedAt,
      })

      const canRetry = runError.retryable && localAttempt < maxAnalysisAttempts
      if (!canRetry) {
        return jobAnalysisRepository.markAnalysisFailed({ analysisId: context.analysisId, failedAt: finishedAt })
      }

      if (isJobAnalysisCancelled(context.opportunityId)) return

      await delay(retryDelaysMs[localAttempt] ?? 0)
      if (isJobAnalysisCancelled(context.opportunityId)) return

      attemptNumber += 1
      runId = crypto.randomUUID()
      await jobAnalysisRepository.queueRetryRun({
        analysisId: context.analysisId,
        currentAttempt: localAttempt + 1,
        queuedAt: new Date().toISOString(),
        run: createAgentRun({
          id: runId,
          analysisId: context.analysisId,
          attemptNumber,
          runInput: context.input,
          modelName: context.modelConnection.modelName,
          promptVersion: jobAnalysisRepairPromptVersion,
          createdAt: finishedAt,
        }),
      })
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

export async function startJobAnalysis(opportunityId: string, input: unknown): Promise<JobAnalysisProgress> {
  const parsedInput = startJobAnalysisInputSchema.parse(input)
  const { runInput, resume, resumeVersion } = await getAnalysisInputs(opportunityId, parsedInput)
  if (isJobAnalysisCancelled(opportunityId)) throw new JobAnalysisNotFoundError('岗位机会不存在')

  const existingAnalysis = await jobAnalysisRepository.findAnalysisByOpportunityId(opportunityId)

  if (existingAnalysis?.status === 'pending' || existingAnalysis?.status === 'processing') {
    throw new JobAnalysisConflictError('该 JD 正在分析中，请等待当前任务完成')
  }

  const now = new Date().toISOString()
  const inputFingerprint = createAnalysisInputFingerprint({
    resumeVersionId: resumeVersion.id,
    runInput,
    modelConnection: parsedInput.modelConnection,
  })

  const activeSource = await jobAnalysisRepository.findActiveSourceAnalysisByInputFingerprint(inputFingerprint)
  if (activeSource) {
    if (parsedInput.force) {
      throw new JobAnalysisConflictError('相同输入的 JD 正在强制分析中，请等待当前任务完成')
    }

    await jobAnalysisRepository.linkAnalysisToSource({
      id: existingAnalysis?.id ?? crypto.randomUUID(),
      opportunityId,
      resumeId: resume.id,
      resumeVersionId: resumeVersion.id,
      sourceAnalysis: activeSource,
      linkedAt: now,
    })
    const [currentRun] = await jobAnalysisRepository.findRunsByAnalysisId(activeSource.id)

    return toJobAnalysisProgress(activeSource, currentRun ?? null)
  }

  if (!parsedInput.force) {
    const cachedAnalysis = await jobAnalysisRepository.findCompletedAnalysisByInputFingerprint(inputFingerprint)

    if (cachedAnalysis?.result) {
      const analysis = existingAnalysis
        ? await jobAnalysisRepository.updateExistingAnalysisFromCache({
            analysisId: existingAnalysis.id,
            resumeId: resume.id,
            resumeVersionId: resumeVersion.id,
            inputFingerprint,
            modelName: cachedAnalysis.modelName,
            sourceAnalysisId: cachedAnalysis.id,
            result: cachedAnalysis.result,
            completedAt: now,
          })
        : await jobAnalysisRepository.createCompletedAnalysisFromCache({
            id: crypto.randomUUID(),
            opportunityId,
            resumeId: resume.id,
            resumeVersionId: resumeVersion.id,
            status: 'completed',
            currentAttempt: 0,
            inputFingerprint,
            sourceAnalysisId: cachedAnalysis.id,
            modelName: cachedAnalysis.modelName,
            result: cachedAnalysis.result,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          })

      return toJobAnalysisProgress(analysis, null)
    }
  }

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

  let queued: Awaited<ReturnType<typeof jobAnalysisRepository.createAnalysisWithInitialRun>>
  try {
    queued = await withBackgroundTaskCapacity('job_analysis', async () =>
      existingAnalysis
        ? jobAnalysisRepository.queueExistingAnalysisWithRun({
            analysisId,
            resumeId: resume.id,
            resumeVersionId: resumeVersion.id,
            inputFingerprint,
            queuedAt: now,
            run,
          })
        : jobAnalysisRepository.createAnalysisWithInitialRun({
            analysis: {
              id: analysisId,
              opportunityId,
              resumeId: resume.id,
              resumeVersionId: resumeVersion.id,
              sourceAnalysisId: null,
              status: 'pending',
              currentAttempt: 1,
              inputFingerprint,
              modelName: null,
              result: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
            run,
          }),
    )
  } catch (error) {
    // 两个完全相同的请求同时抵达时，数据库唯一约束只允许一个源任务入队；另一个改为 follower。
    if (isUniqueViolation(error)) {
      const activeSource = await jobAnalysisRepository.findActiveSourceAnalysisByInputFingerprint(inputFingerprint)
      if (activeSource) {
        if (parsedInput.force) {
          throw new JobAnalysisConflictError('相同输入的 JD 正在强制分析中，请等待当前任务完成')
        }
        const linkedAnalysis = await jobAnalysisRepository.linkAnalysisToSource({
          id: existingAnalysis?.id ?? analysisId,
          opportunityId,
          resumeId: resume.id,
          resumeVersionId: resumeVersion.id,
          sourceAnalysis: activeSource,
          linkedAt: now,
        })
        const [currentRun] = await jobAnalysisRepository.findRunsByAnalysisId(activeSource.id)

        return toJobAnalysisProgress(linkedAnalysis, currentRun ?? null)
      }
    }

    throw error
  }

  void executeJobAnalysis({
    opportunityId,
    analysisId: queued.analysis.id,
    runId: queued.run.id,
    firstAttemptNumber,
    resumeVersionId: resumeVersion.id,
    input: runInput,
    modelConnection: parsedInput.modelConnection,
  }).catch((error: unknown) => {
    if (isJobAnalysisCancelled(opportunityId)) return

    const failedAt = new Date().toISOString()

    void jobAnalysisRepository
      .markAnalysisFailedIfActive({ analysisId: queued.analysis.id, failedAt })
      .catch((markError) => {
        console.error('Job analysis crash recovery failed', {
          analysisId: queued.analysis.id,
          message: markError instanceof Error ? markError.message : 'unknown error',
        })
      })

    console.error('Job analysis background execution crashed', {
      analysisId: queued.analysis.id,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  })

  return toJobAnalysisProgress(queued.analysis, queued.run)
}

/**
 * 同一个读取接口同时服务详情页和轮询：一个 opportunityId 就是一个元素，多个也是同一形状。
 * includeResult 为 false 时仅保留轻量任务状态，避免列表轮询携带完整分析 JSON。
 */
export async function getJobAnalyses(
  opportunityIds: string[],
  options: { includeResult?: boolean } = {},
): Promise<Array<{ opportunityId: string; analysis: JobAnalysisProgress | null }>> {
  const userId = await getCurrentUserId()
  const ownedOpportunityIds = new Set(await opportunityRepository.findOwnedOpportunityIds(opportunityIds, userId))

  if (opportunityIds.some((opportunityId) => !ownedOpportunityIds.has(opportunityId))) {
    throw new JobAnalysisNotFoundError('岗位机会不存在')
  }

  const includeResult = options.includeResult === true
  const analyses = (
    includeResult
      ? await jobAnalysisRepository.findAnalysesByOpportunityIds(opportunityIds)
      : (await jobAnalysisRepository.findAnalysisProgressByOpportunityIds(opportunityIds)).map(toAnalysisProgressSource)
  ) as AnalysisProgressSource[]
  const effectiveAnalyses = await resolveEffectiveAnalyses(
    analyses,
    includeResult
      ? undefined
      : (ids) =>
          jobAnalysisRepository.findAnalysisProgressByIds(ids).then((items) => items.map(toAnalysisProgressSource)),
  )
  const runs = includeResult
    ? await jobAnalysisRepository.findRunsByAnalysisIds([...new Set(effectiveAnalyses.map((analysis) => analysis.id))])
    : await jobAnalysisRepository.findRunSummariesByAnalysisIds([
        ...new Set(effectiveAnalyses.map((analysis) => analysis.id)),
      ])
  const currentRunByAnalysisId = new Map<string, (typeof runs)[number]>()
  const analysisByOpportunityId = new Map(analyses.map((analysis) => [analysis.opportunityId, analysis]))

  for (const run of runs) {
    if (!run.analysisId) continue
    if (!currentRunByAnalysisId.has(run.analysisId)) currentRunByAnalysisId.set(run.analysisId, run)
  }

  const progressByOpportunityId = new Map<string, JobAnalysisProgress>()
  const recoveredByAnalysisId = new Map<
    string,
    Awaited<ReturnType<typeof jobAnalysisRepository.failStuckRunAndAnalysis>>
  >()
  for (const [index, analysis] of analyses.entries()) {
    const effectiveAnalysis = effectiveAnalyses[index]
    const currentRun = currentRunByAnalysisId.get(effectiveAnalysis.id) ?? null
    const elapsedMs = currentRun ? Date.now() - Date.parse(currentRun.startedAt) : 0
    let recovered = recoveredByAnalysisId.get(effectiveAnalysis.id)
    if (
      !recoveredByAnalysisId.has(effectiveAnalysis.id) &&
      effectiveAnalysis.status === 'processing' &&
      currentRun?.status === 'processing' &&
      elapsedMs > modelRequestTimeoutMs + modelRequestTimeoutGraceMs
    ) {
      recovered = await jobAnalysisRepository.failStuckRunAndAnalysis({
        analysisId: effectiveAnalysis.id,
        runId: currentRun.id,
        error: {
          code: 'timeout',
          message: '模型请求超过超时时间仍未结束，已终止分析',
          retryable: false,
        },
        durationMs: elapsedMs,
        failedAt: new Date().toISOString(),
      })
      recoveredByAnalysisId.set(effectiveAnalysis.id, recovered)
    }
    const progress = recovered
      ? toJobAnalysisProgress(recovered.analysis, recovered.run)
      : toJobAnalysisProgress(effectiveAnalysis, currentRun)
    progressByOpportunityId.set(analysis.opportunityId, includeResult ? progress : { ...progress, result: null })
  }

  return opportunityIds.map((opportunityId) => ({
    opportunityId,
    analysis: analysisByOpportunityId.has(opportunityId) ? (progressByOpportunityId.get(opportunityId) ?? null) : null,
  }))
}
