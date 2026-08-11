import type { RetrievalResult } from './retrieval-types'

export type RagEvaluationCase = {
  id: string
  queryText: string
  expectedDocumentIds: string[]
  forbiddenDocumentIds?: string[]
}

export type RagEvaluationCaseResult = {
  caseId: string
  queryText: string
  expectedDocumentIds: string[]
  rankedDocumentIds: string[]
  relevantDocumentIds: string[]
  forbiddenDocumentIds: string[]
  recall: number
  precisionAtExpectedCount: number
  reciprocalRank: number
  ndcg: number
  top1Correct: boolean
  forbiddenHitCount: number
}

export type RagEvaluationMetrics = {
  caseCount: number
  hitRate: number
  recall: number
  precisionAtExpectedCount: number
  mrr: number
  ndcg: number
  top1Accuracy: number
  forbiddenHitCount: number
  scopeViolationCount: number
  averageResultCount: number
}

export type RagEvaluationConfigurationReport = {
  limit: number
  minScore: number
  metrics: RagEvaluationMetrics
  cases: RagEvaluationCaseResult[]
}

export type RagRerankDecision = {
  outcome: 'not_needed' | 'consider_rerank' | 'fix_retrieval' | 'fix_scope'
  reason: string
  recommendedLimit: number
  recommendedMinScore: number
}

const QUALITY_TARGETS = {
  hitRate: 0.9,
  recall: 0.85,
  mrr: 0.85,
  ndcg: 0.85,
  top1Accuracy: 0.8,
} as const

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function discountedCumulativeGain(relevance: number[]) {
  return relevance.reduce((sum, value, index) => sum + value / Math.log2(index + 2), 0)
}

export function evaluateRagCase(testCase: RagEvaluationCase, results: RetrievalResult[]): RagEvaluationCaseResult {
  if (testCase.expectedDocumentIds.length === 0) {
    throw new TypeError(`RAG 评测用例 ${testCase.id} 必须至少声明一条期望记忆`)
  }

  const expectedIds = new Set(testCase.expectedDocumentIds)
  const forbiddenIds = new Set(testCase.forbiddenDocumentIds ?? [])
  const rankedDocumentIds = results.map((result) => result.documentId)
  const relevantDocumentIds = rankedDocumentIds.filter((documentId) => expectedIds.has(documentId))
  const firstRelevantIndex = rankedDocumentIds.findIndex((documentId) => expectedIds.has(documentId))
  const precisionWindow = rankedDocumentIds.slice(0, testCase.expectedDocumentIds.length)
  const relevance = rankedDocumentIds.map((documentId) => (expectedIds.has(documentId) ? 1 : 0))
  const idealRelevance = Array.from(
    { length: Math.min(testCase.expectedDocumentIds.length, rankedDocumentIds.length) },
    () => 1,
  )
  const idealDcg = discountedCumulativeGain(idealRelevance)

  return {
    caseId: testCase.id,
    queryText: testCase.queryText,
    expectedDocumentIds: testCase.expectedDocumentIds,
    rankedDocumentIds,
    relevantDocumentIds,
    forbiddenDocumentIds: rankedDocumentIds.filter((documentId) => forbiddenIds.has(documentId)),
    recall: relevantDocumentIds.length / testCase.expectedDocumentIds.length,
    precisionAtExpectedCount:
      precisionWindow.filter((documentId) => expectedIds.has(documentId)).length / testCase.expectedDocumentIds.length,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcg: idealDcg === 0 ? 0 : discountedCumulativeGain(relevance) / idealDcg,
    top1Correct: rankedDocumentIds.length > 0 && expectedIds.has(rankedDocumentIds[0]!),
    forbiddenHitCount: rankedDocumentIds.filter((documentId) => forbiddenIds.has(documentId)).length,
  }
}

export function aggregateRagEvaluation(
  caseResults: RagEvaluationCaseResult[],
  resultsByCase: RetrievalResult[][],
  scopeViolationCount: number,
): RagEvaluationMetrics {
  if (caseResults.length !== resultsByCase.length) {
    throw new TypeError('RAG 评测用例结果和检索结果数量不一致')
  }

  return {
    caseCount: caseResults.length,
    hitRate: average(caseResults.map((result) => (result.relevantDocumentIds.length > 0 ? 1 : 0))),
    recall: average(caseResults.map((result) => result.recall)),
    precisionAtExpectedCount: average(caseResults.map((result) => result.precisionAtExpectedCount)),
    mrr: average(caseResults.map((result) => result.reciprocalRank)),
    ndcg: average(caseResults.map((result) => result.ndcg)),
    top1Accuracy: average(caseResults.map((result) => (result.top1Correct ? 1 : 0))),
    forbiddenHitCount: caseResults.reduce((sum, result) => sum + result.forbiddenHitCount, 0),
    scopeViolationCount,
    averageResultCount: average(resultsByCase.map((results) => results.length)),
  }
}

function qualityScore(report: RagEvaluationConfigurationReport) {
  const { metrics } = report
  return (
    metrics.recall * 0.3 +
    metrics.mrr * 0.25 +
    metrics.ndcg * 0.2 +
    metrics.hitRate * 0.15 +
    metrics.top1Accuracy * 0.1 -
    metrics.averageResultCount * 0.001
  )
}

export function selectBestRagConfiguration(reports: RagEvaluationConfigurationReport[]) {
  const safeReports = reports.filter(
    (report) => report.metrics.scopeViolationCount === 0 && report.metrics.forbiddenHitCount === 0,
  )
  if (safeReports.length === 0) return null

  return [...safeReports].sort((left, right) => qualityScore(right) - qualityScore(left))[0] ?? null
}

function meetsQualityTargets(metrics: RagEvaluationMetrics) {
  return (
    metrics.hitRate >= QUALITY_TARGETS.hitRate &&
    metrics.recall >= QUALITY_TARGETS.recall &&
    metrics.mrr >= QUALITY_TARGETS.mrr &&
    metrics.ndcg >= QUALITY_TARGETS.ndcg &&
    metrics.top1Accuracy >= QUALITY_TARGETS.top1Accuracy
  )
}

export function decideRerankNeed(input: {
  current: RagEvaluationConfigurationReport
  best: RagEvaluationConfigurationReport | null
  candidatePool: RagEvaluationConfigurationReport
}): RagRerankDecision {
  const recommended = input.best ?? input.current
  const allReports = [input.current, input.candidatePool, ...(input.best ? [input.best] : [])]
  if (allReports.some((report) => report.metrics.scopeViolationCount > 0 || report.metrics.forbiddenHitCount > 0)) {
    return {
      outcome: 'fix_scope',
      reason: '评测发现越权或明确禁止的记忆进入结果，必须先修复确定性数据边界，不能使用 Rerank 掩盖。',
      recommendedLimit: recommended.limit,
      recommendedMinScore: recommended.minScore,
    }
  }

  if (input.best && meetsQualityTargets(input.best.metrics)) {
    return {
      outcome: 'not_needed',
      reason: '无需增加第二个模型阶段，现有向量检索通过参数调整已经达到第一版质量目标。',
      recommendedLimit: input.best.limit,
      recommendedMinScore: input.best.minScore,
    }
  }

  if (
    input.candidatePool.metrics.hitRate < QUALITY_TARGETS.hitRate ||
    input.candidatePool.metrics.recall < QUALITY_TARGETS.recall
  ) {
    return {
      outcome: 'fix_retrieval',
      reason: '扩大候选池后仍找不到足够多的正确记忆，Rerank 无法重排不存在的候选，应先优化切分、查询构造或 Embedding。',
      recommendedLimit: recommended.limit,
      recommendedMinScore: recommended.minScore,
    }
  }

  return {
    outcome: 'consider_rerank',
    reason: '正确记忆大多已进入候选池，但当前 Top-K 排名质量未达到目标，可以用 Rerank 重新排序候选。',
    recommendedLimit: recommended.limit,
    recommendedMinScore: recommended.minScore,
  }
}
