import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRetrieveChatMemory } from './chat-memory-retrieval-policy'

test('确认卡片和等待输入的续跑不重复执行历史记忆检索', () => {
  assert.equal(shouldRetrieveChatMemory({ userText: '把意向改为 S', isContinuation: true }), false)
})

test('只有完全匹配的少量确认词跳过历史记忆检索', () => {
  for (const text of ['好', '好的。', ' OK! ', 'Okay', '没问题', '确认']) {
    assert.equal(shouldRetrieveChatMemory({ userText: text, isContinuation: false }), false, text)
  }
})

test('带有实际问题或后续要求的消息仍然检索历史记忆', () => {
  for (const text of ['好的，再帮我看看小米', '可以解释一下原因吗？', '取消明天的面试安排', '我该怎么准备？']) {
    assert.equal(shouldRetrieveChatMemory({ userText: text, isContinuation: false }), true, text)
  }
})
