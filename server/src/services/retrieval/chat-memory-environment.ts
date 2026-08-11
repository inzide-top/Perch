import { chatMemoryRepository } from '../../repositories/chat-memory.repository'
import { ChatMemoryIndexer } from './chat-memory-indexer'
import { ChatMemoryRetriever } from './chat-memory-retriever'
import { OpenAICompatibleEmbeddingAdapter } from './openai-compatible-embedding-adapter'

type ConfiguredChatMemoryServices = {
  indexer: ChatMemoryIndexer
  retriever: ChatMemoryRetriever
}

let defaultMemoryServices: ConfiguredChatMemoryServices | null | undefined

function getConfiguredChatMemoryServices() {
  if (defaultMemoryServices !== undefined) return defaultMemoryServices

  const baseUrl = process.env.EMBEDDING_BASE_URL?.trim() ?? ''
  const apiKey = process.env.EMBEDDING_API_KEY?.trim() ?? ''
  const modelName = process.env.EMBEDDING_MODEL?.trim() ?? ''
  if (!baseUrl && !apiKey && !modelName) {
    defaultMemoryServices = null
    return defaultMemoryServices
  }
  if (!baseUrl || !apiKey || !modelName) {
    throw new Error('Embedding 配置不完整，请同时设置 EMBEDDING_BASE_URL、EMBEDDING_API_KEY 和 EMBEDDING_MODEL')
  }

  const embeddingAdapter = new OpenAICompatibleEmbeddingAdapter({ baseUrl, apiKey, modelName })
  defaultMemoryServices = {
    indexer: new ChatMemoryIndexer({ repository: chatMemoryRepository, embeddingAdapter }),
    retriever: new ChatMemoryRetriever({ repository: chatMemoryRepository, embeddingAdapter }),
  }
  return defaultMemoryServices
}

export function getConfiguredChatMemoryIndexer() {
  return getConfiguredChatMemoryServices()?.indexer ?? null
}

export function getConfiguredChatMemoryRetriever() {
  return getConfiguredChatMemoryServices()?.retriever ?? null
}
