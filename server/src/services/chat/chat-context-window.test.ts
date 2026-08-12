import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendChatConversationSummaryToSystemPrompt,
  buildChatContextWindow,
  chatConversationSummaryContentSchema,
  createChatSummaryTranscript,
  planChatContextCompaction,
  type ChatContextMessageRecord,
} from './chat-context-window'

function createTurns(turnCount: number, text = '普通对话内容') {
  return Array.from({ length: turnCount }, (_, index) => {
    const userSequence = index * 2 + 1
    return [
      {
        role: 'user' as const,
        status: 'completed' as const,
        sequenceNumber: userSequence,
        parts: [{ type: 'text', text: `问题 ${index + 1}：${text}` }],
      },
      {
        role: 'assistant' as const,
        status: 'completed' as const,
        sequenceNumber: userSequence + 1,
        parts: [{ type: 'text', text: `回答 ${index + 1}：${text}` }],
      },
    ]
  }).flat() satisfies ChatContextMessageRecord[]
}

const summary = chatConversationSummaryContentSchema.parse({
  stableFacts: ['用户主要使用 Vue'],
  userPreferences: [],
  decisions: [],
  completedActions: [],
  unresolvedTopics: ['继续讨论工程化'],
  otherContext: [],
})

test('会话达到 13 轮时批量摘要最旧 5 轮，并保留最近 8 轮原文', () => {
  assert.equal(planChatContextCompaction({ messages: createTurns(12), summarizedThroughSequence: 0 }), null)

  const plan = planChatContextCompaction({ messages: createTurns(13), summarizedThroughSequence: 0 })

  assert.ok(plan)
  assert.equal(plan.summarizedThroughSequence, 10)
  assert.equal(plan.messagesToSummarize.length, 10)
  assert.equal(plan.remainingTurnCount, 8)
})

test('单轮内容很长时由 token 预算提前触发，但至少保留最近 4 轮', () => {
  const plan = planChatContextCompaction({
    messages: createTurns(5, '长'.repeat(1_500)),
    summarizedThroughSequence: 0,
  })

  assert.ok(plan)
  assert.equal(plan.summarizedThroughSequence, 2)
  assert.equal(plan.remainingTurnCount, 4)
})

test('单次摘要输入按完整轮次分批，不截断中间对话却推进游标', () => {
  const plan = planChatContextCompaction({
    messages: createTurns(13, '长'.repeat(3_000)),
    summarizedThroughSequence: 0,
  })

  assert.ok(plan)
  assert.equal(plan.messagesToSummarize.length, 6)
  assert.equal(plan.summarizedThroughSequence, 6)
})

test('取消后的助手半成品在摘要输入中带有不完整标识', () => {
  const transcript = createChatSummaryTranscript(
    [
      { role: 'user', status: 'completed', sequenceNumber: 1, parts: [{ type: 'text', text: '继续分析' }] },
      { role: 'assistant', status: 'cancelled', sequenceNumber: 2, parts: [{ type: 'text', text: '分析到一半' }] },
    ],
    [],
  )

  assert.match(transcript, /用户取消后的不完整输出/)
  assert.match(transcript, /分析到一半/)
})

test('下一次模型上下文使用旧摘要和游标后的近期原文', () => {
  const messages = createTurns(6)
  const context = buildChatContextWindow({
    messages,
    summaryRecord: {
      summary,
      summarizedThroughSequence: 4,
      revision: 1,
    },
  })

  assert.equal(context.summarizedThroughSequence, 4)
  assert.deepEqual(
    context.recentMessages.map((message) => message.sequenceNumber),
    [5, 6, 7, 8, 9, 10, 11, 12],
  )
  assert.match(context.summaryText ?? '', /用户主要使用 Vue/)
  assert.match(context.summaryText ?? '', /继续讨论工程化/)
})

test('摘要结构损坏时不推进游标，安全降级到原始消息', () => {
  const messages = createTurns(2)
  const context = buildChatContextWindow({
    messages,
    summaryRecord: {
      summary: { stableFacts: '错误结构' },
      summarizedThroughSequence: 2,
      revision: 1,
    },
  })

  assert.equal(context.summarizedThroughSequence, 0)
  assert.equal(context.summaryText, null)
  assert.deepEqual(context.recentMessages, messages)
})

test('摘要被合并进唯一 System Message，并明确硬预算遗漏', () => {
  const prompt = appendChatConversationSummaryToSystemPrompt({
    systemPrompt: '你是 PERCH。',
    summaryText: '较早摘要',
    omittedUnsummarizedMessageCount: 3,
  })

  assert.match(prompt, /^你是 PERCH。/)
  assert.match(prompt, /较早摘要/)
  assert.match(prompt, /3 条较早且尚未完成摘要/)
})
