import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityJdSignalEmbeddingSource } from '../repositories/capability-jd-signal.repository'
import { buildCapabilityJdOverview } from './capability-jd-theme'

const currentVersionId = '00000000-0000-0000-0000-000000000001'

function signal(
  overrides: Partial<CapabilityJdSignalEmbeddingSource> & Pick<CapabilityJdSignalEmbeddingSource, 'analysisId' | 'opportunityId'>,
): CapabilityJdSignalEmbeddingSource {
  return {
    company: '示例公司',
    jobTitle: '前端工程师',
    resumeVersionId: currentVersionId,
    versionNumber: 2,
    signalType: 'strength',
    signalIndex: 0,
    title: '前端工程化经验',
    reason: '具备工程化实践。',
    contentHash: 'hash',
    embeddingModel: 'test-embedding',
    embedding: [1, 0, 0],
    ...overrides,
  }
}

test('语义相近信号跨岗位合并，优势与待补强始终隔离', () => {
  const firstOpportunityId = '00000000-0000-0000-0000-000000000011'
  const secondOpportunityId = '00000000-0000-0000-0000-000000000012'
  const thirdOpportunityId = '00000000-0000-0000-0000-000000000013'
  const overview = buildCapabilityJdOverview({
    currentVersionId,
    analyzedOpportunityIds: [firstOpportunityId, secondOpportunityId, thirdOpportunityId],
    records: [
      signal({ analysisId: 'analysis-1', opportunityId: firstOpportunityId }),
      signal({
        analysisId: 'analysis-2',
        opportunityId: secondOpportunityId,
        title: '工程化体系较完整',
        embedding: [0.99, 0.08, 0],
      }),
      signal({
        analysisId: 'analysis-3',
        opportunityId: thirdOpportunityId,
        title: '业务沟通经验',
        embedding: [0, 1, 0],
      }),
      signal({
        analysisId: 'analysis-4',
        opportunityId: firstOpportunityId,
        signalType: 'gap',
        title: '工程化深度不足',
        embedding: [1, 0, 0],
      }),
      signal({
        analysisId: 'analysis-5',
        opportunityId: secondOpportunityId,
        signalType: 'gap',
        title: '工程化量化证据不足',
        embedding: [0.99, 0.08, 0],
      }),
    ],
  })

  assert.equal(overview.indexingStatus, 'ready')
  assert.equal(overview.strengthThemes.length, 1)
  assert.equal(overview.strengthThemes[0]?.opportunityCount, 2)
  assert.equal(overview.gapThemes.length, 1)
  assert.equal(overview.gapThemes[0]?.opportunityCount, 2)
  assert.equal(overview.strengthThemes[0]?.type, 'strength')
  assert.equal(overview.gapThemes[0]?.type, 'gap')
})

test('同一岗位在同一主题中只计数一次，只有历史版本时标记待重新验证', () => {
  const opportunityId = '00000000-0000-0000-0000-000000000011'
  const historicalVersionId = '00000000-0000-0000-0000-000000000002'
  const overview = buildCapabilityJdOverview({
    currentVersionId,
    analyzedOpportunityIds: [opportunityId],
    records: [
      signal({
        analysisId: 'analysis-1',
        opportunityId,
        resumeVersionId: historicalVersionId,
        versionNumber: 1,
      }),
      signal({
        analysisId: 'analysis-1',
        opportunityId,
        resumeVersionId: historicalVersionId,
        versionNumber: 1,
        signalIndex: 1,
        title: '工程化实践完善',
        embedding: [0.99, 0.05, 0],
      }),
    ],
  })

  assert.equal(overview.strengthThemes[0]?.opportunityCount, 1)
  assert.equal(overview.strengthThemes[0]?.historicalVersionCount, 1)
  assert.equal(overview.strengthThemes[0]?.needsRevalidation, true)
})

test('标题仅有空格和标点差异时先确定性合并，不受 JD 证据向量偏移影响', () => {
  const firstOpportunityId = '00000000-0000-0000-0000-000000000021'
  const secondOpportunityId = '00000000-0000-0000-0000-000000000022'
  const overview = buildCapabilityJdOverview({
    currentVersionId,
    analyzedOpportunityIds: [firstOpportunityId, secondOpportunityId],
    records: [
      signal({
        analysisId: 'analysis-title-1',
        opportunityId: firstOpportunityId,
        title: 'AI 辅助开发实践',
        embedding: [1, 0, 0],
      }),
      signal({
        analysisId: 'analysis-title-2',
        opportunityId: secondOpportunityId,
        title: 'AI辅助开发实践',
        embedding: [0, 1, 0],
      }),
    ],
  })

  assert.equal(overview.strengthThemes.length, 1)
  assert.equal(overview.strengthThemes[0]?.opportunityCount, 2)
})
