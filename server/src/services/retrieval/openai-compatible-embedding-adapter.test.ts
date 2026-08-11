import assert from 'node:assert/strict'
import test from 'node:test'
import { RETRIEVAL_EMBEDDING_DIMENSIONS } from '@/shared/retrieval/constants'
import { OpenAICompatibleEmbeddingAdapter } from './openai-compatible-embedding-adapter'

const embedding = Array.from({ length: RETRIEVAL_EMBEDDING_DIMENSIONS }, (_, index) => index / 1000)

test('调用 OpenAI-compatible embeddings 接口并按 index 恢复输入顺序', async () => {
  let requestUrl = ''
  let request: RequestInit | undefined
  const adapter = new OpenAICompatibleEmbeddingAdapter(
    {
      baseUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'embedding-key',
      modelName: 'embedding-model',
    },
    async (input, init) => {
      requestUrl = String(input)
      request = init
      return Response.json({
        data: [
          { index: 1, embedding: embedding.map((value) => value + 1) },
          { index: 0, embedding },
        ],
      })
    },
  )
  const controller = new AbortController()

  const result = await adapter.embed({ texts: ['第一段', '第二段'], signal: controller.signal })

  assert.equal(requestUrl, 'https://example.com/v1/embeddings')
  assert.equal(request?.signal, controller.signal)
  assert.deepEqual(JSON.parse(String(request?.body)), {
    model: 'embedding-model',
    input: ['第一段', '第二段'],
    dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  })
  assert.deepEqual(result, [embedding, embedding.map((value) => value + 1)])
})

test('向量维度不匹配时拒绝写入数据库', async () => {
  const adapter = new OpenAICompatibleEmbeddingAdapter(
    {
      baseUrl: 'https://example.com/v1',
      apiKey: 'embedding-key',
      modelName: 'wrong-dimensions-model',
    },
    async () => Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
  )

  await assert.rejects(
    adapter.embed({ texts: ['测试'], signal: new AbortController().signal }),
    /Embedding 向量必须是 1024 维有限数值数组/,
  )
})

test('空文本批次不会浪费一次 Embedding 请求', async () => {
  let requestCount = 0
  const adapter = new OpenAICompatibleEmbeddingAdapter(
    {
      baseUrl: 'https://example.com/v1',
      apiKey: 'embedding-key',
      modelName: 'embedding-model',
    },
    async () => {
      requestCount += 1
      return Response.json({ data: [] })
    },
  )

  assert.deepEqual(await adapter.embed({ texts: [], signal: new AbortController().signal }), [])
  assert.equal(requestCount, 0)
})
