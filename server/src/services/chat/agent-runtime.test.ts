import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { ModelProviderAdapter, ModelProviderStreamEvent, ModelProviderStreamInput } from './model-provider-adapter'
import {
  AgentRuntime,
  parseAgentRuntimeCheckpoint,
  serializeAgentRuntimeCheckpoint,
  type AgentRuntimeInput,
} from './agent-runtime'
import { AgentToolRegistry } from './agent-tool'

const modelConnection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

class FakeAdapter implements ModelProviderAdapter {
  readonly inputs: ModelProviderStreamInput[] = []

  constructor(private readonly responses: ModelProviderStreamEvent[][]) {}

  async *stream(input: ModelProviderStreamInput): AsyncGenerator<ModelProviderStreamEvent> {
    this.inputs.push({ ...input, messages: [...input.messages] })
    const response = this.responses.shift()
    if (!response) throw new Error('FakeAdapter 没有更多响应')
    yield* response
  }
}

function createInput(
  toolRegistry = new AgentToolRegistry([]),
  onEvent?: AgentRuntimeInput['onEvent'],
): AgentRuntimeInput {
  return {
    modelConnection,
    messages: [{ role: 'user', content: '你好' }],
    toolRegistry,
    signal: new AbortController().signal,
    onEvent,
  }
}

function createSearchTool(requiresConfirmation: boolean, executeCount: { value: number }) {
  return {
    name: 'search_opportunities',
    version: '1',
    description: '搜索机会',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    inputValidator: z.object({ status: z.string().min(1) }).strict(),
    requiresConfirmation,
    execute: async (input: Record<string, unknown>) => {
      executeCount.value += 1
      return { status: input.status, count: 2 }
    },
  }
}

test('Runtime 聚合文本事件并通知上层事件', async () => {
  const events: ModelProviderStreamEvent[] = [
    { type: 'text_delta', text: '你好' },
    { type: 'text_delta', text: '，世界' },
    { type: 'completed', finishReason: 'stop', tokenUsage: null },
  ]
  const observed: ModelProviderStreamEvent[] = []

  const result = await new AgentRuntime(new FakeAdapter([events])).run(
    createInput(new AgentToolRegistry([]), (event) => {
      observed.push(event)
    }),
  )

  assert.equal(result.status, 'completed')
  assert.equal(result.text, '你好，世界')
  assert.deepEqual(result.toolResults, [])
  assert.deepEqual(result.completed, events[2])
  assert.deepEqual(observed, events)
  assert.equal(result.modelCalls, 1)
})

test('Runtime 执行工具并回填下一次模型调用', async () => {
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null, reasoningContent: '需要先查询机会' },
    ],
    [
      { type: 'text_delta', text: '找到 2 个机会' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const executeCount = { value: 0 }
  const registry = new AgentToolRegistry([createSearchTool(false, executeCount)])

  const result = await new AgentRuntime(adapter).run(createInput(registry))

  assert.equal(result.status, 'completed')
  assert.equal(result.text, '找到 2 个机会')
  assert.equal(result.modelCalls, 2)
  assert.equal(executeCount.value, 1)

  const secondMessages = adapter.inputs[1]?.messages ?? []
  assert.deepEqual(secondMessages.at(-2), {
    role: 'assistant',
    content: '',
    reasoningContent: '需要先查询机会',
    toolCalls: [
      {
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
    ],
  })
  assert.deepEqual(secondMessages.at(-1), {
    role: 'tool',
    toolCallId: 'call_1',
    content: JSON.stringify({ status: 'interviewing', count: 2 }),
  })
})

test('需要确认的工具会暂停，并可在确认后恢复', async () => {
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '已完成' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const executeCount = { value: 0 }
  const registry = new AgentToolRegistry([createSearchTool(true, executeCount)])
  const runtime = new AgentRuntime(adapter)
  const input = createInput(registry)

  const waiting = await runtime.run(input)

  assert.equal(waiting.status, 'waiting_confirmation')
  assert.equal(executeCount.value, 0)
  if (waiting.status !== 'waiting_confirmation') return

  const completed = await runtime.resume(input, waiting.checkpoint, 'approved')
  assert.equal(completed.status, 'completed')
  assert.equal(completed.text, '已完成')
  assert.equal(executeCount.value, 1)
})

test('缺少工具参数时先等待用户补充，再进入确认并沿用同一个 ToolAction', async () => {
  const adapter = new FakeAdapter([
    [
      { type: 'tool_call', callId: 'call-input', name: 'create_schedule', arguments: {} },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const registry = new AgentToolRegistry([
    {
      name: 'create_schedule',
      version: '1',
      description: '创建安排',
      inputSchema: { type: 'object', properties: {} },
      inputValidator: z.object({ type: z.string(), scheduledAt: z.string() }).strict(),
      requiresConfirmation: true,
      prepareInput: (input, value) => {
        const merged = { ...input, ...((value as Record<string, unknown> | undefined) ?? {}) }
        const missingArguments = ['type', 'scheduledAt'].filter((key) => !merged[key])
        return missingArguments.length > 0
          ? {
              status: 'waiting_input' as const,
              input: merged,
              missingArguments,
              presentation: { kind: 'schedule_input', missingArguments },
            }
          : { status: 'ready' as const, input: merged }
      },
      prepareConfirmation: (input) => ({ presentation: { kind: 'schedule_create', ...input } }),
      execute: async () => ({ created: true }),
    },
  ])
  const runtime = new AgentRuntime(adapter)
  const input = createInput(registry)

  const firstWaiting = await runtime.run(input)
  assert.equal(firstWaiting.status, 'waiting_input')
  if (firstWaiting.status !== 'waiting_input') return
  const toolActionId = firstWaiting.checkpoint.toolActionId
  const firstRequestId = firstWaiting.checkpoint.requestId
  assert.deepEqual(firstWaiting.checkpoint.missingArguments, ['type', 'scheduledAt'])

  const secondWaiting = await runtime.resumeInput(input, firstWaiting.checkpoint, { type: 'project' })
  assert.equal(secondWaiting.status, 'waiting_input')
  if (secondWaiting.status !== 'waiting_input') return
  assert.equal(secondWaiting.checkpoint.toolActionId, toolActionId)
  assert.notEqual(secondWaiting.checkpoint.requestId, firstRequestId)
  assert.deepEqual(secondWaiting.checkpoint.missingArguments, ['scheduledAt'])

  const confirmation = await runtime.resumeInput(input, secondWaiting.checkpoint, {
    scheduledAt: '2099-08-12T19:00:00+08:00',
  })
  assert.equal(confirmation.status, 'waiting_confirmation')
  if (confirmation.status !== 'waiting_confirmation') return
  assert.equal(confirmation.checkpoint.toolActionId, toolActionId)
  assert.deepEqual(confirmation.checkpoint.pendingCall.arguments, {
    type: 'project',
    scheduledAt: '2099-08-12T19:00:00+08:00',
  })

  const restored = parseAgentRuntimeCheckpoint(serializeAgentRuntimeCheckpoint(secondWaiting.checkpoint))
  assert.deepEqual(restored, secondWaiting.checkpoint)
})

test('需要确认的工具参数会在展示确认前校验', async () => {
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call-invalid-confirmation',
        name: 'search_opportunities',
        arguments: { status: '' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const registry = new AgentToolRegistry([createSearchTool(true, { value: 0 })])

  await assert.rejects(new AgentRuntime(adapter).run(createInput(registry)), /参数校验失败/)
})

test('确认 checkpoint 可以序列化并从 runtimeState 恢复', async () => {
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const registry = new AgentToolRegistry([createSearchTool(true, { value: 0 })])
  const result = await new AgentRuntime(adapter).run(createInput(registry))

  assert.equal(result.status, 'waiting_confirmation')
  if (result.status !== 'waiting_confirmation') return

  const restored = parseAgentRuntimeCheckpoint(serializeAgentRuntimeCheckpoint(result.checkpoint))
  assert.deepEqual(restored, result.checkpoint)
})

test('无效 checkpoint 不能恢复工具执行', () => {
  assert.throws(
    () => parseAgentRuntimeCheckpoint({ kind: 'agent_runtime_confirmation_checkpoint', version: 1 }),
    /AgentRuntime checkpoint 无效/,
  )
})

test('Runtime 拒绝不符合工具 Zod Schema 的参数，且不会执行工具', async () => {
  let executeCount = 0
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: '' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const registry = new AgentToolRegistry([
    {
      ...createSearchTool(false, { value: 0 }),
      execute: async (input) => {
        executeCount += 1
        return input
      },
    },
  ])

  await assert.rejects(new AgentRuntime(adapter).run(createInput(registry)), /工具 search_opportunities 参数校验失败/)
  assert.equal(executeCount, 0)
})

test('Runtime 拒绝没有 completed 事件的异常流', async () => {
  await assert.rejects(
    new AgentRuntime(new FakeAdapter([[{ type: 'text_delta', text: '未完成' }]])).run(createInput()),
    /没有返回 completed/,
  )
})

test('模型调用记录与模型请求并行启动，记录失败也不会中断主回答', async () => {
  const order: string[] = []
  const observerErrors: string[] = []
  const adapter: ModelProviderAdapter = {
    async *stream() {
      order.push('model_started')
      yield { type: 'text_delta', text: '回答成功' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  const result = await new AgentRuntime(adapter).run({
    ...createInput(),
    modelCallObserver: {
      async onStarted() {
        order.push('observer_started')
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw new Error('调试记录暂时不可用')
      },
      async onCompleted() {
        order.push('observer_completed')
      },
      onObserverError(error) {
        observerErrors.push(error instanceof Error ? error.message : String(error))
      },
    },
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.text, '回答成功')
  assert.deepEqual(order.slice(0, 2), ['observer_started', 'model_started'])
  assert.equal(order.at(-1), 'observer_completed')
  assert.deepEqual(observerErrors, ['调试记录暂时不可用'])
})
