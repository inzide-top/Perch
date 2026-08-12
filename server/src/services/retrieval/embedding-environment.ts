import { OpenAICompatibleEmbeddingAdapter } from './openai-compatible-embedding-adapter'

let configuredEmbeddingAdapter: OpenAICompatibleEmbeddingAdapter | null | undefined

/**
 * Chat RAG 与能力画像共用同一个稳定的 Embedding 空间，避免相同语义被不同模型编码后无法比较。
 */
export function getConfiguredEmbeddingAdapter() {
  if (configuredEmbeddingAdapter !== undefined) return configuredEmbeddingAdapter

  const baseUrl = process.env.EMBEDDING_BASE_URL?.trim() ?? ''
  const apiKey = process.env.EMBEDDING_API_KEY?.trim() ?? ''
  const modelName = process.env.EMBEDDING_MODEL?.trim() ?? ''
  if (!baseUrl && !apiKey && !modelName) {
    configuredEmbeddingAdapter = null
    return configuredEmbeddingAdapter
  }
  if (!baseUrl || !apiKey || !modelName) {
    throw new Error('Embedding 配置不完整，请同时设置 EMBEDDING_BASE_URL、EMBEDDING_API_KEY 和 EMBEDDING_MODEL')
  }

  configuredEmbeddingAdapter = new OpenAICompatibleEmbeddingAdapter({ baseUrl, apiKey, modelName })
  return configuredEmbeddingAdapter
}
