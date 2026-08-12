import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'
import type { ModelProviderAdapter, ModelProviderStreamInput } from './model-provider-adapter'
import {
  createChatConversationAutoTitleRequest,
  createInitialGlobalChatTitle,
  generateChatConversationTitle,
  normalizeGeneratedChatTitle,
} from './chat-title'

const modelConnection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

const opportunity = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  company: '小米',
  jobTitle: '前端工程师',
} as JobOpportunityRecord

test('只有仍使用默认占位名的首次成功问答才创建自动标题请求', () => {
  const userText = '帮我分析一下这个岗位最需要准备哪些内容'
  const defaultTitle = createInitialGlobalChatTitle(userText)

  assert.deepEqual(
    createChatConversationAutoTitleRequest({
      conversation: { title: defaultTitle, scopeType: 'global' },
      opportunity: null,
      previousMessages: [],
      currentUserText: userText,
    }),
    { expectedTitle: defaultTitle, userText },
  )
  assert.equal(
    createChatConversationAutoTitleRequest({
      conversation: { title: '我手动设置的标题', scopeType: 'global' },
      opportunity: null,
      previousMessages: [],
      currentUserText: userText,
    }),
    null,
  )
  assert.equal(
    createChatConversationAutoTitleRequest({
      conversation: { title: defaultTitle, scopeType: 'global' },
      opportunity: null,
      previousMessages: [{ role: 'assistant', status: 'completed', parts: [{ type: 'text', text: '已经回答过。' }] }],
      currentUserText: userText,
    }),
    null,
  )
})

test('机会会话只有保持公司和岗位默认名时才允许自动命名', () => {
  assert.deepEqual(
    createChatConversationAutoTitleRequest({
      conversation: { title: '小米 · 前端工程师', scopeType: 'opportunity' },
      opportunity,
      previousMessages: [],
      currentUserText: '我该怎么准备一面？',
    }),
    { expectedTitle: '小米 · 前端工程师', userText: '我该怎么准备一面？' },
  )
  assert.equal(
    createChatConversationAutoTitleRequest({
      conversation: { title: '小米一面准备', scopeType: 'opportunity' },
      opportunity,
      previousMessages: [],
      currentUserText: '我该怎么准备一面？',
    }),
    null,
  )
})

test('标题模型不注册工具，并将模型输出清理为短标题', async () => {
  const receivedInputs: ModelProviderStreamInput[] = []
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      receivedInputs.push(input)
      yield { type: 'text_delta', text: '## 对话标题：『小米前端一面准备』。\n额外解释' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const title = await generateChatConversationTitle(
    {
      modelConnection,
      userText: '我该怎么准备小米前端一面？',
      assistantText: '建议重点准备 Vue 原理、工程化和项目追问。',
    },
    adapter,
  )

  assert.equal(title, '小米前端一面准备')
  const receivedInput = receivedInputs[0]
  assert.ok(receivedInput)
  assert.deepEqual(receivedInput?.tools, [])
  assert.equal(receivedInput?.messages[0]?.role, 'system')
})

test('标题清理会移除包装并限制最大长度', () => {
  assert.equal(normalizeGeneratedChatTitle('“前端求职规划”'), '前端求职规划')
  assert.equal(Array.from(normalizeGeneratedChatTitle('这是一个超过最大标题长度的对话标题'.repeat(4))).length, 28)
})
