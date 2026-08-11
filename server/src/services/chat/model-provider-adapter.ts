import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { ModelConnection } from '../../schemas/model.schema'
import type { AgentTokenUsage } from '../ai/types'

export type ModelProviderToolCall = {
  callId: string
  name: string
  arguments: ChatJsonObject
}

export type ModelProviderMessage =
  | {
      role: 'system' | 'user'
      content: string
    }
  | {
      role: 'assistant'
      content: string
      reasoningContent?: string
      toolCalls?: ModelProviderToolCall[]
    }
  | {
      role: 'tool'
      toolCallId: string
      content: string
    }

export type ModelProviderTool = {
  name: string
  description: string
  inputSchema: ChatJsonObject
}

export type ModelProviderFinishReason = 'stop' | 'tool_call' | 'length' | 'unknown'

export type ModelProviderStreamEvent =
  | {
      type: 'text_delta'
      text: string
    }
  | {
      type: 'tool_call'
      callId: string
      name: string
      arguments: ChatJsonObject
    }
  | {
      type: 'completed'
      finishReason: ModelProviderFinishReason
      tokenUsage: AgentTokenUsage | null
      reasoningContent?: string
    }

export type ModelProviderStreamInput = {
  modelConnection: ModelConnection
  messages: ModelProviderMessage[]
  tools: ModelProviderTool[]
  signal: AbortSignal
}

export interface ModelProviderAdapter {
  stream(input: ModelProviderStreamInput): AsyncIterable<ModelProviderStreamEvent>
}
