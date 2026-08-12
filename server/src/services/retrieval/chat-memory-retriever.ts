import type { ChatMemoryRetrievalPersistence } from '../../repositories/chat-memory.repository'
import type { EmbeddingProviderAdapter } from './embedding-provider-adapter'
import type { RetrievalResult, RetrievalScope } from './retrieval-types'

export type RetrieveChatMemoryInput = {
  queryText: string
  scope: RetrievalScope
  signal: AbortSignal
  limit?: number
  minScore?: number
}

type ChatMemoryRetrieverDependencies = {
  repository: ChatMemoryRetrievalPersistence
  embeddingAdapter: EmbeddingProviderAdapter
  maxChunksPerRun?: number
  candidateMultiplier?: number
}

function assertQueryEmbedding(embeddings: number[][], expectedDimensions: number) {
  const embedding = embeddings[0]
  if (
    embeddings.length !== 1 ||
    !embedding ||
    embedding.length !== expectedDimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`查询 Embedding 必须返回一条 ${expectedDimensions} 维有限数值向量`)
  }
  return embedding
}

function diversifyByRun(results: RetrievalResult[], limit: number, maxChunksPerRun: number) {
  const countByRunId = new Map<string, number>()
  const diversified: RetrievalResult[] = []

  for (const result of results) {
    const count = countByRunId.get(result.runId) ?? 0
    if (count >= maxChunksPerRun) continue

    diversified.push(result)
    countByRunId.set(result.runId, count + 1)
    if (diversified.length >= limit) break
  }

  return diversified
}

export class ChatMemoryRetriever {
  private readonly maxChunksPerRun: number
  private readonly candidateMultiplier: number

  constructor(private readonly dependencies: ChatMemoryRetrieverDependencies) {
    this.maxChunksPerRun = dependencies.maxChunksPerRun ?? 2
    this.candidateMultiplier = dependencies.candidateMultiplier ?? 3
  }

  async retrieve(input: RetrieveChatMemoryInput) {
    const queryText = input.queryText.trim()
    if (!queryText) return []

    const limit = input.limit ?? 5
    const minScore = input.minScore ?? 0.55
    const embeddings = await this.dependencies.embeddingAdapter.embed({ texts: [queryText], signal: input.signal })
    const queryEmbedding = assertQueryEmbedding(embeddings, this.dependencies.embeddingAdapter.dimensions)
    const candidates = await this.dependencies.repository.searchSimilarDocuments({
      queryEmbedding,
      embeddingModel: this.dependencies.embeddingAdapter.modelName,
      scope: input.scope,
      limit: limit * this.candidateMultiplier,
      minScore,
    })

    return diversifyByRun(candidates, limit, this.maxChunksPerRun)
  }
}
