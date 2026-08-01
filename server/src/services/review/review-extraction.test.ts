import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewExtractionOutputSchema } from './review-extraction.schema'
import { ReviewExtractionQuoteValidationError, validateReviewExtractionQuotes } from './review-extraction'

const chunk = {
  chunkId: 'review-chunk-0-10-42',
  index: 0,
  text: '面试官问：请解释 Vue 的响应式原理。候选人回答：Vue 通过响应式系统追踪依赖。',
  startOffset: 10,
  endOffset: 42,
  hasPreviousContext: false,
  hasNextContext: false,
}

test('服务端根据 sourceQuote 计算原文 offset', () => {
  const output = reviewExtractionOutputSchema.parse({
    segments: [
      {
        kind: 'candidate_answer',
        sourceType: 'interview',
        content: '候选人说明了 Vue 响应式系统会追踪依赖。',
        sourceQuote: 'Vue 通过响应式系统追踪依赖。',
        confidence: 'high',
        answerStatus: 'complete',
      },
    ],
  })

  const [segment] = validateReviewExtractionQuotes(output, chunk)
  const relativeStart = chunk.text.indexOf('Vue 通过响应式系统追踪依赖。')

  assert.equal(segment.sourceStartOffset, chunk.startOffset + relativeStart)
  assert.equal(segment.sourceEndOffset, segment.sourceStartOffset + segment.sourceQuote.length)
})

test('sourceQuote 不存在时拒绝整个提取结果', () => {
  const output = reviewExtractionOutputSchema.parse({
    segments: [
      {
        kind: 'candidate_answer',
        sourceType: 'interview',
        content: '候选人提到了 React。',
        sourceQuote: '候选人熟练掌握 React。',
        confidence: 'medium',
        answerStatus: 'partial',
      },
    ],
  })

  assert.throws(
    () => validateReviewExtractionQuotes(output, chunk),
    (error: unknown) => {
      assert.ok(error instanceof ReviewExtractionQuoteValidationError)
      assert.equal(error.issues.length, 1)
      assert.equal(error.issues[0].segmentIndex, 0)
      return true
    },
  )
})

test('sourceQuote 保留原文中的首尾空白，不被 schema trim', () => {
  const output = reviewExtractionOutputSchema.parse({
    segments: [
      {
        kind: 'context',
        sourceType: 'unknown',
        content: '带有换行的上下文。',
        sourceQuote: ' 面试记录开始\n',
        confidence: 'high',
      },
    ],
  })

  assert.equal(output.segments[0].sourceQuote, ' 面试记录开始\n')
})
