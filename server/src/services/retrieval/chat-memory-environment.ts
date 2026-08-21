import { chatMemoryRepository } from '../../repositories/chat-memory.repository'
import { ChatMemoryIndexer } from './chat-memory-indexer'
import { ChatMemoryRetriever } from './chat-memory-retriever'
import { getConfiguredEmbeddingAdapter } from './embedding-environment'

type ConfiguredChatMemoryServices = {
  indexer: ChatMemoryIndexer
  retriever: ChatMemoryRetriever
}

let defaultMemoryServices: ConfiguredChatMemoryServices | null | undefined

function getConfiguredChatMemoryServices() {
  if (defaultMemoryServices !== undefined) return defaultMemoryServices

  const embeddingAdapter = getConfiguredEmbeddingAdapter()
  if (!embeddingAdapter) {
    defaultMemoryServices = null
    return defaultMemoryServices
  }
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
