import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractReviewChunks,
  mergeReviewExtractionSegments,
  extractReviewChunk,
  parseReviewExtractionCompletion,
  ReviewExtractionStructuredOutputError,
} from './review-extraction.service'
import { ModelRequestError } from '../ai/model-client'

const chunk = {
  chunkId: 'review-chunk-0-0-30',
  index: 0,
  text: '面试官问：请解释 Vue。候选人回答：Vue 会追踪响应式依赖。',
  startOffset: 0,
  endOffset: 30,
  hasPreviousContext: false,
  hasNextContext: false,
}

const validOutput = {
  segments: [
    {
      kind: 'candidate_answer',
      sourceType: 'interview',
      content: '候选人说明 Vue 会追踪响应式依赖。',
      sourceQuote: 'Vue 会追踪响应式依赖。',
      confidence: 'high',
      answerStatus: 'complete',
    },
  ],
}

const modelConnection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

function createChunk(index: number, text: string) {
  return {
    chunkId: 'chunk-' + index,
    index,
    text,
    startOffset: index * 10,
    endOffset: index * 10 + text.length,
    hasPreviousContext: index > 0,
    hasNextContext: index < 3,
  }
}

test('一次模型输出会完成 JSON、Zod 和 sourceQuote 三层校验', () => {
  const result = parseReviewExtractionCompletion(JSON.stringify(validOutput), chunk, null)
  const quote = validOutput.segments[0].sourceQuote
  const quoteStart = chunk.text.indexOf(quote)

  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].sourceStartOffset, quoteStart)
  assert.equal(result.segments[0].sourceEndOffset, quoteStart + quote.length)
})

test('兼容模型返回顶层数组和 answered 别名，并继续执行原文引用校验', () => {
  const output = [
    {
      kind: 'candidate_answer',
      sourceType: 'interview',
      content: '候选人回答了 Vue 的响应式原理。',
      sourceQuote: 'Vue 会追踪响应式依赖。',
      confidence: 'high',
      answerStatus: 'answered',
    },
  ]

  const result = parseReviewExtractionCompletion(JSON.stringify(output), chunk, null)

  assert.equal(result.segments[0].answerStatus, 'complete')
})

test('非法 JSON 会生成可用于修复 Prompt 的上下文', () => {
  assert.throws(
    () => parseReviewExtractionCompletion('{"segments":', chunk, null),
    (error: unknown) => {
      assert.ok(error instanceof ReviewExtractionStructuredOutputError)
      assert.equal(error.validationContext.validationIssues[0].code, 'invalid_json')
      return true
    },
  )
})

test('Zod 字段错误会被识别为结构化校验失败', () => {
  const invalidOutput = {
    segments: [
      {
        kind: 'candidate_answer',
        sourceType: 'interview',
        content: '候选人回答。',
        sourceQuote: '候选人回答。',
        confidence: 'certain',
      },
    ],
  }

  assert.throws(
    () => parseReviewExtractionCompletion(JSON.stringify(invalidOutput), chunk, null),
    (error: unknown) => {
      assert.ok(error instanceof ReviewExtractionStructuredOutputError)
      assert.deepEqual(error.validationContext.validationIssues[0].path, ['segments', '0', 'confidence'])
      return true
    },
  )
})

test('sourceQuote 不在 chunk 中时会进入修复流程', () => {
  const invalidQuoteOutput = {
    segments: [
      {
        ...validOutput.segments[0],
        sourceQuote: '候选人掌握 React。',
      },
    ],
  }

  assert.throws(
    () => parseReviewExtractionCompletion(JSON.stringify(invalidQuoteOutput), chunk, null),
    (error: unknown) => {
      assert.ok(error instanceof ReviewExtractionStructuredOutputError)
      assert.equal(error.validationContext.validationIssues[0].code, 'invalid_source_quote')
      return true
    },
  )
})

test('结构化校验失败后会使用修复 Prompt，并在第二次成功', async () => {
  const prompts: string[] = []
  const outputs = ['不是 JSON', JSON.stringify(validOutput)]
  let callCount = 0

  const result = await extractReviewChunk('review:test:chunk:0', modelConnection, chunk, {
    retryDelaysMs: [0, 0, 0],
    requestCompletion: async (_operationKey, _connection, _systemPrompt, userPrompt) => {
      prompts.push(userPrompt)

      return {
        rawOutput: outputs[callCount++],
        tokenUsage: null,
      }
    },
  })

  assert.equal(result.attemptNumber, 2)
  assert.equal(callCount, 2)
  assert.match(prompts[1], /上一次输出未通过复盘文本结构化校验/)
  assert.match(prompts[1], /invalid_json/)
})

test('三次结构化校验都失败后停止，不会进行第四次调用', async () => {
  let callCount = 0

  await assert.rejects(
    () =>
      extractReviewChunk('review:test:chunk:0', modelConnection, chunk, {
        retryDelaysMs: [0, 0, 0],
        requestCompletion: async () => {
          callCount += 1
          return { rawOutput: '不是 JSON', tokenUsage: null }
        },
      }),
    ReviewExtractionStructuredOutputError,
  )

  assert.equal(callCount, 3)
})

test('不可重试的模型错误不会重复调用', async () => {
  let callCount = 0

  await assert.rejects(
    () =>
      extractReviewChunk('review:test:chunk:0', modelConnection, chunk, {
        retryDelaysMs: [0, 0, 0],
        requestCompletion: async () => {
          callCount += 1
          throw new ModelRequestError('当前模型额度已用完', 'model_quota_exhausted', false)
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ModelRequestError)
      assert.equal(error.code, 'model_quota_exhausted')
      return true
    },
  )

  assert.equal(callCount, 1)
})

test('多个 chunk 最多按照 concurrency 并发执行，并合并结果', async () => {
  const chunks = [
    createChunk(0, '第一段'),
    createChunk(1, '第二段'),
    createChunk(2, '第三段'),
    createChunk(3, '第四段'),
  ]
  let activeCount = 0
  let maxActiveCount = 0

  const result = await extractReviewChunks('review:test', modelConnection, chunks, {
    concurrency: 2,
    retryDelaysMs: [0, 0, 0],
    requestCompletion: async (operationKey) => {
      const chunk = chunks.find((item) => operationKey.endsWith(item.chunkId))
      assert.ok(chunk)

      activeCount += 1
      maxActiveCount = Math.max(maxActiveCount, activeCount)

      await new Promise((resolve) => setTimeout(resolve, 5))
      activeCount -= 1

      return {
        rawOutput: JSON.stringify({
          segments: [
            {
              kind: 'context',
              sourceType: 'unknown',
              content: chunk.text,
              sourceQuote: chunk.text,
              confidence: 'high',
            },
          ],
        }),
        tokenUsage: null,
      }
    },
  })

  assert.equal(maxActiveCount, 2)
  assert.equal(result.chunks.length, 4)
  assert.equal(result.segments.length, 4)
  assert.deepEqual(
    result.segments.map((segment) => segment.content),
    ['第一段', '第二段', '第三段', '第四段'],
  )
})

test('重叠 chunk 中相同位置的证据只保留一条', () => {
  const segment = {
    kind: 'context' as const,
    sourceType: 'unknown' as const,
    content: '同一条证据',
    sourceQuote: '同一条证据',
    confidence: 'high' as const,
    sourceStartOffset: 10,
    sourceEndOffset: 15,
  }

  const merged = mergeReviewExtractionSegments([
    {
      chunkId: 'chunk-0',
      index: 0,
      rawOutput: '{}',
      tokenUsage: null,
      attemptNumber: 1,
      segments: [segment],
    },
    {
      chunkId: 'chunk-1',
      index: 1,
      rawOutput: '{}',
      tokenUsage: null,
      attemptNumber: 1,
      segments: [{ ...segment, content: '同一条证据的另一种概括' }],
    },
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].content, '同一条证据')
})

test('空 chunk 列表不会调用模型', async () => {
  let callCount = 0

  const result = await extractReviewChunks('review:empty', modelConnection, [], {
    requestCompletion: async () => {
      callCount += 1
      return { rawOutput: JSON.stringify({ segments: [] }), tokenUsage: null }
    },
  })

  assert.equal(callCount, 0)
  assert.deepEqual(result, { chunks: [], segments: [] })
})
