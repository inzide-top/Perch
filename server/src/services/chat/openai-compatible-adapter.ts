import { getModelErrorDetails, ModelRequestError, normalizeBaseUrl } from '../ai/model-client'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type {
  ModelProviderAdapter,
  ModelProviderMessage,
  ModelProviderStreamEvent,
  ModelProviderStreamInput,
} from './model-provider-adapter'

type OpenAiStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      tool_calls?: OpenAiToolCallDelta[]
    }
    finish_reason?: unknown
  }>
  usage?: unknown
}

type OpenAiToolCallDelta = {
  index?: unknown
  id?: unknown
  function?: {
    name?: unknown
    arguments?: unknown
  }
}

type ToolCallAccumulator = {
  callId?: string
  name?: string
  argumentsText: string
}

function toFinishReason(value: unknown) {
  if (value === 'stop') return 'stop' as const
  if (value === 'length') return 'length' as const
  if (value === 'tool_calls' || value === 'function_call') return 'tool_call' as const
  return 'unknown' as const
}

function toTokenUsage(value: unknown) {
  if (!value || typeof value !== 'object') return null

  const usage = value as {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
  const inputTokens = Number(usage.prompt_tokens)
  const outputTokens = Number(usage.completion_tokens)
  const totalTokens = Number(usage.total_tokens)

  if (![inputTokens, outputTokens, totalTokens].every(Number.isFinite)) return null

  return { inputTokens, outputTokens, totalTokens }
}

function parseToolArguments(argumentsText: string): ChatJsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText.trim() || '{}')
  } catch {
    throw new Error('模型返回的工具参数不是合法 JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回的工具参数必须是 JSON 对象')
  }

  return parsed as ChatJsonObject
}

function appendToolCallDeltas(accumulators: Map<number, ToolCallAccumulator>, deltas: OpenAiToolCallDelta[]) {
  for (const delta of deltas) {
    const index = Number(delta.index)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('模型返回了无效的工具调用索引')
    }

    const accumulator = accumulators.get(index) ?? { argumentsText: '' }
    if (typeof delta.id === 'string') accumulator.callId = delta.id

    const functionDelta = delta.function
    if (functionDelta && typeof functionDelta.name === 'string') {
      accumulator.name = functionDelta.name
    }
    if (functionDelta && typeof functionDelta.arguments === 'string') {
      accumulator.argumentsText += functionDelta.arguments
    }

    accumulators.set(index, accumulator)
  }
}

function completeToolCalls(accumulators: Map<number, ToolCallAccumulator>): ModelProviderStreamEvent[] {
  const events: ModelProviderStreamEvent[] = []
  const entries = [...accumulators.entries()].sort(([left], [right]) => left - right)

  for (const [, accumulator] of entries) {
    if (!accumulator.name) {
      throw new Error('模型返回的工具调用缺少名称')
    }

    // 部分 OpenAI-compatible 供应商不会返回 tool_call.id。这个字段只用于
    // 在同一次模型交互中关联 assistant 工具请求与 tool 结果，不是业务主键，
    // 因此可在 Adapter 边界生成唯一兼容 ID；工具名和参数仍必须由模型明确返回。
    const callId = accumulator.callId?.trim() || `call_${crypto.randomUUID().replaceAll('-', '')}`

    events.push({
      type: 'tool_call',
      callId,
      name: accumulator.name,
      arguments: parseToolArguments(accumulator.argumentsText),
    })
  }

  accumulators.clear()
  return events
}

async function* readSseData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n')

        if (data) yield data
      }

      if (done) break
    }

    if (buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n')

      if (data) yield data
    }
  } finally {
    reader.releaseLock()
  }
}

function toOpenAiMessage(message: ModelProviderMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    }
  }

  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      // DeepSeek V4 思考模式回传工具调用历史时要求 content 字段存在且为字符串。
      content: message.content,
      ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.callId,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    }
  }

  return message
}

export class OpenAICompatibleAdapter implements ModelProviderAdapter {
  async *stream(input: ModelProviderStreamInput): AsyncGenerator<ModelProviderStreamEvent> {
    const response = await fetch(normalizeBaseUrl(input.modelConnection.baseUrl), {
      method: 'POST',
      signal: input.signal,
      headers: {
        authorization: `Bearer ${input.modelConnection.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelConnection.modelName,
        messages: input.messages.map(toOpenAiMessage),
        tools:
          input.tools.length > 0
            ? input.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              }))
            : undefined,
        stream: true,
        stream_options: {
          include_usage: true,
        },
      }),
    })

    if (!response.ok) {
      const rawError = await response.text().catch(() => '')
      const details = getModelErrorDetails(response.status, rawError)
      throw new ModelRequestError(details.message, details.code, details.retryable, rawError)
    }

    if (!response.body) {
      throw new Error('模型没有返回可读取的流')
    }

    let finishReason: ReturnType<typeof toFinishReason> = 'unknown'
    let tokenUsage = null
    let reasoningContent = ''
    const toolCallAccumulators = new Map<number, ToolCallAccumulator>()

    for await (const data of readSseData(response.body)) {
      if (data === '[DONE]') {
        for (const event of completeToolCalls(toolCallAccumulators)) yield event
        yield {
          type: 'completed',
          finishReason,
          tokenUsage,
          ...(reasoningContent ? { reasoningContent } : {}),
        }
        return
      }

      let chunk: OpenAiStreamChunk
      try {
        chunk = JSON.parse(data) as OpenAiStreamChunk
      } catch {
        throw new Error('模型返回了无法解析的 SSE 数据')
      }

      tokenUsage = toTokenUsage(chunk.usage)
      const choice = chunk.choices?.[0]
      if (choice?.finish_reason !== undefined) {
        finishReason = toFinishReason(choice.finish_reason)
      }

      const content = choice?.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'text_delta', text: content }
      }

      const reasoningDelta = choice?.delta?.reasoning_content
      if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
        reasoningContent += reasoningDelta
      }

      if (choice?.delta?.tool_calls) {
        appendToolCallDeltas(toolCallAccumulators, choice.delta.tool_calls)
      }

      // 部分 OpenAI-compatible 供应商会先发送 finish_reason=tool_calls，
      // 再补发只含 arguments 的工具调用分片。这里不能提前清空累积器，
      // 否则尾部分片会被误认为一条缺少 id/name 的新工具调用。
      // 统一等 [DONE] 或响应流结束后再组装完整工具调用。
    }

    for (const event of completeToolCalls(toolCallAccumulators)) yield event
    yield {
      type: 'completed',
      finishReason,
      tokenUsage,
      ...(reasoningContent ? { reasoningContent } : {}),
    }
  }
}
