import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleAdapter } from './openai-compatible-adapter'

const modelConnection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

function createSseResponse(frames: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('把 OpenAI-compatible SSE 文本流转换为内部事件', async () => {
  const originalFetch = globalThis.fetch
  let request: RequestInit | undefined

  globalThis.fetch = async (_input, init) => {
    request = init
    return createSseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ])
  }

  try {
    const controller = new AbortController()
    const events = []
    for await (const event of new OpenAICompatibleAdapter().stream({
      modelConnection,
      messages: [{ role: 'user', content: '你好' }],
      tools: [],
      signal: controller.signal,
    })) {
      events.push(event)
    }

    assert.deepEqual(events, [
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
      {
        type: 'completed',
        finishReason: 'stop',
        tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      },
    ])

    assert.equal(request?.signal, controller.signal)
    const body = JSON.parse(String(request?.body)) as { stream?: boolean; model?: string }
    assert.equal(body.stream, true)
    assert.equal(body.model, 'test-model')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('累积多个工具调用分片后输出完整 tool_call 事件', async () => {
  const originalFetch = globalThis.fetch
  let request: RequestInit | undefined
  globalThis.fetch = async (_input, init) => {
    request = init
    return createSseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_opportunities","arguments":"{\\"status\\":\\"inter"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"viewing\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ])
  }

  try {
    const events = []
    for await (const event of new OpenAICompatibleAdapter().stream({
      modelConnection,
      messages: [{ role: 'user', content: '查找机会' }],
      tools: [
        {
          name: 'search_opportunities',
          description: '搜索机会',
          inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
        },
      ],
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    assert.deepEqual(events, [
      {
        type: 'tool_call',
        callId: 'call_1',
        name: 'search_opportunities',
        arguments: { status: 'interviewing' },
      },
      {
        type: 'completed',
        finishReason: 'tool_call',
        tokenUsage: null,
      },
    ])
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    assert.equal('tool_choice' in body, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('finish_reason 先到、参数尾部分片后到时仍能组装同一工具调用', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    createSseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_qwen_1","function":{"name":"get_capability_profile","arguments":"{"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ])

  try {
    const events = []
    for await (const event of new OpenAICompatibleAdapter().stream({
      modelConnection,
      messages: [{ role: 'user', content: '查看能力画像' }],
      tools: [{ name: 'get_capability_profile', description: '读取能力画像', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    assert.deepEqual(events, [
      {
        type: 'tool_call',
        callId: 'call_qwen_1',
        name: 'get_capability_profile',
        arguments: {},
      },
      {
        type: 'completed',
        finishReason: 'tool_call',
        tokenUsage: null,
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('供应商省略 tool_call.id 时生成内部关联 ID', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    createSseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_action_strategy","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ])

  try {
    const events = []
    for await (const event of new OpenAICompatibleAdapter().stream({
      modelConnection,
      messages: [{ role: 'user', content: '查看行动策略' }],
      tools: [{ name: 'get_action_strategy', description: '读取行动策略', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    const toolCall = events[0]
    assert.equal(toolCall?.type, 'tool_call')
    if (toolCall?.type !== 'tool_call') throw new Error('缺少工具调用事件')
    assert.match(toolCall.callId, /^call_[a-f0-9]{32}$/)
    assert.equal(toolCall.name, 'get_action_strategy')
    assert.deepEqual(toolCall.arguments, {})
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('模型 HTTP 错误会保留可诊断的错误分类', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'unsupported request parameter' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })

  try {
    await assert.rejects(
      async () => {
        for await (const _event of new OpenAICompatibleAdapter().stream({
          modelConnection,
          messages: [{ role: 'user', content: '测试' }],
          tools: [],
          signal: new AbortController().signal,
        })) {
          // 不会产生流事件。
        }
      },
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'model_configuration_invalid' &&
        error.message === '模型配置不可用，请检查 Base URL、模型名称和接口兼容性',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('DeepSeek 思考模式会收集 reasoning_content，并在工具结果后的请求中原样回传', async () => {
  const originalFetch = globalThis.fetch
  const requestBodies: Array<Record<string, unknown>> = []
  let requestNumber = 0

  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    requestNumber += 1
    if (requestNumber === 1) {
      return createSseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"需要先查询"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_opportunities","arguments":"{}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    }

    return createSseResponse([
      'data: {"choices":[{"delta":{"content":"查询完成"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])
  }

  try {
    const adapter = new OpenAICompatibleAdapter()
    const firstEvents = []
    for await (const event of adapter.stream({
      modelConnection,
      messages: [{ role: 'user', content: '查询机会' }],
      tools: [{ name: 'search_opportunities', description: '搜索机会', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) {
      firstEvents.push(event)
    }

    const completedEvent = firstEvents.at(-1)
    assert.equal(completedEvent?.type, 'completed')
    if (completedEvent?.type !== 'completed') throw new Error('缺少模型完成事件')
    assert.equal(completedEvent.reasoningContent, '需要先查询')

    for await (const _event of adapter.stream({
      modelConnection,
      messages: [
        { role: 'user', content: '查询机会' },
        {
          role: 'assistant',
          content: '',
          reasoningContent: '需要先查询',
          toolCalls: [{ callId: 'call_1', name: 'search_opportunities', arguments: {} }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '{"opportunities":[]}' },
      ],
      tools: [{ name: 'search_opportunities', description: '搜索机会', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) {
      // 这里只需要触发并读取第二次请求。
    }

    const secondMessages = requestBodies[1]?.messages as Array<Record<string, unknown>>
    assert.equal(secondMessages[1]?.reasoning_content, '需要先查询')
    assert.equal(secondMessages[1]?.content, '')
  } finally {
    globalThis.fetch = originalFetch
  }
})
