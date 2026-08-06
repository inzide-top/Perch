import type { ReviewTextChunk } from './review-text-chunk'
import type { ReviewExtractionOutput, ReviewExtractionSegment } from './review-extraction.schema'

export type ValidatedReviewExtractionSegment = ReviewExtractionSegment & {
  sourceStartOffset: number
  sourceEndOffset: number
}

export type ReviewExtractionQuoteIssue = {
  segmentIndex: number
  sourceQuote: string
  message: string
}

export class ReviewExtractionQuoteValidationError extends Error {
  constructor(public readonly issues: ReviewExtractionQuoteIssue[]) {
    super(`复盘结构化结果包含无法定位到原文的引用（${issues.length} 条）`)
    this.name = 'ReviewExtractionQuoteValidationError'
  }
}

/**
 * 验证模型返回的 sourceQuote 是否真的存在于当前 chunk，并由服务端计算 offset。
 * 模型不负责生成 offset，避免模型编造位置或计算错误。
 */
export function validateReviewExtractionQuotes(
  output: ReviewExtractionOutput,
  chunk: ReviewTextChunk,
): ValidatedReviewExtractionSegment[] {
  const validatedSegments: ValidatedReviewExtractionSegment[] = []
  const issues: ReviewExtractionQuoteIssue[] = []

  output.segments.forEach((segment, segmentIndex) => {
    const relativeStartOffset = chunk.text.indexOf(segment.sourceQuote)

    if (relativeStartOffset === -1) {
      issues.push({
        segmentIndex,
        sourceQuote: segment.sourceQuote,
        message: 'sourceQuote 不存在于当前 chunk 原文中',
      })
      return
    }

    const relativeEndOffset = relativeStartOffset + segment.sourceQuote.length

    validatedSegments.push({
      ...segment,
      sourceStartOffset: chunk.startOffset + relativeStartOffset,
      sourceEndOffset: chunk.startOffset + relativeEndOffset,
    })
  })

  if (issues.length > 0) {
    throw new ReviewExtractionQuoteValidationError(issues)
  }

  return validatedSegments
}
