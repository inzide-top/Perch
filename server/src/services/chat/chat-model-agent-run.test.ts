import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModelCallPersistence } from './chat-model-agent-run'
import { createChatModelAgentRunObserver } from './chat-model-agent-run'

type StartRecord = Parameters<ChatModelCallPersistence['startChatModelCall']>[0]
type CompleteRecord = Parameters<ChatModelCallPersistence['completeChatModelCall']>[0]
type FailRecord = Parameters<ChatModelCallPersistence['failChatModelCall']>[0]

test('聊天模型记录只保存输入规模与工具名，并用 callNumber 关联完成结果', async () => {
  const startedRecords: StartRecord[] = []
  const completedRecords: CompleteRecord[] = []
  const persistence: ChatModelCallPersistence = {
    async startChatModelCall(record) {
      startedRecords.push(record)
      return null
    },
    async completeChatModelCall(record) {
      completedRecords.push(record)
      return null
    },
    async failChatModelCall() {
      return null
    },
  }
  const observer = createChatModelAgentRunObserver(
    { chatRunId: 'run-1', modelName: 'deepseek-v4-pro', promptVersion: 'chat.v2' },
    { persistence, createId: () => 'agent-run-1', now: () => '2026-08-11T10:00:00.000Z' },
  )

  await observer.onStarted?.({
    callNumber: 2,
    messages: [
      { role: 'system', content: '系统规则' },
      { role: 'user', content: '帮我查询面试中的机会' },
    ],
    tools: [{ name: 'search_opportunities', description: '查询机会', inputSchema: { type: 'object' } }],
  })
  await observer.onCompleted?.({
    callNumber: 2,
    text: '正在查询。',
    toolCalls: [
      {
        type: 'tool_call',
        callId: 'call-1',
        name: 'search_opportunities',
        arguments: { statuses: ['interviewing'] },
      },
    ],
    completed: {
      type: 'completed',
      finishReason: 'tool_call',
      tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      reasoningContent: '内部推理',
    },
    durationMs: 830,
  })

  const started = startedRecords[0]
  const completed = completedRecords[0]
  assert.ok(started)
  assert.equal(started.operationKey, 'chat:run-1:model-call:2')
  assert.equal(started.chatRunId, 'run-1')
  assert.deepEqual(started.input, {
    callNumber: 2,
    messageCount: 2,
    messageRoles: ['system', 'user'],
    messageCharacters: 14,
    toolNames: ['search_opportunities'],
  })
  assert.doesNotMatch(JSON.stringify(started), /apiKey|test-key/)

  assert.ok(completed)
  assert.equal(completed.operationKey, 'chat:run-1:model-call:2')
  assert.equal(completed.durationMs, 830)
  assert.equal(completed.parsedOutput.finishReason, 'tool_call')
  assert.equal(completed.parsedOutput.reasoningContent, '内部推理')
})

test('用户中断模型调用时，关联 AgentRun 记录为不可重试的 cancelled', async () => {
  const failedRecords: FailRecord[] = []
  const persistence: ChatModelCallPersistence = {
    async startChatModelCall() {
      return null
    },
    async completeChatModelCall() {
      return null
    },
    async failChatModelCall(record) {
      failedRecords.push(record)
      return null
    },
  }
  const observer = createChatModelAgentRunObserver(
    { chatRunId: 'run-cancel', modelName: 'qwen', promptVersion: 'chat.v1' },
    { persistence, now: () => '2026-08-11T10:00:00.000Z' },
  )

  await observer.onFailed?.({ callNumber: 1, error: new Error('AbortError'), cancelled: true, durationMs: 120 })

  const failed = failedRecords[0]
  assert.ok(failed)
  assert.equal(failed.operationKey, 'chat:run-cancel:model-call:1')
  assert.deepEqual(failed.error, {
    code: 'cancelled',
    message: '模型调用已由用户停止',
    retryable: false,
  })
})
