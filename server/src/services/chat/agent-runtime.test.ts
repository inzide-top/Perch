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

test('同一次模型返回多个写工具时逐张确认，不会丢掉后续操作', async () => {
  const adapter = new FakeAdapter([
    [
      { type: 'text_delta', text: '我先帮你核对这两项修改。' },
      { type: 'tool_call', callId: 'call_profile', name: 'update_profile', arguments: { value: 'A' } },
      { type: 'tool_call', callId: 'call_status', name: 'update_status', arguments: { value: 'interviewing' } },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '两项修改都已执行完成。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const executions: string[] = []
  const createWriteTool = (name: string) => ({
    name,
    version: '1',
    description: name,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    inputValidator: z.object({ value: z.string().min(1) }).strict(),
    requiresConfirmation: true,
    execute: async (input: Record<string, unknown>) => {
      executions.push(name)
      return { value: input.value }
    },
  })
  const runtime = new AgentRuntime(adapter)
  const input = createInput(
    new AgentToolRegistry([createWriteTool('update_profile'), createWriteTool('update_status')]),
  )

  const firstWaiting = await runtime.run(input)
  assert.equal(firstWaiting.status, 'waiting_confirmation')
  if (firstWaiting.status !== 'waiting_confirmation') return
  assert.equal(firstWaiting.checkpoint.pendingCall.name, 'update_profile')
  assert.deepEqual(
    firstWaiting.checkpoint.remainingCalls?.map((call) => call.name),
    ['update_status'],
  )
  assert.equal(adapter.inputs.length, 1)

  const secondWaiting = await runtime.resume(input, firstWaiting.checkpoint, 'approved')
  assert.equal(secondWaiting.status, 'waiting_confirmation')
  if (secondWaiting.status !== 'waiting_confirmation') return
  assert.equal(secondWaiting.checkpoint.pendingCall.name, 'update_status')
  assert.equal(secondWaiting.checkpoint.toolActionIds?.length, 2)
  assert.deepEqual(executions, ['update_profile'])
  // 第一项通过后直接展示第二张卡，不允许模型提前总结。
  assert.equal(adapter.inputs.length, 1)

  const completed = await runtime.resume(input, secondWaiting.checkpoint, 'approved')
  assert.equal(completed.status, 'completed')
  if (completed.status !== 'completed') return
  assert.deepEqual(executions, ['update_profile', 'update_status'])
  assert.equal(completed.toolActionIds.length, 2)
  assert.equal(adapter.inputs.length, 2)
  assert.deepEqual(
    adapter.inputs[1]?.messages.slice(-3).map((message) => message.role === 'tool' && message.toolCallId),
    [false, 'call_profile', 'call_status'],
  )
})

test('同批次前一项写入失败时记录失败并继续确认后续独立操作', async () => {
  const adapter = new FakeAdapter([
    [
      { type: 'tool_call', callId: 'call-failed-profile', name: 'update_profile', arguments: { value: 'A' } },
      { type: 'tool_call', callId: 'call-next-status', name: 'update_status', arguments: { value: 'interviewing' } },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '意向修改失败，阶段修改成功。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const failedCalls: string[] = []
  let statusExecuteCount = 0
  const createWriteTool = (
    name: string,
    execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) => ({
    name,
    version: '1',
    description: name,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    inputValidator: z.object({ value: z.string().min(1) }).strict(),
    requiresConfirmation: true,
    execute,
  })
  const registry = new AgentToolRegistry([
    createWriteTool('update_profile', async () => {
      throw new Error('机会资料版本已变化')
    }),
    createWriteTool('update_status', async (input) => {
      statusExecuteCount += 1
      return { value: input.value }
    }),
  ])
  const runtime = new AgentRuntime(adapter)
  const input: AgentRuntimeInput = {
    ...createInput(registry),
    onToolFailed: ({ call }) => {
      failedCalls.push(call.callId)
    },
  }

  const firstWaiting = await runtime.run(input)
  assert.equal(firstWaiting.status, 'waiting_confirmation')
  if (firstWaiting.status !== 'waiting_confirmation') return

  const secondWaiting = await runtime.resume(input, firstWaiting.checkpoint, 'approved')
  assert.equal(secondWaiting.status, 'waiting_confirmation')
  if (secondWaiting.status !== 'waiting_confirmation') return
  assert.equal(secondWaiting.checkpoint.pendingCall.callId, 'call-next-status')
  assert.deepEqual(failedCalls, ['call-failed-profile'])

  const completed = await runtime.resume(input, secondWaiting.checkpoint, 'approved')
  assert.equal(completed.status, 'completed')
  if (completed.status !== 'completed') return
  assert.equal(statusExecuteCount, 1)
  assert.equal(completed.text, '意向修改失败，阶段修改成功。')
  assert.equal(adapter.inputs.length, 2)
  assert.deepEqual(
    adapter.inputs[1]?.messages
      .slice(-3)
      .map((message) =>
        message.role === 'tool' ? { callId: message.toolCallId, content: message.content } : { role: message.role },
      ),
    [
      { role: 'assistant' },
      {
        callId: 'call-failed-profile',
        content: JSON.stringify({
          status: 'error',
          error: {
            code: 'tool_execution_failed',
            message: '工具 update_profile 执行失败，本项修改未完成。',
          },
          recoveryInstruction: '不要重试或声称本项已完成；继续处理同一次请求中尚未执行的其他独立操作。',
        }),
      },
      { callId: 'call-next-status', content: JSON.stringify({ value: 'interviewing' }) },
    ],
  )
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

test('需要确认的工具参数错误时会先让模型修正，再展示确认卡片', async () => {
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
    [
      {
        type: 'tool_call',
        callId: 'call-corrected-confirmation',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const executeCount = { value: 0 }
  const registry = new AgentToolRegistry([createSearchTool(true, executeCount)])

  const result = await new AgentRuntime(adapter).run(createInput(registry))

  assert.equal(result.status, 'waiting_confirmation')
  if (result.status !== 'waiting_confirmation') return
  assert.equal(result.modelCalls, 2)
  assert.equal(executeCount.value, 0)
  assert.deepEqual(result.checkpoint.pendingCall.arguments, { status: 'interviewing' })
  assert.equal(result.checkpoint.recoveryFingerprints?.length, 1)

  const observation = adapter.inputs[1]?.messages.at(-1)
  assert.equal(observation?.role, 'tool')
  if (observation?.role !== 'tool') return
  assert.equal(JSON.parse(observation.content).error.code, 'invalid_tool_input')
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

test('Runtime 把无效工具参数作为 Observation 交回模型，并只执行修正后的参数', async () => {
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
    [
      {
        type: 'tool_call',
        callId: 'call_2',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '已找到面试中的机会。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
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

  const result = await new AgentRuntime(adapter).run(createInput(registry))

  assert.equal(result.status, 'completed')
  assert.equal(result.text, '已找到面试中的机会。')
  assert.equal(executeCount, 1)
  const observation = adapter.inputs[1]?.messages.at(-1)
  assert.equal(observation?.role, 'tool')
  if (observation?.role !== 'tool') return
  assert.deepEqual(JSON.parse(observation.content).error.issues, [
    { path: 'status', message: 'Too small: expected string to have >=1 characters' },
  ])
})

test('相同的无效参数只允许模型修正一次，避免无限自愈循环', async () => {
  const executeCount = { value: 0 }
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_invalid_1',
        name: 'search_opportunities',
        arguments: { status: '' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      {
        type: 'tool_call',
        callId: 'call_invalid_2',
        name: 'search_opportunities',
        arguments: { status: '' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])

  await assert.rejects(
    new AgentRuntime(adapter).run(createInput(new AgentToolRegistry([createSearchTool(false, executeCount)]))),
    /参数校验失败/,
  )
  assert.equal(executeCount.value, 0)
  assert.equal(adapter.inputs.length, 2)
})

test('只读工具执行失败后，模型可以改用另一个只读工具完成回答', async () => {
  let primaryExecuteCount = 0
  let fallbackExecuteCount = 0
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_primary',
        name: 'primary_lookup',
        arguments: { keyword: '前端' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      {
        type: 'tool_call',
        callId: 'call_fallback',
        name: 'fallback_lookup',
        arguments: { keyword: '前端' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
    [
      { type: 'text_delta', text: '已通过备用数据源找到结果。' },
      { type: 'completed', finishReason: 'stop', tokenUsage: null },
    ],
  ])
  const inputValidator = z.object({ keyword: z.string().min(1) }).strict()
  const registry = new AgentToolRegistry([
    {
      name: 'primary_lookup',
      version: '1',
      description: '主要只读查询',
      inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
      inputValidator,
      executionFailurePolicy: 'return_to_model',
      requiresConfirmation: false,
      execute: async () => {
        primaryExecuteCount += 1
        throw new Error('主要数据源暂时不可用')
      },
    },
    {
      name: 'fallback_lookup',
      version: '1',
      description: '备用只读查询',
      inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
      inputValidator,
      executionFailurePolicy: 'return_to_model',
      requiresConfirmation: false,
      execute: async () => {
        fallbackExecuteCount += 1
        return { matchedCount: 1 }
      },
    },
  ])

  const result = await new AgentRuntime(adapter).run(createInput(registry))

  assert.equal(result.status, 'completed')
  assert.equal(result.text, '已通过备用数据源找到结果。')
  assert.equal(primaryExecuteCount, 1)
  assert.equal(fallbackExecuteCount, 1)
  const observation = adapter.inputs[1]?.messages.at(-1)
  assert.equal(observation?.role, 'tool')
  if (observation?.role !== 'tool') return
  assert.equal(JSON.parse(observation.content).error.code, 'tool_execution_failed')
})

test('写入工具执行失败时不会让模型换方案或重复执行', async () => {
  let executeCount = 0
  const adapter = new FakeAdapter([
    [
      {
        type: 'tool_call',
        callId: 'call_write',
        name: 'update_profile',
        arguments: { note: '优先跟进' },
      },
      { type: 'completed', finishReason: 'tool_call', tokenUsage: null },
    ],
  ])
  const registry = new AgentToolRegistry([
    {
      name: 'update_profile',
      version: '1',
      description: '修改机会资料',
      inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
      inputValidator: z.object({ note: z.string().min(1) }).strict(),
      requiresConfirmation: false,
      execute: async () => {
        executeCount += 1
        throw new Error('数据库连接中断')
      },
    },
  ])

  await assert.rejects(new AgentRuntime(adapter).run(createInput(registry)), /数据库连接中断/)
  assert.equal(executeCount, 1)
  assert.equal(adapter.inputs.length, 1)
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
