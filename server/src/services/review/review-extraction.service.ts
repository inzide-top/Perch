import type { AgentTokenUsage } from '@/types/opportunity'
import {
  createJsonSyntaxRepairContext,
  createValidationRepairContext,
  type ValidationRepairContext,
} from '../../utils/model-validation'
import { parseModelOutputJson } from '../../utils/model-output'
import { ModelRequestError, requestModelCompletion, type ModelConnection } from '../ai/model-client'
import { reviewExtractionOutputSchema } from './review-extraction.schema'
import {
  ReviewExtractionQuoteValidationError,
  validateReviewExtractionQuotes,
  type ValidatedReviewExtractionSegment,
} from './review-extraction'
import {
  buildReviewExtractionRepairPrompt,
  buildReviewExtractionUserPrompt,
  reviewExtractionSystemPrompt,
} from './review-extraction.prompt'
import type { ReviewTextChunk } from './review-text-chunk'

export const maxReviewExtractionAttempts = 3
export const maxReviewExtractionConcurrency = 5
const reviewExtractionMaxOutputTokens = 8_000

const reviewExtractionRetryDelaysMs = [0, 2_000, 5_000] as const

export type ReviewExtractionResult = {
  segments: ValidatedReviewExtractionSegment[]
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
  attemptNumber: number
}

export type ReviewChunkExtractionResult = ReviewExtractionResult & {
  chunkId: string
  index: number
}

export type ReviewExtractionBatchResult = {
  chunks: ReviewChunkExtractionResult[]
  segments: ValidatedReviewExtractionSegment[]
}

export type ReviewExtractionExecutionOptions = {
  requestCompletion?: typeof requestModelCompletion
  retryDelaysMs?: readonly number[]
  concurrency?: number
  lifecycle?: {
    onAttemptStarted?: (context: ReviewExtractionAttemptContext) => Promise<void> | void
    onAttemptCompleted?: (
      context: ReviewExtractionAttemptContext,
      result: ReviewExtractionResult,
    ) => Promise<void> | void
    onAttemptFailed?: (context: ReviewExtractionAttemptContext, error: unknown) => Promise<void> | void
  }
}

export type ReviewExtractionAttemptContext = {
  operationKey: string
  chunk: ReviewTextChunk
  attemptNumber: number
  systemPrompt: string
  userPrompt: string
}

export class ReviewExtractionStructuredOutputError extends Error {
  readonly code = 'structured_output_validation_failed' as const
  readonly retryable = true

  constructor(
    message: string,
    readonly validationContext: ValidationRepairContext,
    readonly rawOutput: string,
    readonly tokenUsage: AgentTokenUsage | null,
  ) {
    super(message)
    this.name = 'ReviewExtractionStructuredOutputError'
  }
}

function createQuoteRepairContext(error: ReviewExtractionQuoteValidationError): ValidationRepairContext {
  return {
    validationIssues: error.issues.map((issue) => ({
      path: ['segments', issue.segmentIndex, 'sourceQuote'],
      code: 'invalid_source_quote',
      message: issue.message,
      receivedValue: issue.sourceQuote,
    })),
    invalidFieldValues: JSON.stringify(
      error.issues.map((issue) => ({
        path: ['segments', issue.segmentIndex, 'sourceQuote'],
        value: issue.sourceQuote,
      })),
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 不改变业务含义，只兼容模型常见的两种格式偏差：
 * 1. 把顶层 { segments } 简写成 segments 数组；
 * 2. 把“已回答”写成 answered，而业务枚举使用 complete。
 * 归一化后仍然必须经过同一套 Zod 和 sourceQuote 校验。
 */
function normalizeReviewExtractionOutput(rawJson: unknown): unknown {
  const segments = Array.isArray(rawJson) ? rawJson : isRecord(rawJson) ? rawJson.segments : null
  if (!Array.isArray(segments)) return rawJson

  return {
    segments: segments.map((segment) => {
      if (!isRecord(segment)) return segment

      const normalized = { ...segment }
      if (normalized.answerStatus === 'answered' || normalized.answerStatus === 'fully_answered') {
        normalized.answerStatus = 'complete'
      } else if (normalized.answerStatus === 'partially_answered' || normalized.answerStatus === 'incomplete') {
        normalized.answerStatus = 'partial'
      }

      return normalized
    }),
  }
}

/**
 * 解析一次模型输出，单独抽出来方便测试，也方便后续重试时复用。
 */
export function parseReviewExtractionCompletion(
  rawOutput: string,
  chunk: ReviewTextChunk,
  tokenUsage: AgentTokenUsage | null,
): ReviewExtractionResult {
  let rawJson: unknown

  try {
    rawJson = parseModelOutputJson(rawOutput)
  } catch (error) {
    throw new ReviewExtractionStructuredOutputError(
      '复盘提取模型返回的内容不是合法 JSON',
      createJsonSyntaxRepairContext(rawOutput, error),
      rawOutput,
      tokenUsage,
    )
  }

  const parsedOutput = reviewExtractionOutputSchema.safeParse(normalizeReviewExtractionOutput(rawJson))

  if (!parsedOutput.success) {
    throw new ReviewExtractionStructuredOutputError(
      '复盘提取结果未通过 Zod 校验',
      createValidationRepairContext(rawOutput, parsedOutput.error),
      rawOutput,
      tokenUsage,
    )
  }

  try {
    return {
      segments: validateReviewExtractionQuotes(parsedOutput.data, chunk),
      rawOutput,
      tokenUsage,
      attemptNumber: 1,
    }
  } catch (error) {
    if (!(error instanceof ReviewExtractionQuoteValidationError)) throw error

    throw new ReviewExtractionStructuredOutputError(
      '复盘提取结果中的 sourceQuote 无法定位到原文',
      createQuoteRepairContext(error),
      rawOutput,
      tokenUsage,
    )
  }
}

export function mergeReviewExtractionSegments(
  chunkResults: ReviewChunkExtractionResult[],
): ValidatedReviewExtractionSegment[] {
  const uniqueSegments = new Map<string, ValidatedReviewExtractionSegment>()

  for (const chunkResult of chunkResults) {
    for (const segment of chunkResult.segments) {
      const dedupeKey = [segment.kind, segment.sourceStartOffset, segment.sourceEndOffset].join(':')

      if (!uniqueSegments.has(dedupeKey)) {
        uniqueSegments.set(dedupeKey, segment)
      }
    }
  }

  return [...uniqueSegments.values()].sort((left, right) => {
    if (left.sourceStartOffset !== right.sourceStartOffset) {
      return left.sourceStartOffset - right.sourceStartOffset
    }

    return left.sourceEndOffset - right.sourceEndOffset
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) return

      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}

/**
 * 执行一个复盘 chunk 的模型提取。
 * 一个 chunk 最多执行三次：首次调用 + 两次修复重试。
 * 这里仍不负责 AgentRun 持久化。
 */
export async function extractReviewChunk(
  operationKey: string,
  modelConnection: ModelConnection,
  chunk: ReviewTextChunk,
  options: ReviewExtractionExecutionOptions = {},
): Promise<ReviewExtractionResult> {
  const requestCompletion = options.requestCompletion ?? requestModelCompletion
  const retryDelaysMs = options.retryDelaysMs ?? reviewExtractionRetryDelaysMs
  let repairContext: ValidationRepairContext | null = null

  for (let attemptNumber = 1; attemptNumber <= maxReviewExtractionAttempts; attemptNumber += 1) {
    const userPrompt = repairContext
      ? buildReviewExtractionRepairPrompt(chunk, repairContext)
      : buildReviewExtractionUserPrompt(chunk)
    const attemptContext: ReviewExtractionAttemptContext = {
      operationKey,
      chunk,
      attemptNumber,
      systemPrompt: reviewExtractionSystemPrompt,
      userPrompt,
    }

    await options.lifecycle?.onAttemptStarted?.(attemptContext)

    try {
      const completion = await requestCompletion(
        operationKey,
        modelConnection,
        reviewExtractionSystemPrompt,
        userPrompt,
        {
          temperature: 0.1,
          maxTokens: reviewExtractionMaxOutputTokens,
        },
      )

      const result = parseReviewExtractionCompletion(completion.rawOutput, chunk, completion.tokenUsage)

      await options.lifecycle?.onAttemptCompleted?.(attemptContext, {
        ...result,
        attemptNumber,
      })

      return {
        ...result,
        attemptNumber,
      }
    } catch (error) {
      await options.lifecycle?.onAttemptFailed?.(attemptContext, error)
      const isStructuredOutputError = error instanceof ReviewExtractionStructuredOutputError
      const isRetryableModelError = error instanceof ModelRequestError && error.retryable

      if (isStructuredOutputError) {
        repairContext = error.validationContext
      }

      const canRetry = (isStructuredOutputError || isRetryableModelError) && attemptNumber < maxReviewExtractionAttempts

      if (!canRetry) throw error

      await new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelaysMs[attemptNumber] ?? 0)
      })
    }
  }

  throw new Error('复盘提取未返回结果')
}

/**
 * 并发提取一份复盘中的所有 chunk。
 * 单个 chunk 的失败会让整份复盘失败，避免只保存半份能力证据。
 */
export async function extractReviewChunks(
  operationKey: string,
  modelConnection: ModelConnection,
  chunks: ReviewTextChunk[],
  options: ReviewExtractionExecutionOptions = {},
): Promise<ReviewExtractionBatchResult> {
  if (chunks.length === 0) {
    return { chunks: [], segments: [] }
  }

  if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency <= 0)) {
    throw new Error('复盘提取 concurrency 必须是大于 0 的整数')
  }

  const concurrency = Math.min(
    Math.floor(options.concurrency ?? maxReviewExtractionConcurrency),
    maxReviewExtractionConcurrency,
  )

  const chunkResults = await mapWithConcurrency(chunks, concurrency, async (chunk) => {
    const result = await extractReviewChunk(operationKey + ':' + chunk.chunkId, modelConnection, chunk, options)

    return {
      ...result,
      chunkId: chunk.chunkId,
      index: chunk.index,
    }
  })

  return {
    chunks: chunkResults,
    segments: mergeReviewExtractionSegments(chunkResults),
  }
}
