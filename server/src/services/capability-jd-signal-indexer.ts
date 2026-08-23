import { createHash, randomUUID } from 'node:crypto'
import type { AnalysisItem } from '@/types/opportunity'
import {
  capabilityJdSignalRepository,
  type CapabilityJdSignalEmbeddingRecord,
  type CapabilityJdSignalIndexPersistence,
} from '../repositories/capability-jd-signal.repository'
import type { EmbeddingProviderAdapter } from './retrieval/embedding-provider-adapter'
import { getConfiguredEmbeddingAdapter } from './retrieval/embedding-environment'

type IndexedSignal = {
  type: 'strength' | 'gap'
  index: number
  title: string
  reason: string
  content: string
  contentHash: string
}

type CapabilityJdSignalIndexerDependencies = {
  repository: CapabilityJdSignalIndexPersistence
  embeddingAdapter: EmbeddingProviderAdapter
  createId?: () => string
  now?: () => Date
}

function createSignal(type: IndexedSignal['type'], item: AnalysisItem, index: number): IndexedSignal {
  const content = [item.title, item.reason, item.evidenceFromJD]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')
  return {
    type,
    index,
    title: item.title,
    reason: item.reason,
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
  }
}

function getAnalysisSignals(result: { strengths: AnalysisItem[]; gaps: AnalysisItem[] }) {
  return [
    ...result.strengths.map((item, index) => createSignal('strength', item, index)),
    ...result.gaps.map((item, index) => createSignal('gap', item, index)),
  ]
}

function assertEmbeddingBatch(input: { embeddings: number[][]; expectedCount: number; expectedDimensions: number }) {
  if (input.embeddings.length !== input.expectedCount) {
    throw new Error(`JD 信号 Embedding 返回数量错误：期望 ${input.expectedCount}，实际 ${input.embeddings.length}`)
  }
  input.embeddings.forEach((embedding, index) => {
    if (embedding.length !== input.expectedDimensions || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error(`第 ${index + 1} 条 JD 信号 Embedding 不是 ${input.expectedDimensions} 维有限数值数组`)
    }
  })
}

export class CapabilityJdSignalIndexer {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: CapabilityJdSignalIndexerDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  get embeddingModel() {
    return this.dependencies.embeddingAdapter.modelName
  }

  async indexCompletedAnalysisFamily(analysisId: string, signal: AbortSignal) {
    const candidates = await this.dependencies.repository.findCompletedAnalysisFamily(analysisId)
    if (candidates.length === 0) return { indexedCount: 0, unchangedCount: 0 }

    const signalsByAnalysisId = new Map(
      candidates.map((candidate) => [candidate.analysisId, getAnalysisSignals(candidate.result)]),
    )
    const uniqueTexts = [
      ...new Set([...signalsByAnalysisId.values()].flatMap((signals) => signals.map((item) => item.content))),
    ]
    const embeddings =
      uniqueTexts.length > 0
        ? await this.dependencies.embeddingAdapter.embed({
            texts: uniqueTexts,
            signal,
          })
        : []

    assertEmbeddingBatch({
      embeddings,
      expectedCount: uniqueTexts.length,
      expectedDimensions: this.dependencies.embeddingAdapter.dimensions,
    })

    const embeddingByText = new Map(uniqueTexts.map((text, index) => [text, embeddings[index]!]))
    const timestamp = this.now().toISOString()
    let indexedCount = 0
    let unchangedCount = 0

    for (const candidate of candidates) {
      const records: CapabilityJdSignalEmbeddingRecord[] = (signalsByAnalysisId.get(candidate.analysisId) ?? []).map(
        (item) => ({
          id: this.createId(),
          analysisId: candidate.analysisId,
          signalType: item.type,
          signalIndex: item.index,
          title: item.title,
          reason: item.reason,
          contentHash: item.contentHash,
          embeddingModel: this.dependencies.embeddingAdapter.modelName,
          embedding: embeddingByText.get(item.content)!,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
      const result = await this.dependencies.repository.replaceAnalysisSignals({
        analysisId: candidate.analysisId,
        embeddingModel: this.dependencies.embeddingAdapter.modelName,
        signals: records,
      })
      if (result === 'indexed') indexedCount += 1
      else unchangedCount += 1
    }

    return { indexedCount, unchangedCount }
  }
}

let configuredIndexer: CapabilityJdSignalIndexer | null | undefined

export function getConfiguredCapabilityJdSignalIndexer() {
  if (configuredIndexer !== undefined) return configuredIndexer
  const embeddingAdapter = getConfiguredEmbeddingAdapter()
  configuredIndexer = embeddingAdapter
    ? new CapabilityJdSignalIndexer({ repository: capabilityJdSignalRepository, embeddingAdapter })
    : null
  return configuredIndexer
}

export function indexCapabilityJdSignalsInBackground(analysisId: string) {
  let indexer: CapabilityJdSignalIndexer | null
  try {
    indexer = getConfiguredCapabilityJdSignalIndexer()
  } catch (error) {
    console.error('Capability JD signal indexing configuration failed', { analysisId, error })
    return
  }
  if (!indexer) return

  const controller = new AbortController()
  void indexer.indexCompletedAnalysisFamily(analysisId, controller.signal).catch((error: unknown) => {
    console.error('Capability JD signal indexing failed', {
      analysisId,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  })
}
