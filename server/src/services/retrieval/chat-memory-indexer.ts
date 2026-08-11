import { randomUUID } from 'node:crypto'
import type { ChatMemoryDocumentRecord, ChatMemoryPersistence } from '../../repositories/chat-memory.repository'
import { chunkChatMemoryTurn } from './chat-memory-chunk'
import type { EmbeddingProviderAdapter } from './embedding-provider-adapter'
import { createRetrievalDocumentScope } from './retrieval-scope'

export type IndexChatMemoryInput = {
  userId: string
  conversationId: string
  runId: string
  userText: string
  assistantText: string
  boundOpportunityId: string | null
  relatedOpportunityIds: string[]
  signal: AbortSignal
}

export type IndexChatMemoryResult =
  | {
      status: 'indexed'
      documentCount: number
    }
  | {
      status: 'skipped'
      reason: 'already_indexed' | 'empty'
    }

type ChatMemoryIndexerDependencies = {
  repository: ChatMemoryPersistence
  embeddingAdapter: EmbeddingProviderAdapter
  createId?: () => string
  now?: () => Date
}

export class ChatMemoryEmbeddingModelChangedError extends Error {}

function assertEmbeddingBatch(input: { embeddings: number[][]; expectedCount: number; expectedDimensions: number }) {
  if (input.embeddings.length !== input.expectedCount) {
    throw new Error(`Embedding 返回数量错误：期望 ${input.expectedCount}，实际 ${input.embeddings.length}`)
  }

  input.embeddings.forEach((embedding, index) => {
    if (embedding.length !== input.expectedDimensions || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error(`第 ${index + 1} 条 Embedding 不是 ${input.expectedDimensions} 维有限数值数组`)
    }
  })
}

export class ChatMemoryIndexer {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: ChatMemoryIndexerDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  async indexCompletedTurn(input: IndexChatMemoryInput): Promise<IndexChatMemoryResult> {
    const indexedRun = await this.dependencies.repository.findIndexedRun({
      userId: input.userId,
      runId: input.runId,
    })

    if (indexedRun) {
      if (indexedRun.embeddingModel !== this.dependencies.embeddingAdapter.modelName) {
        throw new ChatMemoryEmbeddingModelChangedError(
          `ChatRun 已由 ${indexedRun.embeddingModel} 建立索引，不能直接改用 ${this.dependencies.embeddingAdapter.modelName}；请先执行索引重建`,
        )
      }

      return { status: 'skipped', reason: 'already_indexed' }
    }

    const chunks = chunkChatMemoryTurn({
      userText: input.userText,
      assistantText: input.assistantText,
    })

    if (chunks.length === 0) {
      return { status: 'skipped', reason: 'empty' }
    }

    const embeddings = await this.dependencies.embeddingAdapter.embed({
      texts: chunks.map((chunk) => chunk.content),
      signal: input.signal,
    })

    assertEmbeddingBatch({
      embeddings,
      expectedCount: chunks.length,
      expectedDimensions: this.dependencies.embeddingAdapter.dimensions,
    })

    const scope = createRetrievalDocumentScope({
      boundOpportunityId: input.boundOpportunityId,
      relatedOpportunityIds: input.relatedOpportunityIds,
    })
    const timestamp = this.now().toISOString()
    const documents: ChatMemoryDocumentRecord[] = chunks.map((chunk, index) => ({
      id: this.createId(),
      userId: input.userId,
      conversationId: input.conversationId,
      runId: input.runId,
      chunkIndex: chunk.index,
      scopeType: scope.type,
      opportunityIds: scope.type === 'opportunity' ? scope.opportunityIds : [],
      content: chunk.content,
      contentHash: chunk.contentHash,
      embeddingModel: this.dependencies.embeddingAdapter.modelName,
      embedding: embeddings[index],
      createdAt: timestamp,
      updatedAt: timestamp,
    }))

    const insertedCount = await this.dependencies.repository.insertDocumentsIfAbsent(documents)

    if (insertedCount === 0) {
      return { status: 'skipped', reason: 'already_indexed' }
    }

    return { status: 'indexed', documentCount: insertedCount }
  }
}
