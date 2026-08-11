import crypto from 'node:crypto'
import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import { getInterviewBudgetForScale, type InterviewConfiguration } from '@/shared/interview/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import {
  readProvidedOpportunityId,
  resolveGlobalOpportunityTarget,
  type CreateMockInterviewForUser,
  type FindOpportunitiesByUserId,
} from './read-tools'

const mockInterviewTypeSchema = z.enum(['foundation', 'project'])
const mockInterviewScaleSchema = z.enum(['quick', 'standard', 'deep'])
const mockInterviewDifficultySchema = z.enum(['basic', 'standard', 'advanced', 'adaptive'])
const mockInterviewPartialInputSchema = z
  .object({
    type: mockInterviewTypeSchema.optional(),
    scale: mockInterviewScaleSchema.optional(),
    difficulty: mockInterviewDifficultySchema.optional(),
    referenceHistoricalWeaknesses: z.boolean().optional(),
  })
  .strict()
const mockInterviewInputSchema = mockInterviewPartialInputSchema.required({
  type: true,
  scale: true,
  difficulty: true,
  referenceHistoricalWeaknesses: true,
})
const globalMockInterviewPartialInputSchema = mockInterviewPartialInputSchema
  .extend({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .strict()
const globalMockInterviewInputSchema = globalMockInterviewPartialInputSchema.required({
  opportunityId: true,
  type: true,
  scale: true,
  difficulty: true,
  referenceHistoricalWeaknesses: true,
})
const mockInterviewExecutionContextSchema = z
  .object({
    sessionId: z.string().uuid(),
    opportunityId: z.string().uuid(),
    configuration: z.object({
      type: mockInterviewTypeSchema,
      scale: mockInterviewScaleSchema,
      difficulty: mockInterviewDifficultySchema,
      referenceHistoricalWeaknesses: z.boolean(),
      budget: z.object({
        mainTopicBudget: z.number().int().positive(),
        totalQuestionBudget: z.number().int().positive(),
        maxFollowUpsPerRoot: z.number().int().min(0).max(3),
      }),
    }),
  })
  .strict()

const mockInterviewTypeLabels = { foundation: '基础面', project: '项目面' } as const
const mockInterviewScaleLabels = { quick: '快速', standard: '标准', deep: '深度' } as const
const mockInterviewDifficultyLabels = {
  basic: '简单',
  standard: '标准',
  advanced: '进阶',
  adaptive: '自适应',
} as const

function extractMockInterviewProvidedValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as ChatJsonObject
  const configurationValue = {
    ...('type' in record ? { type: record.type } : {}),
    ...('scale' in record ? { scale: record.scale } : {}),
    ...('difficulty' in record ? { difficulty: record.difficulty } : {}),
    ...('referenceHistoricalWeaknesses' in record
      ? { referenceHistoricalWeaknesses: record.referenceHistoricalWeaknesses }
      : {}),
  }
  if (Object.keys(configurationValue).length === 0) return undefined

  return mockInterviewPartialInputSchema.parse(configurationValue)
}

export function createMockInterviewTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  createMockInterviewForUser: CreateMockInterviewForUser,
): AgentToolDefinition {
  return {
    name: 'create_mock_interview',
    version: '1',
    description:
      '为当前绑定机会创建一场 AI 模拟面试。用户明确要求新建、开始或安排模拟面试时调用；缺少面试类型、规模、难度或是否参考历史薄弱项时也要调用，产品会用配置卡补齐。不要把真实面试安排误判为模拟面试。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: mockInterviewTypeSchema.options,
          description: '模拟面试类型：基础面 foundation、项目面 project。用户没有明确说明时省略。',
        },
        scale: {
          type: 'string',
          enum: mockInterviewScaleSchema.options,
          description: '面试规模：快速 quick、标准 standard、深度 deep。用户没有明确说明时省略。',
        },
        difficulty: {
          type: 'string',
          enum: mockInterviewDifficultySchema.options,
          description: '面试难度：简单 basic、标准 standard、进阶 advanced、自适应 adaptive。用户没有明确说明时省略。',
        },
        referenceHistoricalWeaknesses: {
          type: 'boolean',
          description: '是否参考历史薄弱项。只有用户明确表达时填写，否则省略并交给产品卡片选择。',
        },
      },
    },
    inputValidator: mockInterviewInputSchema,
    requiresConfirmation: true,
    prepareInput: (input, providedValue) => {
      const provided =
        providedValue && typeof providedValue === 'object' && !Array.isArray(providedValue)
          ? (providedValue as ChatJsonObject)
          : {}
      const partial = mockInterviewPartialInputSchema.parse({ ...input, ...provided })
      const missingArguments = [
        ...(!partial.type ? ['type' as const] : []),
        ...(!partial.scale ? ['scale' as const] : []),
        ...(!partial.difficulty ? ['difficulty' as const] : []),
        ...(partial.referenceHistoricalWeaknesses === undefined ? ['referenceHistoricalWeaknesses' as const] : []),
      ]

      if (missingArguments.length > 0) {
        return {
          status: 'waiting_input',
          input: partial,
          missingArguments,
          presentation: {
            kind: 'mock_interview_input',
            title: '配置模拟面试',
            opportunityId: opportunity.id,
            company: opportunity.company,
            jobTitle: opportunity.jobTitle,
            missingArguments,
            values: partial,
          },
        }
      }

      return { status: 'ready', input: mockInterviewInputSchema.parse(partial) }
    },
    prepareConfirmation: (input) => {
      const configurationInput = mockInterviewInputSchema.parse(input)
      const configuration: InterviewConfiguration = {
        ...configurationInput,
        budget: getInterviewBudgetForScale(configurationInput.scale),
      }
      return {
        presentation: {
          kind: 'mock_interview_create',
          title: '创建模拟面试',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          configuration,
          typeLabel: mockInterviewTypeLabels[configuration.type],
          scaleLabel: mockInterviewScaleLabels[configuration.scale],
          difficultyLabel: mockInterviewDifficultyLabels[configuration.difficulty],
        },
        executionContext: {
          sessionId: crypto.randomUUID(),
          opportunityId: opportunity.id,
          configuration,
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const configurationInput = mockInterviewInputSchema.parse(input)
      const trustedContext = mockInterviewExecutionContextSchema.parse(context.confirmationContext)
      const expectedConfiguration: InterviewConfiguration = {
        ...configurationInput,
        budget: getInterviewBudgetForScale(configurationInput.scale),
      }
      if (JSON.stringify(expectedConfiguration) !== JSON.stringify(trustedContext.configuration)) {
        throw new Error('确认时的模拟面试配置与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('创建模拟面试已取消')

      const result = await createMockInterviewForUser({
        sessionId: trustedContext.sessionId,
        opportunityId: trustedContext.opportunityId,
        userId,
        configuration: trustedContext.configuration,
      })
      return {
        status: 'created',
        opportunityId: trustedContext.opportunityId,
        sessionId: result.session.id,
        sessionStatus: result.session.status,
        alreadyApplied: result.alreadyApplied,
      }
    },
  }
}

export function createGlobalMockInterviewTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  createMockInterviewForUser: CreateMockInterviewForUser,
): AgentToolDefinition {
  return {
    name: 'create_mock_interview',
    version: '1',
    description:
      '为某一个已保存的机会创建 AI 模拟面试。使用 opportunityReference 指向公司、岗位或“公司 + 岗位”；目标缺失或同名时仍然调用，产品会先让用户选择。类型、规模、难度或是否参考历史薄弱项缺失时也要调用并省略，产品会继续展示配置卡。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”；没有明确目标时省略，不要编造数据库 ID。',
        },
        type: {
          type: 'string',
          enum: mockInterviewTypeSchema.options,
          description: '模拟面试类型：基础面 foundation、项目面 project。用户没有明确说明时省略。',
        },
        scale: {
          type: 'string',
          enum: mockInterviewScaleSchema.options,
          description: '面试规模：快速 quick、标准 standard、深度 deep。用户没有明确说明时省略。',
        },
        difficulty: {
          type: 'string',
          enum: mockInterviewDifficultySchema.options,
          description: '面试难度：简单 basic、标准 standard、进阶 advanced、自适应 adaptive。用户没有明确说明时省略。',
        },
        referenceHistoricalWeaknesses: {
          type: 'boolean',
          description: '是否参考历史薄弱项。只有用户明确表达时填写，否则省略并交给产品配置卡选择。',
        },
      },
    },
    inputValidator: globalMockInterviewInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      const providedConfiguration = extractMockInterviewProvidedValue(providedValue)
      const partial = globalMockInterviewPartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
        ...providedConfiguration,
      })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要创建模拟面试的机会',
        description: '请选择本次模拟面试所属的机会。确定目标前不会创建 Session 或生成面试蓝图。',
      })
      if (resolution.status === 'waiting_input') return resolution

      const { opportunityReference, opportunityId: _opportunityId, ...configurationInput } = partial
      const localTool = createMockInterviewTool(userId, resolution.opportunity, createMockInterviewForUser)
      if (!localTool.prepareInput) throw new Error('创建模拟面试工具缺少配置补全逻辑')
      const configurationPreparation = await localTool.prepareInput(configurationInput, providedConfiguration, context)
      const preparedInput = {
        ...(opportunityReference ? { opportunityReference } : {}),
        opportunityId: resolution.opportunity.id,
        ...configurationPreparation.input,
      }
      if (configurationPreparation.status === 'waiting_input') {
        return { ...configurationPreparation, input: preparedInput }
      }
      return { status: 'ready', input: globalMockInterviewInputSchema.parse(preparedInput) }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalMockInterviewInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('创建模拟面试已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...configurationInput } = parsed
      const localTool = createMockInterviewTool(userId, opportunity, createMockInterviewForUser)
      if (!localTool.prepareConfirmation) throw new Error('创建模拟面试工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(mockInterviewInputSchema.parse(configurationInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalMockInterviewInputSchema.parse(input)
      const trustedContext = mockInterviewExecutionContextSchema.parse(context.confirmationContext)
      if (parsed.opportunityId !== trustedContext.opportunityId) {
        throw new Error('确认时的目标机会与模拟面试配置不一致')
      }
      if (context.signal.aborted) throw new Error('创建模拟面试已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...configurationInput } = parsed
      return createMockInterviewTool(userId, opportunity, createMockInterviewForUser).execute(
        mockInterviewInputSchema.parse(configurationInput),
        context,
      )
    },
  }
}
