import { getModelErrorDetails, ModelRequestError } from '../ai/model-client'
import { RETRIEVAL_EMBEDDING_DIMENSIONS } from '@/shared/retrieval/constants'
import type { EmbeddingProviderAdapter, EmbeddingProviderInput } from './embedding-provider-adapter'

type OpenAIEmbeddingResponse = {
  data?: Array<{
    index?: unknown
    embedding?: unknown
  }>
}

export type OpenAICompatibleEmbeddingConfig = {
  baseUrl: string
  apiKey: string
  modelName: string
}

function normalizeEmbeddingBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/embeddings')) return normalized
  if (normalized.endsWith('/chat/completions')) {
    return normalized.slice(0, -'/chat/completions'.length) + '/embeddings'
  }
  return `${normalized}/embeddings`
}

function parseEmbeddingResponse(value: unknown, expectedCount: number) {
  const response = value as OpenAIEmbeddingResponse
  if (!Array.isArray(response?.data) || response.data.length !== expectedCount) {
    throw new ModelRequestError('Embedding 服务返回的向量数量不正确', 'model_request_failed', true)
  }

  const ordered = [...response.data].sort((left, right) => Number(left.index) - Number(right.index))

  return ordered.map((item, position) => {
    const index = Number(item.index)
    if (!Number.isInteger(index) || index !== position || !Array.isArray(item.embedding)) {
      throw new ModelRequestError('Embedding 服务返回了无法识别的数据结构', 'model_request_failed', true)
    }

    const embedding = item.embedding.map(Number)
    if (embedding.length !== RETRIEVAL_EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
      throw new ModelRequestError(
        `Embedding 向量必须是 ${RETRIEVAL_EMBEDDING_DIMENSIONS} 维有限数值数组`,
        'model_configuration_invalid',
        false,
      )
    }

    return embedding
  })
}

export class OpenAICompatibleEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly dimensions = RETRIEVAL_EMBEDDING_DIMENSIONS

  constructor(
    private readonly config: OpenAICompatibleEmbeddingConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.modelName.trim()) {
      throw new Error('Embedding Base URL、API Key 和模型名称不能为空')
    }
  }

  get modelName() {
    return this.config.modelName
  }

  async embed(input: EmbeddingProviderInput) {
    if (input.texts.length === 0) return []

    const response = await this.fetchImpl(normalizeEmbeddingBaseUrl(this.config.baseUrl), {
      method: 'POST',
      signal: input.signal,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.modelName,
        input: input.texts,
        dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
    })

    if (!response.ok) {
      const rawError = await response.text().catch(() => '')
      const details = getModelErrorDetails(response.status, rawError)
      throw new ModelRequestError(details.message, details.code, details.retryable, rawError)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ModelRequestError('Embedding 服务返回了无法解析的 JSON', 'model_request_failed', true)
    }

    return parseEmbeddingResponse(body, input.texts.length)
  }
}
