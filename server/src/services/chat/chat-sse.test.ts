import assert from 'node:assert/strict'
import test from 'node:test'
import { formatChatSseEvent, getChatStreamBoundary } from './chat-sse'

test('formatChatSseEvent 输出浏览器可解析的 SSE 帧', () => {
  assert.equal(
    formatChatSseEvent('chat.run_event', { sequence: 3, eventType: 'message_delta' }),
    'event: chat.run_event\ndata: {"sequence":3,"eventType":"message_delta"}\n\n',
  )
})

test('等待输入或确认会暂停传输但不会被误判为 Run 完成', () => {
  assert.equal(getChatStreamBoundary('waiting_input', true), null)
  assert.equal(getChatStreamBoundary('waiting_input', false), 'suspended')
  assert.equal(getChatStreamBoundary('waiting_confirmation', true), null)
  assert.equal(getChatStreamBoundary('waiting_confirmation', false), 'suspended')
  assert.equal(getChatStreamBoundary('running', false), null)
  assert.equal(getChatStreamBoundary('completed', false), 'completed')
})
