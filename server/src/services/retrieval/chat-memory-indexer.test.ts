import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ChatMemoryDocumentRecord,
  ChatMemoryPersistence,
  IndexedChatRun,
} from '../../repositories/chat-memory.repository'
import { ChatMemoryEmbeddingModelChangedError, ChatMemoryIndexer } from './chat-memory-indexer'
import type { EmbeddingProviderAdapter } from './embedding-provider-adapter'

const dimensions = 4

function createRepository(
  input: {
    indexedRun?: IndexedChatRun | null
    insertedCount?: number
    onInsert?: (documents: ChatMemoryDocumentRecord[]) => void
  } = {},
): ChatMemoryPersistence {
  return {
    async findIndexedRun() {
      return input.indexedRun ?? null
    },
    async insertDocumentsIfAbsent(documents) {
      input.onInsert?.(documents)
      return input.insertedCount ?? documents.length
    },
  }
}

function createEmbeddingAdapter(onEmbed?: (texts: string[]) => void): EmbeddingProviderAdapter {
  return {
    modelName: 'test-embedding',
    dimensions,
    async embed(input) {
      onEmbed?.(input.texts)
      return input.texts.map((_, index) => Array.from({ length: dimensions }, () => index + 0.25))
    },
  }
}

function createInput() {
  return {
    userId: 'user-1',
    conversationId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    userText: '帮我比较一下这两个机会。',
    assistantText: '第一个机会更符合你的前端经验，第二个机会更看重后端能力。',
    boundOpportunityId: 'opportunity-1',
    relatedOpportunityIds: ['opportunity-2', 'opportunity-1'],
    signal: new AbortController().signal,
  }
}

test('已索引的 ChatRun 不会重复调用 Embedding', async () => {
  let embedCount = 0
  const indexer = new ChatMemoryIndexer({
    repository: createRepository({ indexedRun: { embeddingModel: 'test-embedding' } }),
    embeddingAdapter: createEmbeddingAdapter(() => {
      embedCount += 1
    }),
  })

  assert.deepEqual(await indexer.indexCompletedTurn(createInput()), {
    status: 'skipped',
    reason: 'already_indexed',
  })
  assert.equal(embedCount, 0)
})

test('旧索引模型不同会要求显式重建，不能静默混写向量', async () => {
  const indexer = new ChatMemoryIndexer({
    repository: createRepository({ indexedRun: { embeddingModel: 'old-embedding' } }),
    embeddingAdapter: createEmbeddingAdapter(),
  })

  await assert.rejects(indexer.indexCompletedTurn(createInput()), ChatMemoryEmbeddingModelChangedError)
})

test('没有完整问答内容时跳过索引', async () => {
  let inserted = false
  const indexer = new ChatMemoryIndexer({
    repository: createRepository({
      onInsert() {
        inserted = true
      },
    }),
    embeddingAdapter: createEmbeddingAdapter(),
  })

  assert.deepEqual(
    await indexer.indexCompletedTurn({
      ...createInput(),
      assistantText: '[系统执行记录：任务已完成]',
    }),
    { status: 'skipped', reason: 'empty' },
  )
  assert.equal(inserted, false)
})

test('按机会边界切块、向量化并批量写入完整文档', async () => {
  let embeddedTexts: string[] = []
  let insertedDocuments: ChatMemoryDocumentRecord[] = []
  let idSequence = 0
  const indexer = new ChatMemoryIndexer({
    repository: createRepository({
      onInsert(documents) {
        insertedDocuments = documents
      },
    }),
    embeddingAdapter: createEmbeddingAdapter((texts) => {
      embeddedTexts = texts
    }),
    createId: () => `33333333-3333-4333-8333-${String(++idSequence).padStart(12, '0')}`,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  })

  assert.deepEqual(await indexer.indexCompletedTurn(createInput()), {
    status: 'indexed',
    documentCount: 1,
  })
  assert.deepEqual(embeddedTexts, [insertedDocuments[0]?.content])
  assert.equal(insertedDocuments[0]?.scopeType, 'opportunity')
  assert.deepEqual(insertedDocuments[0]?.opportunityIds, ['opportunity-1', 'opportunity-2'])
  assert.equal(insertedDocuments[0]?.embeddingModel, 'test-embedding')
  assert.deepEqual(insertedDocuments[0]?.embedding, [0.25, 0.25, 0.25, 0.25])
  assert.equal(insertedDocuments[0]?.createdAt, '2026-08-11T12:00:00.000Z')
  assert.equal(insertedDocuments[0]?.updatedAt, '2026-08-11T12:00:00.000Z')
})

test('并发 Worker 已抢先写入时，唯一约束结果会被视为幂等跳过', async () => {
  const indexer = new ChatMemoryIndexer({
    repository: createRepository({ insertedCount: 0 }),
    embeddingAdapter: createEmbeddingAdapter(),
  })

  assert.deepEqual(await indexer.indexCompletedTurn(createInput()), {
    status: 'skipped',
    reason: 'already_indexed',
  })
})

test('Indexer 会拒绝数量或维度不符合协议的向量批次', async () => {
  const wrongCountIndexer = new ChatMemoryIndexer({
    repository: createRepository(),
    embeddingAdapter: {
      modelName: 'test-embedding',
      dimensions,
      async embed() {
        return []
      },
    },
  })
  await assert.rejects(wrongCountIndexer.indexCompletedTurn(createInput()), /Embedding 返回数量错误/)

  const wrongDimensionsIndexer = new ChatMemoryIndexer({
    repository: createRepository(),
    embeddingAdapter: {
      modelName: 'test-embedding',
      dimensions,
      async embed() {
        return [[0.1, 0.2]]
      },
    },
  })
  await assert.rejects(wrongDimensionsIndexer.indexCompletedTurn(createInput()), /不是 4 维有限数值数组/)
})
