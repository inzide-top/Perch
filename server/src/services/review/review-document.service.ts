import type { AgentRunError } from '@/types/opportunity'
import type {
  ReviewDocumentKind,
  ReviewDocumentResult,
  ReviewDocumentStatus,
  ReviewDocumentSummary,
} from '@/types/review'
import type { ModelConnection } from '@server/schemas/model.schema'
import { agentRunRepository } from '../../repositories/agent-run.repository'
import {
  reviewDocumentRepository,
  type FailReviewDocumentRecord,
  type MarkReviewDocumentProcessingRecord,
} from '../../repositories/review-document.repository'
import { BackgroundTaskCapacityError, withBackgroundTaskCapacity } from '../background-task.service'
import { ModelRequestError } from '../ai/model-client'
import {
  extractReviewChunks,
  ReviewExtractionStructuredOutputError,
  type ReviewExtractionAttemptContext,
} from './review-extraction.service'
import { chunkReviewText } from './review-text-chunk'
import { getCurrentUserId } from '../../context/current-user'
import { opportunityRepository } from '../../repositories/opportunity.repository'

export const reviewExtractionPromptVersion = 'real-review-extraction.v1'

export class ReviewDocumentNotFoundError extends Error {
  readonly statusCode = 404

  constructor(documentId: string) {
    super(`Review document ${documentId} not found`)
    this.name = 'ReviewDocumentNotFoundError'
  }
}

type ReviewDocumentSource = {
  sourceType: 'written_test' | 'interview'
  interviewRoundId: string | null
}

type ReviewRunLifecycleState = {
  runId: string
  startedAtMs: number
}

type ReviewDocumentSummarySource = {
  id: string
  sourceType: ReviewDocumentKind
  interviewRoundId: string | null
  status: ReviewDocumentStatus
  revision: number
  currentAttempt: number
  modelName: string | null
  promptVersion: string | null
  result: ReviewDocumentResult | null
  error: AgentRunError | null
  updatedAt: string
  completedAt: string | null
}

function toReviewDocumentSummary(document: ReviewDocumentSummarySource): ReviewDocumentSummary {
  return {
    id: document.id,
    sourceType: document.sourceType,
    interviewRoundId: document.interviewRoundId,
    status: document.status,
    revision: document.revision,
    currentAttempt: document.currentAttempt,
    modelName: document.modelName,
    promptVersion: document.promptVersion,
    result: document.result,
    error: document.error
      ? {
          code: document.error.code,
          message: document.error.message,
          retryable: document.error.retryable,
        }
      : null,
    updatedAt: document.updatedAt,
    completedAt: document.completedAt,
  }
}

async function requireOwnedOpportunity(opportunityId: string) {
  const [userId, opportunity] = await Promise.all([
    getCurrentUserId(),
    opportunityRepository.findOpportunityById(opportunityId),
  ])

  if (!opportunity || opportunity.userId !== userId) {
    throw new ReviewDocumentNotFoundError(opportunityId)
  }

  return opportunity
}

function toAgentRunError(error: unknown): AgentRunError {
  if (error instanceof ReviewExtractionStructuredOutputError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      validationIssues: error.validationContext.validationIssues,
    }
  }

  if (error instanceof ModelRequestError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }
  }

  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : '真实复盘提取发生未知错误',
    retryable: false,
  }
}

function getRawOutput(error: unknown) {
  if (error instanceof ReviewExtractionStructuredOutputError) return error.rawOutput
  if (error instanceof ModelRequestError) return error.rawOutput
  return null
}

function getTokenUsage(error: unknown) {
  if (error instanceof ReviewExtractionStructuredOutputError) return error.tokenUsage
  if (error instanceof ModelRequestError) return error.tokenUsage
  return null
}

function createChunkOperationKey(documentId: string, revision: number, chunkId: string) {
  return `review_document:${documentId}:revision:${revision}:chunk:${chunkId}`
}

function buildRunInput(source: ReviewDocumentSource, context: ReviewExtractionAttemptContext) {
  return {
    sourceType: source.sourceType,
    chunk: {
      id: context.chunk.chunkId,
      index: context.chunk.index,
      text: context.chunk.text,
      startOffset: context.chunk.startOffset,
      endOffset: context.chunk.endOffset,
      hasPreviousContext: context.chunk.hasPreviousContext,
      hasNextContext: context.chunk.hasNextContext,
    },
  }
}

async function executeReviewDocumentExtraction(
  document: NonNullable<Awaited<ReturnType<typeof reviewDocumentRepository.findById>>>,
  modelConnection: ModelConnection,
) {
  const chunks = chunkReviewText(document.rawText)
  const operationKeyPrefix = `review_document:${document.id}:revision:${document.revision}`
  const runs = new Map<string, ReviewRunLifecycleState>()

  try {
    const extraction = await extractReviewChunks(operationKeyPrefix, modelConnection, chunks, {
      concurrency: 5,
      lifecycle: {
        onAttemptStarted: async (context) => {
          const operationKey = createChunkOperationKey(document.id, document.revision, context.chunk.chunkId)
          const attemptNumber = (await agentRunRepository.findLatestAttemptNumber(operationKey)) + 1
          const queuedAt = new Date().toISOString()
          const runId = crypto.randomUUID()

          await agentRunRepository.createReviewExtractionRun({
            id: runId,
            workflowType: 'review_extraction',
            analysisId: null,
            interviewSessionId: null,
            interviewTurnId: null,
            reviewDocumentId: document.id,
            operationKey,
            attemptNumber,
            status: 'pending',
            modelName: modelConnection.modelName,
            promptVersion: reviewExtractionPromptVersion,
            input: buildRunInput(document, context),
            rawOutput: null,
            parsedOutput: null,
            error: null,
            durationMs: null,
            tokenUsage: null,
            startedAt: queuedAt,
            finishedAt: null,
          })
          await agentRunRepository.markReviewExtractionRunProcessing(runId, queuedAt)
          runs.set(context.operationKey + ':' + context.attemptNumber, {
            runId,
            startedAtMs: Date.now(),
          })
        },
        onAttemptCompleted: async (context, result) => {
          const state = runs.get(context.operationKey + ':' + context.attemptNumber)
          if (!state) return

          const finishedAt = new Date().toISOString()
          await agentRunRepository.completeReviewExtractionRun({
            runId: state.runId,
            rawOutput: result.rawOutput,
            parsedOutput: { segments: result.segments },
            tokenUsage: result.tokenUsage,
            durationMs: Date.now() - state.startedAtMs,
            finishedAt,
          })
        },
        onAttemptFailed: async (context, error) => {
          const state = runs.get(context.operationKey + ':' + context.attemptNumber)
          if (!state) return

          const finishedAt = new Date().toISOString()
          await agentRunRepository.failReviewExtractionRun({
            runId: state.runId,
            error: toAgentRunError(error),
            rawOutput: getRawOutput(error),
            tokenUsage: getTokenUsage(error),
            durationMs: Date.now() - state.startedAtMs,
            finishedAt,
          })
        },
      },
    })

    await reviewDocumentRepository.complete({
      id: document.id,
      revision: document.revision,
      result: { segments: extraction.segments },
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const failRecord: FailReviewDocumentRecord = {
      id: document.id,
      revision: document.revision,
      error: toAgentRunError(error),
      finishedAt,
    }

    try {
      await reviewDocumentRepository.fail(failRecord)
    } catch (persistError) {
      console.error('Failed to persist review document failure', persistError)
    }
  }
}

export type QueueReviewDocumentInput = ReviewDocumentSource & {
  opportunityId: string
  rawText: string
  modelConnection: ModelConnection
}

/**
 * 保存原文后异步启动提取。该函数只负责短事务和入队，不等待模型完成。
 */
export async function queueReviewDocumentExtraction(input: QueueReviewDocumentInput) {
  const normalizedText = input.rawText.trim()
  if (!normalizedText) {
    await reviewDocumentRepository.deleteBySource(
      input.opportunityId,
      input.sourceType,
      input.interviewRoundId ?? undefined,
    )
    return null
  }

  const upserted = await reviewDocumentRepository.upsertPending({
    id: crypto.randomUUID(),
    opportunityId: input.opportunityId,
    sourceType: input.sourceType,
    interviewRoundId: input.interviewRoundId,
    rawText: normalizedText,
    updatedAt: new Date().toISOString(),
  })

  if (!upserted.shouldQueue) return upserted.document

  try {
    await withBackgroundTaskCapacity('review_extraction', async () => {
      const startedAt = new Date().toISOString()
      const processingRecord: MarkReviewDocumentProcessingRecord = {
        id: upserted.document.id,
        revision: upserted.document.revision,
        modelName: input.modelConnection.modelName,
        promptVersion: reviewExtractionPromptVersion,
        attemptNumber: upserted.document.currentAttempt + 1,
        startedAt,
      }
      const processingDocument = await reviewDocumentRepository.markProcessing(processingRecord)
      void executeReviewDocumentExtraction(processingDocument, input.modelConnection)
    })
  } catch (error) {
    if (!(error instanceof BackgroundTaskCapacityError)) throw error

    await reviewDocumentRepository.fail({
      id: upserted.document.id,
      revision: upserted.document.revision,
      error: {
        code: 'unknown',
        message: error.message,
        retryable: true,
      },
      finishedAt: new Date().toISOString(),
    })
  }

  return reviewDocumentRepository.findById(upserted.document.id)
}

export async function retryReviewDocumentExtraction(documentId: string, modelConnection: ModelConnection) {
  const document = await reviewDocumentRepository.retry(documentId, new Date().toISOString())
  if (!document) return null

  return queueReviewDocumentExtraction({
    opportunityId: document.opportunityId,
    sourceType: document.sourceType,
    interviewRoundId: document.interviewRoundId,
    rawText: document.rawText,
    modelConnection,
  })
}

export async function getReviewDocumentSummaries(opportunityId: string) {
  await requireOwnedOpportunity(opportunityId)

  const documents = await reviewDocumentRepository.findByOpportunityId(opportunityId)
  return documents.map(toReviewDocumentSummary)
}

export async function retryReviewDocumentForOpportunity(
  opportunityId: string,
  documentId: string,
  modelConnection: ModelConnection,
) {
  await requireOwnedOpportunity(opportunityId)
  const document = await reviewDocumentRepository.findById(documentId)

  if (!document || document.opportunityId !== opportunityId) {
    throw new ReviewDocumentNotFoundError(documentId)
  }

  const retried = await retryReviewDocumentExtraction(documentId, modelConnection)
  if (!retried) throw new ReviewDocumentNotFoundError(documentId)

  return toReviewDocumentSummary(retried)
}
