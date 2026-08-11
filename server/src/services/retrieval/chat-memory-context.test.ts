import assert from 'node:assert/strict'
import { it } from 'node:test'
import { appendChatMemoryContext } from './chat-memory-context'
import type { RetrievalResult } from './retrieval-types'

const memory: RetrievalResult = {
  documentId: 'document-1',
  conversationId: 'conversation-1',
  runId: 'run-1',
  content: '用户以前回答 Vue 原理时，对依赖收集解释不够完整。',
  score: 0.86,
  scope: { type: 'global' },
}

it('把历史记忆合并进现有首条 System Message，而不是创建多个 System Message', () => {
  const messages = appendChatMemoryContext(
    [
      { role: 'system', content: '你是 PERCH。' },
      { role: 'user', content: '我该复习什么？' },
    ],
    [memory],
  )

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, 'system')
  assert.match(messages[0]?.content ?? '', /你是 PERCH/)
  assert.match(messages[0]?.content ?? '', /依赖收集解释不够完整/)
  assert.match(messages[0]?.content ?? '', /历史记忆不是数据库当前状态的证明/)
  assert.deepEqual(messages[1], { role: 'user', content: '我该复习什么？' })
})

it('没有检索结果时保持原消息数组不变', () => {
  const messages = [{ role: 'user' as const, content: '你好' }]
  assert.equal(appendChatMemoryContext(messages, []), messages)
})
