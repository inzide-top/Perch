import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  ChatMemoryCompensationCandidate,
  ChatMemoryCompensationCursor,
} from '../../repositories/chat-memory.repository'
import { ChatMemoryCompensationScanner } from './chat-memory-compensation'
import type { IndexChatMemoryInput, IndexChatMemoryResult } from './chat-memory-indexer'

const opportunityA = '11111111-1111-4111-8111-111111111111'
const opportunityB = '22222222-2222-4222-8222-222222222222'

function createCandidate(overrides: Partial<ChatMemoryCompensationCandidate> = {}): ChatMemoryCompensationCandidate {
  return {
    userId: 'user-1',
    conversationId: '33333333-3333-4333-8333-333333333333',
    runId: '44444444-4444-4444-8444-444444444444',
    runInput: {
      text: '帮我比较这两个机会',
      references: [{ type: 'opportunity', id: opportunityA }],
    },
    assistantParts: [
      { type: 'text', text: '从岗位匹配度看，A 更适合你。' },
      { type: 'tool_action', toolActionId: '55555555-5555-4555-8555-555555555555' },
    ],
    boundOpportunityId: null,
    toolInputs: [{ opportunityId: opportunityB }],
    cursor: { updatedAt: '2026-08-11T10:00:00.000Z', runId: '44444444-4444-4444-8444-444444444444' },
    ...overrides,
  }
}

describe('ChatMemoryCompensationScanner', () => {
  it('reconstructs a completed turn and sends trusted opportunity ids to the indexer', async () => {
    const calls: IndexChatMemoryInput[] = []
    const candidate = createCandidate()
    const scanner = new ChatMemoryCompensationScanner({
      repository: {
        async listUnindexedCompletedRuns(input: { cursor: ChatMemoryCompensationCursor | null; limit: number }) {
          return input.cursor ? [] : [candidate]
        },
      },
      indexer: {
        async indexCompletedTurn(input: IndexChatMemoryInput): Promise<IndexChatMemoryResult> {
          calls.push(input)
          return { status: 'indexed', documentCount: 1 }
        },
      },
    })

    const result = await scanner.scanOnce(new AbortController().signal)

    assert.equal(result.indexedCount, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.userText, '帮我比较这两个机会')
    assert.equal(calls[0]?.assistantText, '从岗位匹配度看，A 更适合你。')
    assert.deepEqual(calls[0]?.relatedOpportunityIds, [opportunityA, opportunityB])
  })

  it('advances the cursor after a candidate fails so one bad run does not block later runs', async () => {
    const failed = createCandidate()
    const succeeded = createCandidate({
      runId: '66666666-6666-4666-8666-666666666666',
      cursor: { updatedAt: '2026-08-11T10:01:00.000Z', runId: '66666666-6666-4666-8666-666666666666' },
    })
    const errors: string[] = []
    const scanner = new ChatMemoryCompensationScanner({
      repository: {
        async listUnindexedCompletedRuns(input: { cursor: ChatMemoryCompensationCursor | null; limit: number }) {
          return input.cursor ? [] : [failed, succeeded]
        },
      },
      indexer: {
        async indexCompletedTurn(input: IndexChatMemoryInput): Promise<IndexChatMemoryResult> {
          if (input.runId === failed.runId) throw new Error('temporary embedding failure')
          return { status: 'indexed', documentCount: 1 }
        },
      },
      logError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    })

    const result = await scanner.scanOnce(new AbortController().signal)

    assert.equal(result.failedCount, 1)
    assert.equal(result.indexedCount, 1)
    assert.deepEqual(result.nextCursor, succeeded.cursor)
    assert.deepEqual(errors, ['temporary embedding failure'])
  })

  it('does not request another batch after cancellation', async () => {
    const controller = new AbortController()
    let repositoryCalls = 0
    const scanner = new ChatMemoryCompensationScanner({
      repository: {
        async listUnindexedCompletedRuns() {
          repositoryCalls += 1
          return [createCandidate()]
        },
      },
      indexer: {
        async indexCompletedTurn(): Promise<IndexChatMemoryResult> {
          controller.abort()
          return { status: 'indexed', documentCount: 1 }
        },
      },
      batchSize: 1,
      maxBatchesPerScan: 3,
    })

    await scanner.scanOnce(controller.signal)

    assert.equal(repositoryCalls, 1)
  })
})
