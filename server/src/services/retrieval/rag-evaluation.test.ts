import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RAG_EVALUATION_CASES, RAG_EVALUATION_DOCUMENTS } from './rag-evaluation-cases'
import {
  aggregateRagEvaluation,
  decideRerankNeed,
  evaluateRagCase,
  type RagEvaluationConfigurationReport,
  type RagEvaluationMetrics,
} from './rag-evaluation'
import type { RetrievalResult } from './retrieval-types'

function result(documentId: string): RetrievalResult {
  return {
    documentId,
    conversationId: `conversation-${documentId}`,
    runId: `run-${documentId}`,
    content: documentId,
    score: 0.9,
    scope: { type: 'global' },
  }
}

function metrics(overrides: Partial<RagEvaluationMetrics> = {}): RagEvaluationMetrics {
  return {
    caseCount: 10,
    hitRate: 0.95,
    recall: 0.9,
    precisionAtExpectedCount: 0.85,
    mrr: 0.9,
    ndcg: 0.9,
    top1Accuracy: 0.85,
    forbiddenHitCount: 0,
    scopeViolationCount: 0,
    averageResultCount: 5,
    ...overrides,
  }
}

function report(value: RagEvaluationMetrics, limit = 5, minScore = 0.55): RagEvaluationConfigurationReport {
  return { limit, minScore, metrics: value, cases: [] }
}

describe('RAG evaluation fixtures', () => {
  it('contains a stable, internally consistent evaluation set', () => {
    assert.ok(RAG_EVALUATION_DOCUMENTS.length >= 30)
    assert.ok(RAG_EVALUATION_CASES.length >= 30)

    const documentIds = RAG_EVALUATION_DOCUMENTS.map((document) => document.id)
    const caseIds = RAG_EVALUATION_CASES.map((testCase) => testCase.id)
    assert.equal(new Set(documentIds).size, documentIds.length)
    assert.equal(new Set(caseIds).size, caseIds.length)

    const knownDocumentIds = new Set(documentIds)
    for (const testCase of RAG_EVALUATION_CASES) {
      assert.ok(testCase.expectedDocumentIds.length > 0)
      testCase.expectedDocumentIds.forEach((documentId) => assert.ok(knownDocumentIds.has(documentId)))
      testCase.forbiddenDocumentIds?.forEach((documentId) => assert.ok(knownDocumentIds.has(documentId)))
    }
  })
})

describe('RAG evaluation metrics', () => {
  it('calculates ranking metrics and forbidden hits from the actual order', () => {
    const caseResult = evaluateRagCase(
      {
        id: 'ranking-case',
        queryText: 'query',
        expectedDocumentIds: ['expected-a', 'expected-b'],
        forbiddenDocumentIds: ['forbidden'],
      },
      [result('irrelevant'), result('expected-a'), result('forbidden'), result('expected-b')],
    )

    assert.equal(caseResult.recall, 1)
    assert.equal(caseResult.precisionAtExpectedCount, 0.5)
    assert.equal(caseResult.reciprocalRank, 0.5)
    assert.equal(caseResult.top1Correct, false)
    assert.equal(caseResult.forbiddenHitCount, 1)
    assert.ok(caseResult.ndcg > 0 && caseResult.ndcg < 1)
  })

  it('aggregates online-style retrieval metrics without hiding scope violations', () => {
    const first = evaluateRagCase({ id: 'first', queryText: 'first', expectedDocumentIds: ['a'] }, [
      result('a'),
      result('x'),
    ])
    const second = evaluateRagCase({ id: 'second', queryText: 'second', expectedDocumentIds: ['b'] }, [result('x')])
    const aggregated = aggregateRagEvaluation([first, second], [[result('a'), result('x')], [result('x')]], 1)

    assert.equal(aggregated.caseCount, 2)
    assert.equal(aggregated.hitRate, 0.5)
    assert.equal(aggregated.recall, 0.5)
    assert.equal(aggregated.scopeViolationCount, 1)
    assert.equal(aggregated.averageResultCount, 1.5)
  })
})

describe('Rerank decision', () => {
  it('does not add Rerank when parameter tuning already reaches the quality target', () => {
    const current = report(metrics({ mrr: 0.8 }))
    const best = report(metrics(), 3, 0.5)
    const candidatePool = report(metrics({ recall: 1, hitRate: 1 }), 15, -1)

    assert.deepEqual(decideRerankNeed({ current, best, candidatePool }), {
      outcome: 'not_needed',
      reason: '无需增加第二个模型阶段，现有向量检索通过参数调整已经达到第一版质量目标。',
      recommendedLimit: 3,
      recommendedMinScore: 0.5,
    })
  })

  it('recommends Rerank only when correct candidates exist but their order is weak', () => {
    const weakRanking = metrics({ mrr: 0.6, ndcg: 0.65, top1Accuracy: 0.5 })
    const candidatePool = report(metrics({ recall: 0.95, hitRate: 0.95 }), 15, -1)
    const decision = decideRerankNeed({ current: report(weakRanking), best: report(weakRanking), candidatePool })

    assert.equal(decision.outcome, 'consider_rerank')
  })

  it('does not use Rerank to compensate for missing candidates', () => {
    const weak = metrics({ recall: 0.6, hitRate: 0.7, mrr: 0.6, ndcg: 0.6, top1Accuracy: 0.5 })
    const decision = decideRerankNeed({
      current: report(weak),
      best: report(weak),
      candidatePool: report(weak, 15, -1),
    })

    assert.equal(decision.outcome, 'fix_retrieval')
  })

  it('treats a scope leak as a correctness failure before ranking quality', () => {
    const unsafe = metrics({ scopeViolationCount: 1 })
    const decision = decideRerankNeed({
      current: report(unsafe),
      best: null,
      candidatePool: report(metrics(), 15, -1),
    })

    assert.equal(decision.outcome, 'fix_scope')
  })
})
