import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelProviderAdapter } from './model-provider-adapter'
import type { ChatContextCompactionPersistence } from './chat-context-compactor'
import type { ChatContextMessageRecord } from './chat-context-window'

function createMessages(turnCount: number) {
  return Array.from({ length: turnCount }, (_, index) => {
    const userSequence = index * 2 + 1
    return [
      {
        id: `user-${index}`,
        role: 'user' as const,
        status: 'completed' as const,
        sequenceNumber: userSequence,
        parts: [{ type: 'text', text: `问题 ${index + 1}` }],
      },
      {
        id: `assistant-${index}`,
        role: 'assistant' as const,
        status: 'completed' as const,
        sequenceNumber: userSequence + 1,
        parts: [{ type: 'text', text: `回答 ${index + 1}` }],
      },
    ]
  }).flat() satisfies Array<ChatContextMessageRecord & { id: string }>
}

test('完成轮次达到阈值后生成增量摘要并以旧版本游标做条件写入', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { compactCompletedChatConversation } = await import('./chat-context-compactor')
  const messages = createMessages(13)
  type SavedRecord = Parameters<ChatContextCompactionPersistence['saveConversationSummaryIfCurrent']>[0]
  let savedRecord: SavedRecord | null = null
  let modelCallCount = 0
  const persistence = {
    async findConversationSummary() {
      return null
    },
    async listMessagesByConversationId() {
      return messages as never
    },
    async listToolActionsByConversationId() {
      return []
    },
    async saveConversationSummaryIfCurrent(record) {
      savedRecord = record
      return { ...record, revision: 1 }
    },
  } satisfies ChatContextCompactionPersistence
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      modelCallCount += 1
      assert.equal(input.tools.length, 0)
      assert.match(input.messages[1]?.content ?? '', /问题 1/)
      assert.doesNotMatch(input.messages[1]?.content ?? '', /问题 6/)
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          stableFacts: ['用户在准备前端面试'],
          userPreferences: [],
          decisions: [],
          completedActions: [],
          unresolvedTopics: ['继续准备'],
          otherContext: [],
        }),
      }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const result = await compactCompletedChatConversation(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
    },
    { persistence, adapter },
  )

  assert.equal(modelCallCount, 1)
  assert.equal(result.compacted, true)
  const saved = savedRecord as SavedRecord | null
  assert.ok(saved)
  assert.equal(saved.expectedRevision, null)
  assert.equal(saved.expectedSummarizedThroughSequence, 0)
  assert.equal(saved.summarizedThroughSequence, 10)
})

test('短会话不调用摘要模型，也不写摘要表', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { compactCompletedChatConversation } = await import('./chat-context-compactor')
  let modelCallCount = 0
  let saveCount = 0
  const persistence = {
    async findConversationSummary() {
      return null
    },
    async listMessagesByConversationId() {
      return createMessages(4) as never
    },
    async listToolActionsByConversationId() {
      return []
    },
    async saveConversationSummaryIfCurrent() {
      saveCount += 1
      return null
    },
  } satisfies ChatContextCompactionPersistence
  const adapter: ModelProviderAdapter = {
    async *stream() {
      modelCallCount += 1
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const result = await compactCompletedChatConversation(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
    },
    { persistence, adapter },
  )

  assert.deepEqual(result, { compacted: false })
  assert.equal(modelCallCount, 0)
  assert.equal(saveCount, 0)
})
