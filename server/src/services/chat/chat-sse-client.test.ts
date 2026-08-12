import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChatSseFrames, parseChatSseFrame } from '@/shared/chat/sse'

test('parseChatSseFrames 保留跨网络片段边界的 remainder', () => {
  const first = parseChatSseFrames('event: chat.run_event\r\ndata: {"sequence":1}\r\n\r\npartial')

  assert.deepEqual(first.frames, [{ event: 'chat.run_event', data: '{"sequence":1}' }])
  assert.equal(first.remainder, 'partial')

  const second = parseChatSseFrames(`${first.remainder} frame\n\ndata: {"ok":true}\n\n`)
  assert.deepEqual(second.frames, [{ event: 'message', data: '{"ok":true}' }])
  assert.equal(second.remainder, '')
})

test('parseChatSseFrame 忽略注释和没有 data 的心跳帧', () => {
  assert.equal(parseChatSseFrame(': keepalive\n\n'), null)
  assert.deepEqual(parseChatSseFrame('event: chat.keepalive\ndata: {"runId":"run-1"}'), {
    event: 'chat.keepalive',
    data: '{"runId":"run-1"}',
  })
})
