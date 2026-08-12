import crypto from 'node:crypto'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { ModelConnection } from '../../schemas/model.schema'
import type {
  ModelProviderAdapter,
  ModelProviderMessage,
  ModelProviderStreamEvent,
  ModelProviderStreamInput,
  ModelProviderTool,
} from './model-provider-adapter'
import { AgentToolRegistry, type AgentToolDefinition, type AgentToolInputPreparation } from './agent-tool'
import { z } from 'zod'

type CompletedEvent = Extract<ModelProviderStreamEvent, { type: 'completed' }>
type ToolCallEvent = Extract<ModelProviderStreamEvent, { type: 'tool_call' }>

export type AgentToolResult = {
  call: ToolCallEvent
  output: ChatJsonObject
}

export type AgentModelCallObserver = {
  onStarted?(input: {
    callNumber: number
    messages: ModelProviderMessage[]
    tools: ModelProviderTool[]
  }): void | Promise<void>
  onCompleted?(input: {
    callNumber: number
    text: string
    toolCalls: ToolCallEvent[]
    completed: CompletedEvent
    durationMs: number
  }): void | Promise<void>
  onFailed?(input: { callNumber: number; error: unknown; cancelled: boolean; durationMs: number }): void | Promise<void>
  onObserverError?(error: unknown, input: { callNumber: number; stage: 'started' | 'completed' | 'failed' }): void
}

export type AgentRuntimeInput = {
  modelConnection: ModelConnection
  messages: ModelProviderMessage[]
  toolRegistry: AgentToolRegistry
  signal: AbortSignal
  maxModelCalls?: number
  maxToolCalls?: number
  onEvent?: (event: ModelProviderStreamEvent) => void | Promise<void>
  onToolStarted?: (call: ToolCallEvent) => void | Promise<void>
  onToolResult?: (result: AgentToolResult) => void | Promise<void>
  onToolFailed?: (input: { call: ToolCallEvent; error: unknown; recoverable: boolean }) => void | Promise<void>
  modelCallObserver?: AgentModelCallObserver
}

export type AgentRuntimeConfirmationCheckpoint = {
  toolActionId: string
  messages: ModelProviderMessage[]
  toolResults: AgentToolResult[]
  modelCalls: number
  toolCallsUsed: number
  pendingCall: ToolCallEvent
  toolVersion: string
  recoveryFingerprints?: string[]
  confirmationPresentation?: ChatJsonObject
  confirmationContext?: ChatJsonObject
}

export type AgentRuntimeInputCheckpoint = {
  toolActionId: string
  requestId: string
  messages: ModelProviderMessage[]
  toolResults: AgentToolResult[]
  modelCalls: number
  toolCallsUsed: number
  pendingCall: ToolCallEvent
  toolVersion: string
  recoveryFingerprints?: string[]
  missingArguments: string[]
  inputPresentation: ChatJsonObject
}

export type AgentRuntimeCheckpoint = AgentRuntimeConfirmationCheckpoint | AgentRuntimeInputCheckpoint

const jsonObjectSchema = z.object({}).catchall(z.unknown())
const providerToolCallSchema = z
  .object({
    callId: z.string().min(1),
    name: z.string().min(1),
    arguments: jsonObjectSchema,
  })
  .strict()
const toolCallEventSchema = z
  .object({
    type: z.literal('tool_call'),
    callId: z.string().min(1),
    name: z.string().min(1),
    arguments: jsonObjectSchema,
  })
  .strict()
const providerMessageSchema = z.union([
  z.object({ role: z.enum(['system', 'user']), content: z.string() }).strict(),
  z
    .object({
      role: z.literal('assistant'),
      content: z.string(),
      reasoningContent: z.string().optional(),
      toolCalls: z.array(providerToolCallSchema).optional(),
    })
    .strict(),
  z.object({ role: z.literal('tool'), toolCallId: z.string().min(1), content: z.string() }).strict(),
])
const agentToolResultSchema = z.object({ call: toolCallEventSchema, output: jsonObjectSchema }).strict()
const agentRuntimeConfirmationCheckpointSchema = z
  .object({
    kind: z.literal('agent_runtime_confirmation_checkpoint'),
    version: z.literal(1),
    toolActionId: z.string().uuid(),
    messages: z.array(providerMessageSchema),
    toolResults: z.array(agentToolResultSchema),
    modelCalls: z.number().int().nonnegative(),
    toolCallsUsed: z.number().int().nonnegative(),
    pendingCall: toolCallEventSchema,
    toolVersion: z.string().min(1),
    recoveryFingerprints: z.array(z.string().min(1)).optional(),
    confirmationPresentation: jsonObjectSchema.optional(),
    confirmationContext: jsonObjectSchema.optional(),
  })
  .strict()

const agentRuntimeInputCheckpointSchema = z
  .object({
    kind: z.literal('agent_runtime_input_checkpoint'),
    version: z.literal(1),
    toolActionId: z.string().uuid(),
    requestId: z.string().uuid(),
    messages: z.array(providerMessageSchema),
    toolResults: z.array(agentToolResultSchema),
    modelCalls: z.number().int().nonnegative(),
    toolCallsUsed: z.number().int().nonnegative(),
    pendingCall: toolCallEventSchema,
    toolVersion: z.string().min(1),
    recoveryFingerprints: z.array(z.string().min(1)).optional(),
    // waiting_input 既可以补缺失字段，也可以让用户核对并修改模型已经填写完整的参数。
    missingArguments: z.array(z.string().min(1)),
    inputPresentation: jsonObjectSchema,
  })
  .strict()

/** 把内存 checkpoint 转成可以放进 chat_runs.runtime_state 的 JSON 对象。 */
export function serializeAgentRuntimeCheckpoint(checkpoint: AgentRuntimeCheckpoint): ChatJsonObject {
  if ('requestId' in checkpoint) {
    return {
      kind: 'agent_runtime_input_checkpoint',
      version: 1,
      ...checkpoint,
    }
  }
  return {
    kind: 'agent_runtime_confirmation_checkpoint',
    version: 1,
    ...checkpoint,
  }
}

/** 从数据库 JSON 恢复 checkpoint；不符合协议的数据不能继续执行工具。 */
export function parseAgentRuntimeCheckpoint(input: unknown): AgentRuntimeCheckpoint {
  const confirmation = agentRuntimeConfirmationCheckpointSchema.safeParse(input)
  if (confirmation.success) {
    const { kind: _kind, version: _version, ...checkpoint } = confirmation.data
    return checkpoint
  }

  const waitingInput = agentRuntimeInputCheckpointSchema.safeParse(input)
  if (waitingInput.success) {
    const { kind: _kind, version: _version, ...checkpoint } = waitingInput.data
    return checkpoint
  }

  const issues = [...confirmation.error.issues, ...waitingInput.error.issues]
  throw new Error(`AgentRuntime checkpoint 无效：${issues.map((issue) => issue.message).join('；')}`)
}

export type AgentRuntimeCompletedResult = {
  status: 'completed'
  text: string
  toolResults: AgentToolResult[]
  completed: CompletedEvent
  modelCalls: number
}

export type AgentRuntimeWaitingConfirmationResult = {
  status: 'waiting_confirmation'
  checkpoint: AgentRuntimeConfirmationCheckpoint
  modelCalls: number
}

export type AgentRuntimeWaitingInputResult = {
  status: 'waiting_input'
  checkpoint: AgentRuntimeInputCheckpoint
  modelCalls: number
}

export type AgentRuntimeResult =
  AgentRuntimeCompletedResult | AgentRuntimeWaitingInputResult | AgentRuntimeWaitingConfirmationResult

type SingleModelResult = {
  text: string
  toolCalls: ToolCallEvent[]
  completed: CompletedEvent
}

type RuntimeLoopState = {
  messages: ModelProviderMessage[]
  toolResults: AgentToolResult[]
  modelCalls: number
  toolCallsUsed: number
  recoveryFingerprints: Set<string>
}

type ToolInputValidationIssue = {
  path: string
  message: string
}

class AgentToolInputValidationError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: ToolInputValidationIssue[],
  ) {
    super(`工具 ${toolName} 参数校验失败：${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
    this.name = 'AgentToolInputValidationError'
  }
}

function toToolInputValidationError(definition: AgentToolDefinition, error: unknown) {
  if (error instanceof AgentToolInputValidationError) return error
  if (!(error instanceof z.ZodError)) return null

  return new AgentToolInputValidationError(
    definition.name,
    error.issues.map((issue) => ({
      path: issue.path.join('.') || '<root>',
      message: issue.message,
    })),
  )
}

function createRecoveryFingerprint(
  definition: AgentToolDefinition,
  kind: 'invalid_input' | 'execution_failed',
  error: unknown,
) {
  const details =
    error instanceof AgentToolInputValidationError
      ? error.issues
      : {
          name: error instanceof Error ? error.name : 'UnknownError',
          code:
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null,
        }

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ toolName: definition.name, kind, details }))
    .digest('hex')
}

function createToolFailureObservation(
  definition: AgentToolDefinition,
  kind: 'invalid_input' | 'execution_failed',
  error: unknown,
): ChatJsonObject {
  if (kind === 'invalid_input' && error instanceof AgentToolInputValidationError) {
    return {
      status: 'error',
      error: {
        code: 'invalid_tool_input',
        message: `工具 ${definition.name} 的参数未通过校验。`,
        issues: error.issues,
      },
      recoveryInstruction: '根据 issues 修正参数后重新调用合适的工具；不要声称工具已经执行。',
    }
  }

  return {
    status: 'error',
    error: {
      code: 'tool_execution_failed',
      message: `只读工具 ${definition.name} 未能返回结果。`,
    },
    recoveryInstruction:
      '不要重复相同的失败调用，也不要编造查询结果；可以改用其他已注册的只读工具，或者向用户如实说明当前无法取得数据。',
  }
}

async function tryReturnToolFailureToModel(
  input: AgentRuntimeInput,
  state: RuntimeLoopState,
  definition: AgentToolDefinition,
  call: ToolCallEvent,
  error: unknown,
  kind: 'invalid_input' | 'execution_failed',
) {
  const policyAllowsRecovery = kind === 'invalid_input' || definition.executionFailurePolicy === 'return_to_model'
  const fingerprint = createRecoveryFingerprint(definition, kind, error)
  const recoverable = policyAllowsRecovery && !input.signal.aborted && !state.recoveryFingerprints.has(fingerprint)

  await input.onToolFailed?.({ call, error, recoverable })
  if (!recoverable) return false

  state.recoveryFingerprints.add(fingerprint)
  state.messages.push({
    role: 'tool',
    toolCallId: call.callId,
    content: JSON.stringify(createToolFailureObservation(definition, kind, error)),
  })
  return true
}

async function consumeModelStream(
  adapter: ModelProviderAdapter,
  input: ModelProviderStreamInput,
  onEvent?: (event: ModelProviderStreamEvent) => void | Promise<void>,
): Promise<SingleModelResult> {
  let text = ''
  const toolCalls: ToolCallEvent[] = []
  let completed: CompletedEvent | null = null

  for await (const event of adapter.stream(input)) {
    if (completed) {
      throw new Error('模型已完成输出，但又返回了额外事件')
    }

    await onEvent?.(event)

    if (event.type === 'text_delta') {
      text += event.text
    } else if (event.type === 'tool_call') {
      toolCalls.push(event)
    } else {
      completed = event
    }
  }

  if (!completed) {
    throw new Error('模型流结束时没有返回 completed 事件')
  }

  return { text, toolCalls, completed }
}

async function notifyModelCallObserver(
  observer: AgentModelCallObserver | undefined,
  callNumber: number,
  stage: 'started' | 'completed' | 'failed',
  callback: (() => void | Promise<void>) | undefined,
) {
  if (!callback) return

  try {
    await callback()
  } catch (error) {
    // 调试记录是旁路能力，持久化失败不能中断用户正在进行的主对话。
    try {
      observer?.onObserverError?.(error, { callNumber, stage })
    } catch {
      // 连错误上报本身也不能反向影响模型调用。
    }
  }
}

async function executeTool(
  input: AgentRuntimeInput,
  definition: AgentToolDefinition,
  call: ToolCallEvent,
  confirmationContext?: ChatJsonObject,
): Promise<AgentToolResult> {
  const validatedInput = validateToolInput(definition, call.arguments)
  await input.onToolStarted?.(call)
  const output = await definition.execute(validatedInput, { signal: input.signal, confirmationContext })
  return { call, output }
}

/**
 * AgentRuntime 负责模型调用、工具循环和确认暂停；数据库事件、SSE 推送由回调接入。
 */
export class AgentRuntime {
  constructor(private readonly adapter: ModelProviderAdapter) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    return this.runLoop(input, {
      messages: [...input.messages],
      toolResults: [],
      modelCalls: 0,
      toolCallsUsed: 0,
      recoveryFingerprints: new Set(),
    })
  }

  async resume(
    input: AgentRuntimeInput,
    checkpoint: AgentRuntimeConfirmationCheckpoint,
    decision: 'approved' | 'rejected',
  ): Promise<AgentRuntimeResult> {
    const definition = input.toolRegistry.get(checkpoint.pendingCall.name)
    if (!definition) {
      throw new Error(`待确认工具已不存在：${checkpoint.pendingCall.name}`)
    }
    if (definition.version !== checkpoint.toolVersion) {
      throw new Error(`待确认工具版本已变化：${checkpoint.pendingCall.name}`)
    }

    const state: RuntimeLoopState = {
      messages: [...checkpoint.messages],
      toolResults: [...checkpoint.toolResults],
      modelCalls: checkpoint.modelCalls,
      toolCallsUsed: checkpoint.toolCallsUsed,
      recoveryFingerprints: new Set(checkpoint.recoveryFingerprints ?? []),
    }

    if (decision === 'rejected') {
      state.messages.push({
        role: 'tool',
        toolCallId: checkpoint.pendingCall.callId,
        content: JSON.stringify({ status: 'rejected', reason: 'user_rejected' }),
      })
      return this.runLoop(input, state)
    }

    let toolResult: AgentToolResult
    try {
      toolResult = await executeTool(input, definition, checkpoint.pendingCall, checkpoint.confirmationContext)
    } catch (error) {
      const recovered = await tryReturnToolFailureToModel(
        input,
        state,
        definition,
        checkpoint.pendingCall,
        error,
        'execution_failed',
      )
      if (recovered) return this.runLoop(input, state)
      throw error
    }
    state.toolResults.push(toolResult)
    await input.onToolResult?.(toolResult)
    state.messages.push({
      role: 'tool',
      toolCallId: checkpoint.pendingCall.callId,
      content: JSON.stringify(toolResult.output),
    })

    return this.runLoop(input, state)
  }

  async resumeInput(
    input: AgentRuntimeInput,
    checkpoint: AgentRuntimeInputCheckpoint,
    value: unknown,
  ): Promise<AgentRuntimeResult> {
    const definition = input.toolRegistry.get(checkpoint.pendingCall.name)
    if (!definition?.prepareInput) {
      throw new Error(`待补充参数的工具已不存在或不再支持补充输入：${checkpoint.pendingCall.name}`)
    }
    if (definition.version !== checkpoint.toolVersion) {
      throw new Error(`待补充参数的工具版本已变化：${checkpoint.pendingCall.name}`)
    }

    const preparation = await definition.prepareInput(checkpoint.pendingCall.arguments, value, {
      signal: input.signal,
    })
    const pendingCall = { ...checkpoint.pendingCall, arguments: preparation.input }

    if (preparation.status === 'waiting_input') {
      return {
        status: 'waiting_input',
        checkpoint: {
          ...checkpoint,
          requestId: crypto.randomUUID(),
          pendingCall,
          missingArguments: preparation.missingArguments,
          inputPresentation: preparation.presentation,
        },
        modelCalls: checkpoint.modelCalls,
      }
    }

    const validatedCall = { ...pendingCall, arguments: validateToolInput(definition, preparation.input) }
    if (definition.requiresConfirmation) {
      const confirmation = await definition.prepareConfirmation?.(validatedCall.arguments, {
        signal: input.signal,
      })
      return {
        status: 'waiting_confirmation',
        checkpoint: {
          toolActionId: checkpoint.toolActionId,
          messages: [...checkpoint.messages],
          toolResults: [...checkpoint.toolResults],
          modelCalls: checkpoint.modelCalls,
          toolCallsUsed: checkpoint.toolCallsUsed,
          pendingCall: validatedCall,
          toolVersion: checkpoint.toolVersion,
          ...(checkpoint.recoveryFingerprints?.length ? { recoveryFingerprints: checkpoint.recoveryFingerprints } : {}),
          ...(confirmation?.presentation ? { confirmationPresentation: confirmation.presentation } : {}),
          ...(confirmation?.executionContext ? { confirmationContext: confirmation.executionContext } : {}),
        },
        modelCalls: checkpoint.modelCalls,
      }
    }

    const state: RuntimeLoopState = {
      messages: [...checkpoint.messages],
      toolResults: [...checkpoint.toolResults],
      modelCalls: checkpoint.modelCalls,
      toolCallsUsed: checkpoint.toolCallsUsed,
      recoveryFingerprints: new Set(checkpoint.recoveryFingerprints ?? []),
    }
    let toolResult: AgentToolResult
    try {
      toolResult = await executeTool(input, definition, validatedCall)
    } catch (error) {
      const recovered = await tryReturnToolFailureToModel(
        input,
        state,
        definition,
        validatedCall,
        error,
        'execution_failed',
      )
      if (recovered) return this.runLoop(input, state)
      throw error
    }
    state.toolResults.push(toolResult)
    await input.onToolResult?.(toolResult)
    state.messages.push({
      role: 'tool',
      toolCallId: validatedCall.callId,
      content: JSON.stringify(toolResult.output),
    })
    return this.runLoop(input, state)
  }

  private async runLoop(input: AgentRuntimeInput, state: RuntimeLoopState): Promise<AgentRuntimeResult> {
    const maxModelCalls = input.maxModelCalls ?? 4
    const maxToolCalls = input.maxToolCalls ?? 8

    while (state.modelCalls < maxModelCalls) {
      state.modelCalls += 1
      const callNumber = state.modelCalls
      const tools = input.toolRegistry.toProviderTools()
      const startedAt = performance.now()
      // 启动记录和模型请求并行开始，避免远程数据库写入增加首字等待时间。
      const startedObservation = notifyModelCallObserver(
        input.modelCallObserver,
        callNumber,
        'started',
        input.modelCallObserver?.onStarted
          ? () =>
              input.modelCallObserver!.onStarted!({
                callNumber,
                messages: [...state.messages],
                tools: [...tools],
              })
          : undefined,
      )

      let result: SingleModelResult
      try {
        result = await consumeModelStream(
          this.adapter,
          {
            modelConnection: input.modelConnection,
            messages: state.messages,
            tools,
            signal: input.signal,
          },
          input.onEvent,
        )
      } catch (error) {
        await startedObservation
        await notifyModelCallObserver(
          input.modelCallObserver,
          callNumber,
          'failed',
          input.modelCallObserver?.onFailed
            ? () =>
                input.modelCallObserver!.onFailed!({
                  callNumber,
                  error,
                  cancelled: input.signal.aborted,
                  durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
                })
            : undefined,
        )
        throw error
      }

      await startedObservation
      await notifyModelCallObserver(
        input.modelCallObserver,
        callNumber,
        'completed',
        input.modelCallObserver?.onCompleted
          ? () =>
              input.modelCallObserver!.onCompleted!({
                callNumber,
                text: result.text,
                toolCalls: result.toolCalls,
                completed: result.completed,
                durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
              })
          : undefined,
      )

      if (result.toolCalls.length === 0) {
        return {
          status: 'completed',
          text: result.text,
          toolResults: state.toolResults,
          completed: result.completed,
          modelCalls: state.modelCalls,
        }
      }

      if (result.completed.finishReason !== 'tool_call') {
        throw new Error('模型返回工具调用，但完成原因不是 tool_call')
      }

      state.messages.push({
        role: 'assistant',
        content: result.text,
        ...(result.completed.reasoningContent ? { reasoningContent: result.completed.reasoningContent } : {}),
        toolCalls: result.toolCalls.map((call) => ({
          callId: call.callId,
          name: call.name,
          arguments: call.arguments,
        })),
      })

      for (const call of result.toolCalls) {
        if (state.toolCallsUsed >= maxToolCalls) {
          throw new Error('工具调用次数超过本次运行预算')
        }
        state.toolCallsUsed += 1

        const definition = input.toolRegistry.get(call.name)
        if (!definition) {
          throw new Error(`模型请求了未注册工具：${call.name}`)
        }

        let preparation: AgentToolInputPreparation
        try {
          preparation = definition.prepareInput
            ? await definition.prepareInput(call.arguments, undefined, { signal: input.signal })
            : { status: 'ready', input: call.arguments }
        } catch (error) {
          const validationError = toToolInputValidationError(definition, error)
          const normalizedError = validationError ?? error
          const recovered = await tryReturnToolFailureToModel(
            input,
            state,
            definition,
            call,
            normalizedError,
            validationError ? 'invalid_input' : 'execution_failed',
          )
          if (recovered) continue
          throw normalizedError
        }

        if (preparation.status === 'waiting_input') {
          return {
            status: 'waiting_input',
            checkpoint: {
              toolActionId: crypto.randomUUID(),
              requestId: crypto.randomUUID(),
              messages: [...state.messages],
              toolResults: [...state.toolResults],
              modelCalls: state.modelCalls,
              toolCallsUsed: state.toolCallsUsed,
              pendingCall: { ...call, arguments: preparation.input },
              toolVersion: definition.version,
              ...(state.recoveryFingerprints.size > 0 ? { recoveryFingerprints: [...state.recoveryFingerprints] } : {}),
              missingArguments: preparation.missingArguments,
              inputPresentation: preparation.presentation,
            },
            modelCalls: state.modelCalls,
          }
        }

        const preparedCall = { ...call, arguments: preparation.input }
        let validatedCall: ToolCallEvent
        try {
          validatedCall = { ...preparedCall, arguments: validateToolInput(definition, preparedCall.arguments) }
        } catch (error) {
          const validationError = toToolInputValidationError(definition, error) ?? error
          const recovered = await tryReturnToolFailureToModel(
            input,
            state,
            definition,
            preparedCall,
            validationError,
            'invalid_input',
          )
          if (recovered) continue
          throw validationError
        }

        if (definition.requiresConfirmation) {
          // 先校验模型参数，再生成确认卡片。无效参数不能进入等待用户确认的业务状态。
          const confirmation = await definition.prepareConfirmation?.(validatedCall.arguments, {
            signal: input.signal,
          })

          return {
            status: 'waiting_confirmation',
            checkpoint: {
              toolActionId: crypto.randomUUID(),
              messages: [...state.messages],
              toolResults: [...state.toolResults],
              modelCalls: state.modelCalls,
              toolCallsUsed: state.toolCallsUsed,
              pendingCall: validatedCall,
              toolVersion: definition.version,
              ...(state.recoveryFingerprints.size > 0 ? { recoveryFingerprints: [...state.recoveryFingerprints] } : {}),
              ...(confirmation?.presentation ? { confirmationPresentation: confirmation.presentation } : {}),
              ...(confirmation?.executionContext ? { confirmationContext: confirmation.executionContext } : {}),
            },
            modelCalls: state.modelCalls,
          }
        }

        let toolResult: AgentToolResult
        try {
          toolResult = await executeTool(input, definition, validatedCall)
        } catch (error) {
          const recovered = await tryReturnToolFailureToModel(
            input,
            state,
            definition,
            validatedCall,
            error,
            'execution_failed',
          )
          if (recovered) continue
          throw error
        }
        state.toolResults.push(toolResult)
        await input.onToolResult?.(toolResult)
        state.messages.push({
          role: 'tool',
          toolCallId: validatedCall.callId,
          content: JSON.stringify(toolResult.output),
        })
      }
    }

    throw new Error('模型调用次数超过本次运行预算')
  }
}

function validateToolInput(definition: AgentToolDefinition, input: ChatJsonObject): ChatJsonObject {
  const result = definition.inputValidator.safeParse(input)
  if (!result.success) {
    throw new AgentToolInputValidationError(
      definition.name,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      })),
    )
  }

  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    throw new AgentToolInputValidationError(definition.name, [
      { path: '<root>', message: '参数校验结果必须是 JSON 对象' },
    ])
  }

  return result.data as ChatJsonObject
}
