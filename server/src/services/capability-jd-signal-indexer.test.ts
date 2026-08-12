import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobAnalysisResult } from '@/types/opportunity'
import type {
  CapabilityJdSignalEmbeddingRecord,
  CapabilityJdSignalIndexPersistence,
} from '../repositories/capability-jd-signal.repository'

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'

const { CapabilityJdSignalIndexer } = await import('./capability-jd-signal-indexer')

const analysisResult = {
  strengths: [
    {
      title: '前端工程化经验',
      evidenceFromJD: '岗位要求工程化能力',
      evidenceFromResume: '有 Vite 工程实践',
      level: 'high',
      reason: '具备直接项目证据',
    },
  ],
  gaps: [
    {
      title: '性能量化不足',
      evidenceFromJD: '要求首屏优化',
      level: 'medium',
      reason: '缺少量化指标',
    },
  ],
} as JobAnalysisResult

test('同结果的源分析和 follower 只请求一份去重文本，但分别持久化索引', async () => {
  const insertedByAnalysisId = new Map<string, CapabilityJdSignalEmbeddingRecord[]>()
  const repository: CapabilityJdSignalIndexPersistence = {
    async findCompletedAnalysisFamily() {
      return [
        { analysisId: 'analysis-1', result: analysisResult },
        { analysisId: 'analysis-2', result: analysisResult },
      ]
    },
    async replaceAnalysisSignals(input) {
      insertedByAnalysisId.set(input.analysisId, input.signals)
      return 'indexed'
    },
  }
  let embeddedTexts: string[] = []
  let id = 0
  const indexer = new CapabilityJdSignalIndexer({
    repository,
    embeddingAdapter: {
      modelName: 'test-embedding',
      dimensions: 4,
      async embed(input) {
        embeddedTexts = input.texts
        return input.texts.map((_, index) => [index + 1, 0, 0, 0])
      },
    },
    createId: () => `signal-${++id}`,
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  })

  const result = await indexer.indexCompletedAnalysisFamily('analysis-1', new AbortController().signal)

  assert.equal(embeddedTexts.length, 2)
  assert.equal(result.indexedCount, 2)
  assert.equal(insertedByAnalysisId.get('analysis-1')?.length, 2)
  assert.equal(insertedByAnalysisId.get('analysis-2')?.length, 2)
  assert.equal(insertedByAnalysisId.get('analysis-1')?.[0]?.embeddingModel, 'test-embedding')
})
