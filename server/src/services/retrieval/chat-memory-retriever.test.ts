import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RetrievalResult } from './retrieval-types'
import { ChatMemoryRetriever } from './chat-memory-retriever'

function createResult(runId: string, index: number): RetrievalResult {
  return {
    documentId: `document-${runId}-${index}`,
    conversationId: `conversation-${runId}`,
    runId,
    content: `memory-${runId}-${index}`,
    score: 0.9 - index * 0.01,
    scope: { type: 'global' },
  }
}

describe('ChatMemoryRetriever', () => {
  it('embeds the query, forwards the retrieval scope and limits chunks from one run', async () => {
    const repositoryInputs: unknown[] = []
    const retriever = new ChatMemoryRetriever({
      embeddingAdapter: {
        modelName: 'embedding-model',
        dimensions: 3,
        async embed(input) {
          assert.deepEqual(input.texts, ['我之前有哪些 Vue 薄弱项？'])
          return [[0.1, 0.2, 0.3]]
        },
      },
      repository: {
        async searchSimilarDocuments(input) {
          repositoryInputs.push(input)
          return [
            createResult('run-a', 0),
            createResult('run-a', 1),
            createResult('run-a', 2),
            createResult('run-b', 0),
            createResult('run-c', 0),
          ]
        },
      },
    })

    const scope = {
      userId: 'user-1',
      conversationScopeType: 'opportunity' as const,
      boundOpportunityId: 'opportunity-a',
      referencedOpportunityIds: ['opportunity-b'],
    }
    const results = await retriever.retrieve({
      queryText: '我之前有哪些 Vue 薄弱项？',
      scope,
      signal: new AbortController().signal,
      limit: 4,
    })

    assert.equal(repositoryInputs.length, 1)
    assert.deepEqual(repositoryInputs[0], {
      queryEmbedding: [0.1, 0.2, 0.3],
      embeddingModel: 'embedding-model',
      scope,
      limit: 12,
      minScore: 0.55,
    })
    assert.deepEqual(
      results.map((result) => result.runId),
      ['run-a', 'run-a', 'run-b', 'run-c'],
    )
  })

  it('does not call Embedding or the repository for an empty query', async () => {
    let embeddingCalls = 0
    let repositoryCalls = 0
    const retriever = new ChatMemoryRetriever({
      embeddingAdapter: {
        modelName: 'embedding-model',
        dimensions: 3,
        async embed() {
          embeddingCalls += 1
          return [[0.1, 0.2, 0.3]]
        },
      },
      repository: {
        async searchSimilarDocuments() {
          repositoryCalls += 1
          return []
        },
      },
    })

    const results = await retriever.retrieve({
      queryText: '   ',
      scope: {
        userId: 'user-1',
        conversationScopeType: 'global',
        boundOpportunityId: null,
        referencedOpportunityIds: [],
      },
      signal: new AbortController().signal,
    })

    assert.deepEqual(results, [])
    assert.equal(embeddingCalls, 0)
    assert.equal(repositoryCalls, 0)
  })

  it('rejects an invalid query vector before touching the database', async () => {
    let repositoryCalls = 0
    const retriever = new ChatMemoryRetriever({
      embeddingAdapter: {
        modelName: 'embedding-model',
        dimensions: 3,
        async embed() {
          return [[0.1, 0.2]]
        },
      },
      repository: {
        async searchSimilarDocuments() {
          repositoryCalls += 1
          return []
        },
      },
    })

    await assert.rejects(
      retriever.retrieve({
        queryText: '测试',
        scope: {
          userId: 'user-1',
          conversationScopeType: 'global',
          boundOpportunityId: null,
          referencedOpportunityIds: [],
        },
        signal: new AbortController().signal,
      }),
      /查询 Embedding 必须返回一条 3 维有限数值向量/,
    )
    assert.equal(repositoryCalls, 0)
  })
})
