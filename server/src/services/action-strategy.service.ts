import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { ActionStrategyOverview, ActionStrategyGenerateResult } from '@/types/action-strategy'
import type { AgentRunError } from '@/types/opportunity'
import type { ModelConnection } from '../schemas/model.schema'
import { modelConnectionSchema } from '../schemas/model.schema'
import { db } from '../db/client'
import { actionStrategySnapshots, agentRuns } from '../db/schema'
import { opportunityRepository } from '../repositories/opportunity.repository'
import { actionStrategyRepository } from '../repositories/action-strategy.repository'
import { dashboardRepository } from '../repositories/dashboard.repository'
import { getJobAnalysisListSummaries } from './job-analysis.service'
import { buildDashboardOverview } from './dashboard.service'
import { getCurrentUserId } from '../context/current-user'
import { collectHistoricalWeaknesses } from './interview/history-context'
import { ModelRequestError, normalizeBaseUrl, requestModelCompletion } from './ai/model-client'
import { parseActionStrategyModelOutput } from '../schemas/action-strategy.schema'
import type {
  ActionStrategyBuildResult,
  ActionStrategySnapshotRecord,
  StrategyOpportunityContext,
} from './action-strategy/types'
import {
  actionStrategyPromptVersion,
  actionStrategyRepairPromptVersion,
  buildActionStrategyRepairPrompt,
  buildActionStrategySystemPrompt,
  buildActionStrategyUserPrompt,
} from './action-strategy/prompt'
import { buildActionStrategy } from './action-strategy/engine'
import { withBackgroundTaskCapacity } from './background-task.service'

const maxAttempts = 3
const retryDelaysMs = [0, 1_000, 3_000]

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505',
  )
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function toAgentRunError(error: unknown): AgentRunError {
  if (error instanceof ModelRequestError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }
  }

  const message = error instanceof Error ? error.message : '行动策略生成失败'
  if (/行动策略模型输出|selectedActions|capabilityFocus|urgent|JSON/i.test(message)) {
    return { code: 'structured_output_validation_failed', message, retryable: true }
  }

  return { code: 'unknown', message, retryable: false }
}

async function buildCurrentStrategy(now = new Date()) {
  const userId = await getCurrentUserId()
  const opportunities = await opportunityRepository.findOpportunitiesByUserId(userId)
  const opportunityIds = opportunities.map((opportunity) => opportunity.id)

  const [activityByOpportunityId, analysisByOpportunityId, interviewEvidence, reviewSourceCounts] = await Promise.all([
    actionStrategyRepository.findActivityByOpportunityIds(opportunityIds),
    getJobAnalysisListSummaries(opportunityIds),
    dashboardRepository.findInterviewEvidenceByUserId(userId),
    dashboardRepository.findReviewSourceCountsByUserId(userId),
  ])

  const dashboard = buildDashboardOverview({
    opportunities,
    analysisByOpportunityId,
    interviewEvidence,
    reviewSourceCounts,
    generatedAt: now.toISOString(),
  })
  const historicalWeaknesses = collectHistoricalWeaknesses(interviewEvidence)
  const capabilities = dashboard.ability.weaknesses.map((item) => ({
    capabilityKey: item.capabilityKey,
    label: item.label,
    confidence: item.confidence,
    evidenceCount: item.evidenceCount,
    masteryScore: 55,
    sourceLabel: `模拟面试证据：${item.evidenceCount} 次，${item.confidence} 可信`,
    observedAt: item.lastObservedAt ?? now.toISOString(),
  }))

  const contexts: StrategyOpportunityContext[] = opportunities.map((opportunity) => {
    const activity = activityByOpportunityId.get(opportunity.id) ?? { statusHistory: [], interviewRounds: [] }
    const analysis = analysisByOpportunityId.get(opportunity.id)
    return {
      id: opportunity.id,
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      status: opportunity.status,
      intentionLevel: opportunity.intentionLevel,
      updatedAt: opportunity.updatedAt,
      writtenTestScheduledAt: opportunity.writtenTestScheduledAt,
      writtenTestReviewedAt: opportunity.writtenTestReviewedAt,
      analysis: analysis
        ? {
            status: analysis.status,
            matchScore: analysis.matchScore,
            resumeVersionId: null,
          }
        : null,
      statusHistory: activity.statusHistory,
      interviewRounds: activity.interviewRounds,
    }
  })

  return {
    userId,
    build: buildActionStrategy({
      opportunities: contexts,
      capabilities,
      historicalWeaknesses,
      now,
    }),
  }
}

function snapshotError(snapshot: ActionStrategySnapshotRecord | null) {
  if (!snapshot?.error) return null
  return { code: snapshot.error.code, message: snapshot.error.message }
}

function toOverview(
  build: ActionStrategyBuildResult,
  snapshot: ActionStrategySnapshotRecord | null,
): ActionStrategyOverview {
  const isCurrent = snapshot?.inputFingerprint === build.currentFingerprint
  const isActive = isCurrent && (snapshot?.status === 'pending' || snapshot?.status === 'processing')
  const isCompleted = isCurrent && snapshot?.status === 'completed'
  const isFailed = isCurrent && snapshot?.status === 'failed'

  return {
    generatedAt: build.generatedAt,
    currentFingerprint: build.currentFingerprint,
    sourceSummary: build.sourceSummary,
    actions: build.actions,
    capabilityActions: build.capabilityActions,
    ai: {
      freshness: isActive
        ? 'generating'
        : isCompleted
          ? 'fresh'
          : isFailed
            ? 'failed'
            : snapshot?.status === 'completed'
              ? 'stale'
              : 'not_generated',
      status: snapshot?.status ?? 'not_generated',
      snapshotId: snapshot?.id ?? null,
      modelName: snapshot?.modelName ?? null,
      generatedAt: snapshot?.completedAt ?? null,
      summary: snapshot?.result ?? null,
      error: isFailed ? snapshotError(snapshot) : null,
    },
  }
}

export async function getActionStrategyOverview(): Promise<ActionStrategyOverview> {
  const { build, userId } = await buildCurrentStrategy()
  const snapshot = await actionStrategyRepository.findLatestByUserId(userId)
  return toOverview(build, snapshot)
}

export async function getActionStrategySnapshotStatus(snapshotId: string) {
  const userId = await getCurrentUserId()
  const snapshot = await actionStrategyRepository.findById(snapshotId, userId)
  if (!snapshot) return null
  return {
    id: snapshot.id,
    status: snapshot.status,
    error: snapshot.error ? { code: snapshot.error.code, message: snapshot.error.message } : null,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt,
  }
}

function createSnapshotInput(userId: string, build: ActionStrategyBuildResult, modelConnection: ModelConnection) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId,
    status: 'pending' as const,
    inputFingerprint: build.currentFingerprint,
    modelName: modelConnection.modelName,
    modelBaseUrl: normalizeBaseUrl(modelConnection.baseUrl),
    promptVersion: actionStrategyPromptVersion,
    result: null,
    error: null,
    currentAttempt: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

async function executeActionStrategy(input: {
  snapshotId: string
  build: ActionStrategyBuildResult
  modelConnection: ModelConnection
}) {
  let repairIssues: string[] = []
  let previousRawOutput = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const runId = crypto.randomUUID()
    const queuedAt = new Date().toISOString()
    const promptVersion = attempt === 1 ? actionStrategyPromptVersion : actionStrategyRepairPromptVersion
    await db.insert(agentRuns).values({
      id: runId,
      workflowType: 'action_strategy',
      actionStrategySnapshotId: input.snapshotId,
      operationKey: `action_strategy:${input.snapshotId}`,
      attemptNumber: attempt,
      status: 'pending',
      modelName: input.modelConnection.modelName,
      promptVersion,
      input: input.build.runInput,
      startedAt: queuedAt,
    })

    const startedAt = new Date().toISOString()
    await db
      .update(agentRuns)
      .set({ status: 'processing', startedAt })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'pending')))
    if (attempt === 1) await actionStrategyRepository.markProcessing(input.snapshotId, attempt, startedAt)
    else
      await db
        .update(actionStrategySnapshots)
        .set({ currentAttempt: attempt, updatedAt: startedAt })
        .where(eq(actionStrategySnapshots.id, input.snapshotId))

    const startedAtMs = Date.now()
    let rawOutput: string | null = null
    let tokenUsage = null
    try {
      const userPrompt =
        attempt === 1
          ? buildActionStrategyUserPrompt(input.build.runInput)
          : buildActionStrategyRepairPrompt(input.build.runInput, repairIssues, previousRawOutput)
      const completion = await requestModelCompletion(
        `action_strategy:${input.snapshotId}`,
        input.modelConnection,
        buildActionStrategySystemPrompt(),
        userPrompt,
        { temperature: 0.1, maxTokens: 1800 },
      )
      rawOutput = completion.rawOutput
      previousRawOutput = completion.rawOutput
      tokenUsage = completion.tokenUsage
      const parsed = parseActionStrategyModelOutput(completion.rawOutput, input.build.runInput)
      const finishedAt = new Date().toISOString()

      await db
        .update(agentRuns)
        .set({
          status: 'completed',
          rawOutput,
          parsedOutput: parsed,
          tokenUsage,
          durationMs: Date.now() - startedAtMs,
          error: null,
          finishedAt,
        })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'processing')))
      await actionStrategyRepository.completeSnapshot({
        snapshotId: input.snapshotId,
        result: parsed,
        completedAt: finishedAt,
      })
      return
    } catch (error) {
      const runError = toAgentRunError(error)
      repairIssues = [error instanceof Error ? error.message : '结构化校验失败']
      await db
        .update(agentRuns)
        .set({
          status: 'failed',
          rawOutput,
          tokenUsage,
          durationMs: Date.now() - startedAtMs,
          error: runError,
          finishedAt: new Date().toISOString(),
        })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'processing')))

      if (!runError.retryable || attempt >= maxAttempts) {
        await actionStrategyRepository.failSnapshot({
          snapshotId: input.snapshotId,
          error: runError,
          updatedAt: new Date().toISOString(),
        })
        return
      }
      await delay(retryDelaysMs[attempt] ?? 0)
    }
  }
}

export async function generateActionStrategy(input: unknown): Promise<ActionStrategyGenerateResult> {
  const parsed = modelConnectionSchema.parse((input as { modelConnection?: unknown } | null)?.modelConnection)
  const { build, userId } = await buildCurrentStrategy()
  const normalizedBaseUrl = normalizeBaseUrl(parsed.baseUrl)
  const currentOverview = toOverview(build, await actionStrategyRepository.findLatestByUserId(userId))
  const activeSnapshot = await actionStrategyRepository.findActiveByUserId(userId)
  if (activeSnapshot?.inputFingerprint === build.currentFingerprint) {
    return { status: activeSnapshot.status, snapshotId: activeSnapshot.id, overview: currentOverview }
  }

  const cached = await actionStrategyRepository.findCompletedByFingerprint({
    userId,
    inputFingerprint: build.currentFingerprint,
    modelName: parsed.modelName,
    modelBaseUrl: normalizedBaseUrl,
    promptVersion: actionStrategyPromptVersion,
  })
  if (cached) {
    return { status: 'cached', snapshotId: cached.id, overview: toOverview(build, cached) }
  }

  let snapshot: ActionStrategySnapshotRecord
  try {
    snapshot = await withBackgroundTaskCapacity('action_strategy', () =>
      actionStrategyRepository.createSnapshot(createSnapshotInput(userId, build, parsed)),
    )
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await actionStrategyRepository.findActiveByUserId(userId)
    if (existing) return { status: existing.status, snapshotId: existing.id, overview: toOverview(build, existing) }
    throw error
  }

  void executeActionStrategy({ snapshotId: snapshot.id, build, modelConnection: parsed }).catch(async (error) => {
    await actionStrategyRepository.failSnapshot({
      snapshotId: snapshot.id,
      error: toAgentRunError(error),
      updatedAt: new Date().toISOString(),
    })
  })
  return { status: 'pending', snapshotId: snapshot.id, overview: toOverview(build, snapshot) }
}
