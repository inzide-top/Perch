import type {
  ChatMemoryCompensationCursor,
  ChatMemoryCompensationPersistence,
} from '../../repositories/chat-memory.repository'
import { toUserVisibleChatText } from '@/shared/chat/user-visible-text'
import type { ChatJsonObject, ChatMessagePart } from '@/shared/chat/schemas'
import type { ChatMemoryIndexer } from './chat-memory-indexer'
import { collectChatMemoryOpportunityIds } from './chat-memory-opportunity-ids'

export type ChatMemoryCompensationResult = {
  examinedCount: number
  indexedCount: number
  skippedCount: number
  failedCount: number
  nextCursor: ChatMemoryCompensationCursor | null
}

type ChatMemoryCompensationDependencies = {
  repository: ChatMemoryCompensationPersistence
  indexer: Pick<ChatMemoryIndexer, 'indexCompletedTurn'>
  batchSize?: number
  maxBatchesPerScan?: number
  logError?: (error: unknown, context: { runId: string }) => void
}

function readUserText(input: ChatJsonObject) {
  return typeof input.text === 'string' ? input.text.trim() : ''
}

function readAssistantText(parts: ChatMessagePart[]) {
  return toUserVisibleChatText(
    parts
      .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  ).trim()
}

function readReferencedOpportunityIds(input: ChatJsonObject) {
  if (!Array.isArray(input.references)) return []

  return input.references.flatMap((reference) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return []
    const record = reference as Record<string, unknown>
    return record.type === 'opportunity' && typeof record.id === 'string' ? [record.id] : []
  })
}

export class ChatMemoryCompensationScanner {
  private cursor: ChatMemoryCompensationCursor | null = null
  private readonly batchSize: number
  private readonly maxBatchesPerScan: number

  constructor(private readonly dependencies: ChatMemoryCompensationDependencies) {
    this.batchSize = dependencies.batchSize ?? 20
    this.maxBatchesPerScan = dependencies.maxBatchesPerScan ?? 3
  }

  async scanOnce(signal: AbortSignal): Promise<ChatMemoryCompensationResult> {
    const result: ChatMemoryCompensationResult = {
      examinedCount: 0,
      indexedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      nextCursor: this.cursor,
    }

    for (let batchNumber = 0; batchNumber < this.maxBatchesPerScan && !signal.aborted; batchNumber += 1) {
      const candidates = await this.dependencies.repository.listUnindexedCompletedRuns({
        cursor: this.cursor,
        limit: this.batchSize,
      })
      if (candidates.length === 0) break

      for (const candidate of candidates) {
        if (signal.aborted) break

        this.cursor = candidate.cursor
        result.nextCursor = candidate.cursor
        result.examinedCount += 1

        try {
          const userText = readUserText(candidate.runInput)
          const assistantText = readAssistantText(candidate.assistantParts)
          const relatedOpportunityIds = collectChatMemoryOpportunityIds(candidate.toolInputs, [
            ...readReferencedOpportunityIds(candidate.runInput),
          ])
          const indexed = await this.dependencies.indexer.indexCompletedTurn({
            userId: candidate.userId,
            conversationId: candidate.conversationId,
            runId: candidate.runId,
            userText,
            assistantText,
            boundOpportunityId: candidate.boundOpportunityId,
            relatedOpportunityIds,
            signal,
          })

          if (indexed.status === 'indexed') result.indexedCount += 1
          else result.skippedCount += 1
        } catch (error) {
          if (signal.aborted) break
          result.failedCount += 1
          this.dependencies.logError?.(error, { runId: candidate.runId })
        }
      }

      if (candidates.length < this.batchSize) break
    }

    return result
  }
}
