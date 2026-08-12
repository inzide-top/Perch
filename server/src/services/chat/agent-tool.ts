import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { ZodType } from 'zod'
import type { ModelProviderTool } from './model-provider-adapter'

export type AgentToolExecutionContext = {
  signal: AbortSignal
  /** 由后端在展示确认卡片前生成的可信上下文，不能由模型填写。 */
  confirmationContext?: ChatJsonObject
}

export type AgentToolConfirmationPreparation = {
  /** 只用于前端确认卡片展示，不参与模型参数判断。 */
  presentation: ChatJsonObject
  /** 批准后执行工具时使用的后端可信快照。 */
  executionContext?: ChatJsonObject
}

export type AgentToolInputPreparation =
  | {
      status: 'ready'
      input: ChatJsonObject
    }
  | {
      status: 'waiting_input'
      /** 已经从模型参数和用户补充内容中得到的部分参数。 */
      input: ChatJsonObject
      missingArguments: string[]
      /** 只用于前端补充信息卡片展示，不会直接交给模型执行。 */
      presentation: ChatJsonObject
    }

export type AgentToolDefinition = ModelProviderTool & {
  version: string
  /** false 时只用于恢复历史 checkpoint，不再暴露给模型生成新的调用。 */
  exposeToModel?: boolean
  /**
   * 只有明确无副作用的读取工具才能把执行错误作为 Observation 交回模型。
   * 写入工具默认终止 Run，避免在副作用结果不确定时重复执行或改走其他写入路径。
   */
  executionFailurePolicy?: 'fail_run' | 'return_to_model'
  requiresConfirmation: boolean
  inputValidator: ZodType<unknown>
  /**
   * 工具参数允许分阶段补齐时使用。返回 waiting_input 会暂停 Runtime，
   * 用户提交表单后 Runtime 会用同一个 ToolAction 再次调用本函数。
   */
  prepareInput?: (
    input: ChatJsonObject,
    providedValue: unknown,
    context: Pick<AgentToolExecutionContext, 'signal'>,
  ) => AgentToolInputPreparation | Promise<AgentToolInputPreparation>
  prepareConfirmation?: (
    input: ChatJsonObject,
    context: Pick<AgentToolExecutionContext, 'signal'>,
  ) => AgentToolConfirmationPreparation | Promise<AgentToolConfirmationPreparation>
  execute: (input: ChatJsonObject, context: AgentToolExecutionContext) => Promise<ChatJsonObject>
}

export class AgentToolRegistry {
  private readonly definitions = new Map<string, AgentToolDefinition>()

  constructor(definitions: AgentToolDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.name)) {
        throw new Error(`重复注册工具：${definition.name}`)
      }
      this.definitions.set(definition.name, definition)
    }
  }

  get(name: string) {
    return this.definitions.get(name)
  }

  toProviderTools(): ModelProviderTool[] {
    return [...this.definitions.values()]
      .filter((definition) => definition.exposeToModel !== false)
      .map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }))
  }
}
