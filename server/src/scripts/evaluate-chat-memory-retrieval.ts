import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ChatMemoryRetrievalPersistence } from '../repositories/chat-memory.repository'
import { ChatMemoryRetriever } from '../services/retrieval/chat-memory-retriever'
import type { EmbeddingProviderAdapter } from '../services/retrieval/embedding-provider-adapter'
import { OpenAICompatibleEmbeddingAdapter } from '../services/retrieval/openai-compatible-embedding-adapter'
import {
  RAG_EVALUATION_CASES,
  RAG_EVALUATION_DOCUMENTS,
  RAG_EVALUATION_OTHER_USER_DOCUMENT_ID,
  type RagEvaluationDocument,
} from '../services/retrieval/rag-evaluation-cases'
import {
  aggregateRagEvaluation,
  decideRerankNeed,
  evaluateRagCase,
  selectBestRagConfiguration,
  type RagEvaluationConfigurationReport,
} from '../services/retrieval/rag-evaluation'
import { canRetrieveDocument } from '../services/retrieval/retrieval-scope'
import type { RetrievalResult, RetrievalScope } from '../services/retrieval/retrieval-types'

type EmbeddedEvaluationDocument = RagEvaluationDocument & {
  embedding: number[]
}

type EvaluationConfiguration = {
  limit: number
  minScore: number
}

const CURRENT_CONFIGURATION: EvaluationConfiguration = { limit: 5, minScore: 0.55 }
const CANDIDATE_POOL_CONFIGURATION: EvaluationConfiguration = { limit: 15, minScore: -1 }
const CONFIGURATION_GRID: EvaluationConfiguration[] = [3, 5].flatMap((limit) =>
  [0.45, 0.5, 0.55, 0.6, 0.65].map((minScore) => ({ limit, minScore })),
)

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`运行 RAG 评测前必须配置 ${name}`)
  return value
}

function resolveOutputPath() {
  const outputIndex = process.argv.indexOf('--output')
  const requestedPath = outputIndex === -1 ? undefined : process.argv[outputIndex + 1]
  return resolve(process.cwd(), requestedPath ?? 'server/reports/rag-evaluation-latest.json')
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) throw new TypeError('待比较的向量维度不一致')

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dotProduct += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

async function embedTexts(input: {
  adapter: EmbeddingProviderAdapter
  texts: string[]
  batchSize: number
  signal: AbortSignal
}) {
  const embeddingByText = new Map<string, number[]>()

  for (let start = 0; start < input.texts.length; start += input.batchSize) {
    const batch = input.texts.slice(start, start + input.batchSize)
    const embeddings = await input.adapter.embed({ texts: batch, signal: input.signal })
    batch.forEach((text, index) => {
      const embedding = embeddings[index]
      if (!embedding) throw new Error(`Embedding 批次缺少第 ${index} 条向量`)
      embeddingByText.set(text, embedding)
    })
  }

  return embeddingByText
}

function createCachedEmbeddingAdapter(
  source: EmbeddingProviderAdapter,
  embeddingByText: ReadonlyMap<string, number[]>,
): EmbeddingProviderAdapter {
  return {
    modelName: source.modelName,
    dimensions: source.dimensions,
    async embed(input) {
      return input.texts.map((text) => {
        const embedding = embeddingByText.get(text)
        if (!embedding) throw new Error(`固定评测集中缺少文本的预生成向量：${text}`)
        return embedding
      })
    },
  }
}

class InMemoryEvaluationRepository implements ChatMemoryRetrievalPersistence {
  constructor(private readonly documents: EmbeddedEvaluationDocument[]) {}

  async searchSimilarDocuments(input: {
    queryEmbedding: number[]
    embeddingModel: string
    scope: RetrievalScope
    limit: number
    minScore: number
  }): Promise<RetrievalResult[]> {
    return this.documents
      .filter((document) => canRetrieveDocument(input.scope, document))
      .map((document) => ({
        documentId: document.id,
        conversationId: document.conversationId,
        runId: document.runId,
        content: document.content,
        score: cosineSimilarity(input.queryEmbedding, document.embedding),
        scope: document.scope,
      }))
      .filter((result) => result.score >= input.minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit)
  }
}

function countScopeViolations(
  results: RetrievalResult[],
  scope: RetrievalScope,
  documentsById: Map<string, RagEvaluationDocument>,
) {
  return results.reduce((count, result) => {
    const document = documentsById.get(result.documentId)
    return count + (document && canRetrieveDocument(scope, document) ? 0 : 1)
  }, 0)
}

async function evaluateConfiguration(input: {
  configuration: EvaluationConfiguration
  retriever: ChatMemoryRetriever
  documentsById: Map<string, RagEvaluationDocument>
  signal: AbortSignal
}): Promise<RagEvaluationConfigurationReport> {
  const resultsByCase: RetrievalResult[][] = []
  let scopeViolationCount = 0

  for (const testCase of RAG_EVALUATION_CASES) {
    const results = await input.retriever.retrieve({
      queryText: testCase.queryText,
      scope: testCase.scope,
      signal: input.signal,
      ...input.configuration,
    })
    resultsByCase.push(results)
    scopeViolationCount += countScopeViolations(results, testCase.scope, input.documentsById)
  }

  const cases = RAG_EVALUATION_CASES.map((testCase, index) =>
    evaluateRagCase(
      {
        ...testCase,
        forbiddenDocumentIds: [
          ...new Set([...(testCase.forbiddenDocumentIds ?? []), RAG_EVALUATION_OTHER_USER_DOCUMENT_ID]),
        ],
      },
      resultsByCase[index] ?? [],
    ),
  )

  return {
    ...input.configuration,
    metrics: aggregateRagEvaluation(cases, resultsByCase, scopeViolationCount),
    cases,
  }
}

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

async function main() {
  const controller = new AbortController()
  const sourceAdapter = new OpenAICompatibleEmbeddingAdapter({
    baseUrl: requireEnvironment('EMBEDDING_BASE_URL'),
    apiKey: requireEnvironment('EMBEDDING_API_KEY'),
    modelName: requireEnvironment('EMBEDDING_MODEL'),
  })
  const configuredBatchSize = Number(process.env.RAG_EVAL_EMBEDDING_BATCH_SIZE ?? 8)
  const batchSize = Number.isInteger(configuredBatchSize) && configuredBatchSize > 0 ? configuredBatchSize : 8
  const uniqueTexts = [
    ...new Set([
      ...RAG_EVALUATION_DOCUMENTS.map((document) => document.content),
      ...RAG_EVALUATION_CASES.map((testCase) => testCase.queryText),
    ]),
  ]
  const embeddingStartedAt = performance.now()
  const embeddingByText = await embedTexts({
    adapter: sourceAdapter,
    texts: uniqueTexts,
    batchSize,
    signal: controller.signal,
  })
  const embeddingDurationMs = Math.round(performance.now() - embeddingStartedAt)
  const embeddedDocuments = RAG_EVALUATION_DOCUMENTS.map((document) => ({
    ...document,
    embedding: embeddingByText.get(document.content)!,
  }))
  const documentsById = new Map(RAG_EVALUATION_DOCUMENTS.map((document) => [document.id, document]))
  const retriever = new ChatMemoryRetriever({
    repository: new InMemoryEvaluationRepository(embeddedDocuments),
    embeddingAdapter: createCachedEmbeddingAdapter(sourceAdapter, embeddingByText),
  })

  const reports: RagEvaluationConfigurationReport[] = []
  for (const configuration of CONFIGURATION_GRID) {
    reports.push(await evaluateConfiguration({ configuration, retriever, documentsById, signal: controller.signal }))
  }
  const current = reports.find(
    (report) => report.limit === CURRENT_CONFIGURATION.limit && report.minScore === CURRENT_CONFIGURATION.minScore,
  )
  if (!current) throw new Error('固定参数网格中缺少当前生产配置')

  const candidatePool = await evaluateConfiguration({
    configuration: CANDIDATE_POOL_CONFIGURATION,
    retriever,
    documentsById,
    signal: controller.signal,
  })
  const best = selectBestRagConfiguration(reports)
  const decision = decideRerankNeed({ current, best, candidatePool })
  const report = {
    generatedAt: new Date().toISOString(),
    embedding: {
      model: sourceAdapter.modelName,
      dimensions: sourceAdapter.dimensions,
      batchSize,
      durationMs: embeddingDurationMs,
    },
    fixture: {
      documentCount: RAG_EVALUATION_DOCUMENTS.length,
      caseCount: RAG_EVALUATION_CASES.length,
    },
    current,
    best,
    candidatePool,
    configurations: reports,
    decision,
  }
  const outputPath = resolveOutputPath()
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.table(
    reports.map(({ limit, minScore, metrics }) => ({
      limit,
      minScore,
      hitRate: percentage(metrics.hitRate),
      recall: percentage(metrics.recall),
      mrr: metrics.mrr.toFixed(3),
      ndcg: metrics.ndcg.toFixed(3),
      top1: percentage(metrics.top1Accuracy),
      forbidden: metrics.forbiddenHitCount,
      scopeViolations: metrics.scopeViolationCount,
    })),
  )
  console.log(`RAG 结论：${decision.outcome} - ${decision.reason}`)
  console.log(`推荐参数：Top-K=${decision.recommendedLimit}, minScore=${decision.recommendedMinScore}`)
  console.log(`完整报告：${outputPath}`)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`RAG 评测失败：${message}`)
  process.exitCode = 1
})
