import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { ChatRunStatus } from '@/shared/chat/schemas'
import type {
  AppendAssistantMessageRecord,
  AppendChatRunEventRecord,
  PersistWaitingInputRecord,
  PersistWaitingConfirmationRecord,
  UpdateChatRunRecord,
} from '../../repositories/chat.repository'
import { AgentToolRegistry, type AgentToolDefinition } from './agent-tool'
import { toProviderMessages } from './chat-message-mapper'
import { executeChatRun } from './chat-runner'
import type { ModelProviderAdapter, ModelProviderStreamEvent, ModelProviderStreamInput } from './model-provider-adapter'

const modelConnection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

class FakeAdapter implements ModelProviderAdapter {
  constructor(private readonly responses: ModelProviderStreamEvent[][]) {}

  async *stream(_input: ModelProviderStreamInput): AsyncGenerator<ModelProviderStreamEvent> {
    const response = this.responses.shift()
    if (!response) throw new Error('FakeAdapter 没有更多响应')
    yield* response
  }
}

class FakePersistence {
  revision = 1
  status: ChatRunStatus = 'queued'
  events: Array<{ eventType: string; payload: Record<string, unknown> }> = []
  messages: Array<{
    id: string
    text: string
    status: AppendAssistantMessageRecord['message']['status']
    parts: AppendAssistantMessageRecord['message']['parts']
  }> = []
  waitingCheckpoint: Record<string, unknown> | null = null

  async updateRun(input: UpdateChatRunRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    if (input.patch.status) this.status = input.patch.status
    return { revision: this.revision }
  }

  async appendRunEvent(input: AppendChatRunEventRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    this.events.push(input.event)
    return { run: { revision: this.revision }, event: input.event }
  }

  async appendAssistantMessage(input: AppendAssistantMessageRecord) {
    const text = input.message.parts
      .filter((part): part is Extract<(typeof input.message.parts)[number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('')
    this.messages.push({ id: input.message.id, text, status: input.message.status, parts: input.message.parts })
    return { id: input.message.id }
  }

  async persistWaitingConfirmation(input: PersistWaitingConfirmationRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    this.status = 'waiting_confirmation'
    this.waitingCheckpoint = input.checkpoint
    return { run: { revision: this.revision }, toolAction: { id: 'tool-action' }, event: {}, duplicate: false }
  }

  async persistWaitingInput(input: PersistWaitingInputRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    this.status = 'waiting_input'
    this.waitingCheckpoint = input.checkpoint
    return { run: { revision: this.revision }, toolAction: { id: 'tool-action' }, event: {}, duplicate: false }
  }
}

function createInput(
  persistence: FakePersistence,
  toolRegistry = new AgentToolRegistry([]),
  continuation?: Parameters<typeof executeChatRun>[0]['continuation'],
) {
  return {
    userId: 'user-1',
    conversationId: 'conversation-1',
    runId: 'run-1',
    expectedRevision: persistence.revision,
    modelConnection,
    messages: [{ role: 'user' as const, content: '你好' }],
    toolRegistry,
    signal: new AbortController().signal,
    continuation,
  }
}

function createConfirmationTool(executeCount: { value: number }): AgentToolDefinition {
  return {
    name: 'update_opportunity',
    version: '1',
    description: '修改机会状态',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    inputValidator: z.object({ status: z.string().min(1) }).strict(),
    requiresConfirmation: true,
    execute: async (input) => {
      executeCount.value += 1
      return { updated: true, status: input.status }
    },
  }
}

test('ChatRunRunner 完成普通模型回答并写入消息和事件', async () => {
  const persistence = new FakePersistence()
  const adapter = new FakeAdapter([
    [
      { type: 'text_delta', text: '你好，' },
      { type: 'text_delta', text: '我可以帮你。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const result = await executeChatRun(createInput(persistence), {
    adapter,
    persistence,
    createId: (() => {
      let index = 0
      return () => `id-${index++}`
    })(),
  })

  assert.equal(result.status, 'completed')
  assert.equal(persistence.status, 'completed')
  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.text, '你好，我可以帮你。')
  assert.deepEqual(
    persistence.events.map((event) => event.eventType),
    ['run_started', 'message_delta', 'message_completed', 'run_completed'],
  )
  assert.equal(
    persistence.events.find((event) => event.eventType === 'message_delta')?.payload.text,
    '你好，我可以帮你。',
  )
})

test('连续文本 delta 不会逐条等待数据库写入', async () => {
  let releaseTextWrite: () => void = () => {}
  const textWriteGate = new Promise<void>((resolve) => {
    releaseTextWrite = resolve
  })
  let emittedEventCount = 0

  class BlockingTextPersistence extends FakePersistence {
    override async appendRunEvent(input: AppendChatRunEventRecord) {
      if (input.event.eventType === 'message_delta') await textWriteGate
      return super.appendRunEvent(input)
    }
  }

  const persistence = new BlockingTextPersistence()
  const adapter: ModelProviderAdapter = {
    async *stream() {
      for (const text of ['第一个片段', '第二个片段', '第三个片段']) {
        emittedEventCount += 1
        yield { type: 'text_delta', text }
      }
      emittedEventCount += 1
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const execution = executeChatRun(createInput(persistence), { adapter, persistence })
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(emittedEventCount, 4)
  releaseTextWrite()
  await execution
  assert.equal(
    persistence.events.find((event) => event.eventType === 'message_delta')?.payload.text,
    '第一个片段第二个片段第三个片段',
  )
})

test('数据库写入较慢时会把后续文本合并到下一次单飞写入', async () => {
  let releaseFirstTextWrite: () => void = () => {}
  const firstTextWriteGate = new Promise<void>((resolve) => {
    releaseFirstTextWrite = resolve
  })
  let textWriteCount = 0

  class SlowTextPersistence extends FakePersistence {
    override async appendRunEvent(input: AppendChatRunEventRecord) {
      if (input.event.eventType === 'message_delta') {
        textWriteCount += 1
        if (textWriteCount === 1) await firstTextWriteGate
      }
      return super.appendRunEvent(input)
    }
  }

  const fragments = Array.from({ length: 6 }, (_, index) => `${index}`.repeat(48))
  const persistence = new SlowTextPersistence()
  const adapter: ModelProviderAdapter = {
    async *stream() {
      for (const text of fragments) {
        yield { type: 'text_delta', text }
      }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const execution = executeChatRun(createInput(persistence), { adapter, persistence })
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseFirstTextWrite()
  await execution

  const textEvents = persistence.events.filter((event) => event.eventType === 'message_delta')
  assert.equal(textEvents.length, 2)
  assert.equal(textEvents.map((event) => event.payload.text).join(''), fragments.join(''))
})

test('工具执行会记录生命周期，并把搜索结果保存为消息卡片 Part', async () => {
  const persistence = new FakePersistence()
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-search-1',
        name: 'search_opportunities',
        arguments: { statuses: ['interviewing'], intentionLevels: [], limit: 10 },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '找到 1 个面试中的机会。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const toolRegistry = new AgentToolRegistry([
    {
      name: 'search_opportunities',
      version: '1',
      description: '搜索机会',
      inputSchema: { type: 'object' },
      inputValidator: z.object({
        statuses: z.array(z.literal('interviewing')),
        intentionLevels: z.array(z.never()),
        limit: z.number(),
      }),
      requiresConfirmation: false,
      execute: async () => ({
        query: { statuses: ['interviewing'], intentionLevels: [] },
        matchedCount: 1,
        returnedCount: 1,
        hasMore: false,
        opportunities: [
          {
            id: 'opportunity-1',
            company: '小米',
            jobTitle: '前端工程师',
            status: 'interviewing',
            statusLabel: '面试中',
            intentionLevel: 'S',
            industry: '互联网',
            address: ['上海'],
            updatedAt: '2026-08-08T00:00:00.000Z',
          },
        ],
      }),
    },
  ])

  const result = await executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence })

  assert.equal(result.status, 'completed')
  assert.deepEqual(
    persistence.events.map((event) => event.eventType),
    [
      'run_started',
      'tool_call_requested',
      'message_completed',
      'tool_call_started',
      'tool_call_completed',
      'message_delta',
      'message_completed',
      'run_completed',
    ],
  )
  assert.equal(persistence.messages[0]?.parts[1]?.type, 'opportunity_search_result')
})

test('工具前后的模型文字会以空行分隔，并按相同内容写入最终消息', async () => {
  const persistence = new FakePersistence()
  const adapter = new FakeAdapter([
    [
      { type: 'text_delta', text: '我先查询符合条件的机会。' },
      {
        type: 'tool_call',
        callId: 'call-search-with-lead',
        name: 'search_opportunities',
        arguments: { statuses: ['interviewing'], intentionLevels: [], limit: 10 },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '找到了 1 个正在面试中的机会。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const toolRegistry = new AgentToolRegistry([
    {
      name: 'search_opportunities',
      version: '1',
      description: '搜索机会',
      inputSchema: { type: 'object' },
      inputValidator: z.object({
        statuses: z.array(z.literal('interviewing')),
        intentionLevels: z.array(z.never()),
        limit: z.number(),
      }),
      requiresConfirmation: false,
      execute: async () => ({
        query: { statuses: ['interviewing'], intentionLevels: [] },
        matchedCount: 1,
        returnedCount: 1,
        hasMore: false,
        opportunities: [],
      }),
    },
  ])

  await executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence })

  const streamedText = persistence.events
    .filter((event) => event.eventType === 'message_delta')
    .map((event) => event.payload.text)
    .join('')
  assert.equal(streamedText, '我先查询符合条件的机会。\n\n找到了 1 个正在面试中的机会。')
  assert.equal(persistence.messages[0]?.text, streamedText)
})

test('工具执行失败会记录 tool_call_failed，并不会伪造结果卡片', async () => {
  const persistence = new FakePersistence()
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-search-failed',
        name: 'search_opportunities',
        arguments: {},
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const toolRegistry = new AgentToolRegistry([
    {
      name: 'search_opportunities',
      version: '1',
      description: '搜索机会',
      inputSchema: { type: 'object' },
      inputValidator: z.object({}),
      requiresConfirmation: false,
      execute: async () => {
        throw new Error('数据库暂时不可用')
      },
    },
  ])

  await assert.rejects(executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence }))
  assert.deepEqual(
    persistence.events.map((event) => event.eventType),
    ['run_started', 'tool_call_requested', 'message_completed', 'tool_call_started', 'tool_call_failed', 'run_failed'],
  )
  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.status, 'failed')
  assert.equal(persistence.messages[0]?.text, '当前任务执行失败，请稍后再试')
  assert.deepEqual(
    persistence.messages[0]?.parts.map((part) => part.type),
    ['text'],
  )
})

test('只读工具的可恢复失败会继续调用模型，而不会把 ChatRun 标记为失败', async () => {
  const persistence = new FakePersistence()
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-read-failed',
        name: 'search_opportunities',
        arguments: {},
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '暂时无法读取机会数据，请稍后再试。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const toolRegistry = new AgentToolRegistry([
    {
      name: 'search_opportunities',
      version: '1',
      description: '搜索机会',
      inputSchema: { type: 'object' },
      inputValidator: z.object({}),
      executionFailurePolicy: 'return_to_model',
      requiresConfirmation: false,
      execute: async () => {
        throw new Error('数据库暂时不可用')
      },
    },
  ])

  const result = await executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence })

  assert.equal(result.status, 'completed')
  assert.equal(persistence.status, 'completed')
  const failureEvent = persistence.events.find((event) => event.eventType === 'tool_call_failed')
  assert.equal(failureEvent?.payload.recoverable, true)
  assert.equal(
    persistence.events.some((event) => event.eventType === 'run_failed'),
    false,
  )
  assert.equal(persistence.messages[0]?.status, 'completed')
  assert.equal(persistence.messages[0]?.text, '暂时无法读取机会数据，请稍后再试。')
})

test('模型请求失败会持久化助手失败消息并绑定为 Run 输出', async () => {
  const persistence = new FakePersistence()
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield await Promise.reject<ModelProviderStreamEvent>(new Error('模型网络不可用'))
    },
  }

  await assert.rejects(executeChatRun(createInput(persistence), { adapter, persistence }), /模型网络不可用/)

  assert.equal(persistence.status, 'failed')
  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.status, 'failed')
  assert.equal(persistence.messages[0]?.text, '当前任务执行失败，请稍后再试')
  assert.equal(persistence.events.at(-1)?.eventType, 'run_failed')
})

test('持久化失败提示不会被重新发送给模型', () => {
  const messages = toProviderMessages([
    { role: 'user', status: 'completed', parts: [{ type: 'text', text: '关闭笔试流程' }] },
    { role: 'assistant', status: 'failed', parts: [{ type: 'text', text: '当前任务执行失败，请稍后再试' }] },
  ])

  assert.deepEqual(messages, [{ role: 'user', content: '关闭笔试流程' }])
})

test('ChatRunRunner 将需要确认的工具保存为 waiting_confirmation', async () => {
  const persistence = new FakePersistence()
  const executeCount = { value: 0 }
  const toolRegistry = new AgentToolRegistry([createConfirmationTool(executeCount)])
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-1',
        name: 'update_opportunity',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const result = await executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence })

  assert.equal(result.status, 'waiting_confirmation')
  assert.equal(persistence.status, 'waiting_confirmation')
  assert.equal(executeCount.value, 0)
  assert.ok(persistence.waitingCheckpoint)
})

test('确认后 Runner 恢复 checkpoint、执行工具并生成最终回答', async () => {
  const persistence = new FakePersistence()
  const executeCount = { value: 0 }
  const toolRegistry = new AgentToolRegistry([createConfirmationTool(executeCount)])
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-1',
        name: 'update_opportunity',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '已完成修改。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])

  const waiting = await executeChatRun(createInput(persistence, toolRegistry), {
    adapter,
    persistence,
  })
  assert.equal(waiting.status, 'waiting_confirmation')
  if (waiting.status !== 'waiting_confirmation') return

  const completed = await executeChatRun(
    createInput(persistence, toolRegistry, {
      type: 'confirmation',
      checkpoint: waiting.checkpoint,
      decision: 'approved',
    }),
    {
      adapter,
      persistence,
      createId: (() => {
        let index = 0
        return () => `resume-id-${index++}`
      })(),
    },
  )

  assert.equal(completed.status, 'completed')
  assert.equal(executeCount.value, 1)
  assert.equal(persistence.messages.at(-1)?.text, '已完成修改。')
  assert.deepEqual(
    persistence.messages.at(-1)?.parts.map((part) => part.type),
    ['tool_action', 'text'],
  )
  assert.equal(persistence.status, 'completed')
})

test('等待确认前的模型引导语会保留在续跑后的最终消息中', async () => {
  const persistence = new FakePersistence()
  const toolRegistry = new AgentToolRegistry([createConfirmationTool({ value: 0 })])
  const adapter = new FakeAdapter([
    [
      { type: 'text_delta', text: '我准备修改当前机会的意向等级。' },
      {
        type: 'tool_call',
        callId: 'call-with-leading-text',
        name: 'update_opportunity',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '已经修改完成。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])

  const waiting = await executeChatRun(createInput(persistence, toolRegistry), { adapter, persistence })
  assert.equal(waiting.status, 'waiting_confirmation')
  if (waiting.status !== 'waiting_confirmation') return

  await executeChatRun(
    createInput(persistence, toolRegistry, {
      type: 'confirmation',
      checkpoint: waiting.checkpoint,
      decision: 'approved',
    }),
    { adapter, persistence },
  )

  const message = persistence.messages.at(-1)
  assert.equal(message?.text, '我准备修改当前机会的意向等级。\n\n已经修改完成。')
  assert.deepEqual(
    message?.parts.map((part) => part.type),
    ['text', 'tool_action', 'text'],
  )
  assert.equal(message?.parts[0]?.type === 'text' ? message.parts[0].text : '', '我准备修改当前机会的意向等级。')
  assert.equal(message?.parts[2]?.type === 'text' ? message.parts[2].text : '', '\n\n已经修改完成。')
})

test('用户停止 Run 后只保留前端停止瞬间可见的助手片段，并记录 cancelled 事件', async () => {
  const persistence = new FakePersistence()
  const controller = new AbortController()
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield { type: 'text_delta', text: '前端已显示后端又收到' }
      controller.abort('user_requested')
      throw new DOMException('已停止', 'AbortError')
    },
  }

  await assert.rejects(
    executeChatRun(
      {
        ...createInput(persistence),
        signal: controller.signal,
        getCancellationVisibleTextLength: () => '前端已显示'.length,
      },
      { adapter, persistence },
    ),
    /聊天任务已由用户停止/,
  )

  assert.equal(persistence.status, 'cancelled')
  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.text, '前端已显示')
  assert.equal(persistence.events.at(-1)?.payload.code, 'cancelled')
  assert.deepEqual(
    persistence.events.map((event) => event.eventType),
    ['run_started', 'message_delta', 'run_cancelled'],
  )
})

test('用户在模型尚未输出文字前停止时会保存确定性的取消提示', async () => {
  const persistence = new FakePersistence()
  const controller = new AbortController()
  controller.abort('user_requested')

  await assert.rejects(
    executeChatRun(
      {
        ...createInput(persistence),
        signal: controller.signal,
      },
      { adapter: new FakeAdapter([]), persistence },
    ),
    /聊天任务已由用户停止/,
  )

  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.text, '用户已结束当前对话')
  assert.deepEqual(
    persistence.events.map((event) => event.eventType),
    ['run_cancelled'],
  )
})
