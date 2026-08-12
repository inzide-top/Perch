import assert from 'node:assert/strict'
import test from 'node:test'
import { chatCommandReplayMatches, hashChatCommandPayload, type ChatCommandReplayIdentity } from './chat-command'

const identity: ChatCommandReplayIdentity = {
  conversationId: 'conversation-1',
  runId: 'run-1',
  type: 'confirm_tool',
  expectedRevision: 3,
  payloadHash: 'sha256:payload',
}

test('相同 Command 身份允许安全回放', () => {
  assert.equal(chatCommandReplayMatches(identity, { ...identity }), true)
})

test('Command 身份任一关键字段变化都会拒绝回放', () => {
  const variants: ChatCommandReplayIdentity[] = [
    { ...identity, conversationId: 'conversation-2' },
    { ...identity, runId: null },
    { ...identity, type: 'cancel_run' },
    { ...identity, expectedRevision: 4 },
    { ...identity, payloadHash: 'sha256:other-payload' },
  ]

  for (const variant of variants) {
    assert.equal(chatCommandReplayMatches(identity, variant), false)
  }
})

test('Command payload hash 对象键顺序稳定且会区分请求内容', () => {
  const first = hashChatCommandPayload({
    type: 'confirm_tool',
    expectedRevision: 3,
    payload: { toolActionId: 'action-1', decision: 'approved' },
  })
  const reordered = hashChatCommandPayload({
    type: 'confirm_tool',
    expectedRevision: 3,
    payload: { decision: 'approved', toolActionId: 'action-1' },
  })
  const changed = hashChatCommandPayload({
    type: 'confirm_tool',
    expectedRevision: 3,
    payload: { toolActionId: 'action-1', decision: 'rejected' },
  })

  assert.equal(first, reordered)
  assert.notEqual(first, changed)
})

test('发送消息 Command 不需要 Run revision 也能稳定生成 payload hash', () => {
  const first = hashChatCommandPayload({
    type: 'send_message',
    expectedRevision: null,
    payload: { text: '分析这个岗位', references: [] },
  })
  const replay = hashChatCommandPayload({
    type: 'send_message',
    expectedRevision: null,
    payload: { references: [], text: '分析这个岗位' },
  })

  assert.equal(first, replay)
})
