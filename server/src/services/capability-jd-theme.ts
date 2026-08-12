import { createHash } from 'node:crypto'
import type { CapabilityJdOverview, CapabilityJdTheme, CapabilityJdThemeSource } from '@/types/capability'
import type { CapabilityJdSignalEmbeddingSource } from '../repositories/capability-jd-signal.repository'

const semanticSimilarityThreshold = 0.82

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return -1
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function createCentroid(items: CapabilityJdSignalEmbeddingSource[]) {
  const dimensions = items[0]?.embedding.length ?? 0
  const centroid = Array.from({ length: dimensions }, () => 0)
  items.forEach((item) => item.embedding.forEach((value, index) => (centroid[index] = centroid[index]! + value)))
  return centroid.map((value) => value / items.length)
}

function normalizeThemeTitle(title: string) {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，,。.、·:：;；/\\_—-]+/g, '')
}

function selectMedoid(items: CapabilityJdSignalEmbeddingSource[]) {
  if (items.length <= 1) return items[0]!
  return items
    .map((candidate) => ({
      candidate,
      averageSimilarity:
        items.reduce((total, item) => total + cosineSimilarity(candidate.embedding, item.embedding), 0) / items.length,
    }))
    .sort(
      (left, right) =>
        right.averageSimilarity - left.averageSimilarity ||
        left.candidate.title.localeCompare(right.candidate.title, 'zh-CN'),
    )[0]!.candidate
}

function toTheme(
  items: CapabilityJdSignalEmbeddingSource[],
  currentVersionId: string,
  totalOpportunityCount: number,
): CapabilityJdTheme {
  const medoid = selectMedoid(items)
  const uniqueSources = [
    ...new Map(
      [...items]
        .sort((left, right) => {
          const leftCurrent = left.resumeVersionId === currentVersionId ? 1 : 0
          const rightCurrent = right.resumeVersionId === currentVersionId ? 1 : 0
          return rightCurrent - leftCurrent || left.company.localeCompare(right.company, 'zh-CN')
        })
        .map((item) => [item.opportunityId, item]),
    ).values(),
  ]
  const sources: CapabilityJdThemeSource[] = uniqueSources.map((item) => ({
    opportunityId: item.opportunityId,
    company: item.company,
    jobTitle: item.jobTitle,
    resumeVersionId: item.resumeVersionId,
    versionNumber: item.versionNumber,
    isCurrentVersion: item.resumeVersionId === currentVersionId,
    originalTitle: item.title,
    reason: item.reason,
  }))
  const currentVersionCount = sources.filter((source) => source.isCurrentVersion).length
  const historicalVersionCount = sources.length - currentVersionCount
  const themeKey = createHash('sha256')
    .update(
      items
        .map((item) => `${item.analysisId}:${item.signalType}:${item.signalIndex}`)
        .sort()
        .join('|'),
    )
    .digest('hex')
    .slice(0, 16)

  return {
    themeKey,
    label: medoid.title,
    type: medoid.signalType,
    opportunityCount: sources.length,
    totalOpportunityCount,
    frequencyRatio: totalOpportunityCount === 0 ? 0 : sources.length / totalOpportunityCount,
    currentVersionCount,
    historicalVersionCount,
    needsRevalidation: currentVersionCount === 0 && historicalVersionCount > 0,
    sources,
  }
}

function clusterSignals(input: {
  records: CapabilityJdSignalEmbeddingSource[]
  type: 'strength' | 'gap'
  currentVersionId: string
  totalOpportunityCount: number
}) {
  const records = input.records
    .filter((record) => record.signalType === input.type)
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title, 'zh-CN') ||
        left.opportunityId.localeCompare(right.opportunityId) ||
        left.signalIndex - right.signalIndex,
    )

  const recordsByNormalizedTitle = new Map<string, CapabilityJdSignalEmbeddingSource[]>()
  records.forEach((record) => {
    const normalizedTitle = normalizeThemeTitle(record.title)
    recordsByNormalizedTitle.set(normalizedTitle, [
      ...(recordsByNormalizedTitle.get(normalizedTitle) ?? []),
      record,
    ])
  })
  const exactTitleGroups = [...recordsByNormalizedTitle.values()].map((items) => ({
    items,
    centroid: createCentroid(items),
  }))
  const clusters: Array<{ items: CapabilityJdSignalEmbeddingSource[]; centroid: number[] }> = []

  for (const titleGroup of exactTitleGroups) {
    let bestCluster: (typeof clusters)[number] | null = null
    let bestScore = semanticSimilarityThreshold
    for (const cluster of clusters) {
      const score = cosineSimilarity(titleGroup.centroid, cluster.centroid)
      if (score >= bestScore) {
        bestCluster = cluster
        bestScore = score
      }
    }

    if (!bestCluster) {
      clusters.push(titleGroup)
      continue
    }
    bestCluster.items.push(...titleGroup.items)
    bestCluster.centroid = createCentroid(bestCluster.items)
  }

  const themes = clusters.map((cluster) =>
    toTheme(cluster.items, input.currentVersionId, input.totalOpportunityCount),
  )
  const recurringThemes =
    input.totalOpportunityCount > 1 ? themes.filter((theme) => theme.opportunityCount >= 2) : themes

  return recurringThemes.sort(
    (left, right) =>
      right.opportunityCount - left.opportunityCount ||
      right.currentVersionCount - left.currentVersionCount ||
      left.label.localeCompare(right.label, 'zh-CN'),
  )
}

export function buildCapabilityJdOverview(input: {
  records: CapabilityJdSignalEmbeddingSource[]
  analyzedOpportunityIds: string[]
  currentVersionId: string
}): CapabilityJdOverview {
  const analyzedOpportunityCount = new Set(input.analyzedOpportunityIds).size
  const indexedOpportunityCount = new Set(input.records.map((record) => record.opportunityId)).size
  const indexingStatus =
    analyzedOpportunityCount === 0 || indexedOpportunityCount === analyzedOpportunityCount
      ? 'ready'
      : indexedOpportunityCount === 0
        ? 'indexing'
        : 'partial'

  return {
    indexingStatus,
    analyzedOpportunityCount,
    indexedOpportunityCount,
    strengthThemes: clusterSignals({
      records: input.records,
      type: 'strength',
      currentVersionId: input.currentVersionId,
      totalOpportunityCount: analyzedOpportunityCount,
    }),
    gapThemes: clusterSignals({
      records: input.records,
      type: 'gap',
      currentVersionId: input.currentVersionId,
      totalOpportunityCount: analyzedOpportunityCount,
    }),
  }
}
