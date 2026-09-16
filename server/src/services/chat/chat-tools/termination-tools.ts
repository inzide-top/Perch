import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import {
  opportunityStatusSchema,
  resolveGlobalOpportunityTarget,
  statusLabels,
  type FindOpportunitiesByUserId,
  type TerminateOpportunityForUser,
} from './read-tools'

const mutableOpportunityStatusSchema = opportunityStatusSchema.exclude(['closed'])
const terminationReasonSchema = z.string().trim().max(1_000).default('')
const terminationInputSchema = z
  .object({
    reasonNote: terminationReasonSchema,
    expectedStatus: mutableOpportunityStatusSchema,
  })
  .strict()
const terminationPartialInputSchema = z
  .object({
    reasonNote: z.string().trim().max(1_000).optional(),
    expectedStatus: mutableOpportunityStatusSchema.optional(),
  })
  .strict()
const globalTerminationPartialInputSchema = terminationPartialInputSchema
  .extend({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .strict()
const globalTerminationInputSchema = globalTerminationPartialInputSchema.required({
  opportunityId: true,
  expectedStatus: true,
})

function readProvidedReason(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('reasonNote' in value)) return null
  return terminationReasonSchema.parse((value as ChatJsonObject).reasonNote)
}

function createTerminationPresentation(opportunity: JobOpportunityRecord, reasonNote: string) {
  if (opportunity.status === 'closed') throw new Error('该机会已终止')
  return {
    kind: 'opportunity_termination_input',
    title: '终止机会流程',
    opportunityId: opportunity.id,
    company: opportunity.company,
    jobTitle: opportunity.jobTitle,
    fromStatus: opportunity.status,
    fromStatusLabel: statusLabels[opportunity.status],
    values: { reasonNote },
    warning: '确认后机会将进入已终止，未完成的面试安排会同时取消。',
  }
}

export function createTerminateOpportunityTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  terminateOpportunityForUser: TerminateOpportunityForUser,
): AgentToolDefinition {
  return {
    name: 'terminate_opportunity',
    version: '1',
    description:
      '终止当前绑定机会的整个求职流程。用户说终止、放弃、关闭某个机会时必须调用；不要使用普通状态流转工具代替。终止原因可选，产品会在真正写库前让用户编辑并确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reasonNote: {
          type: 'string',
          maxLength: 1_000,
          description: '用户明确说出的终止原因。用户未说明时省略，不要自行猜测。',
        },
      },
    },
    inputValidator: terminationInputSchema,
    requiresConfirmation: false,
    prepareInput: (input, providedValue) => {
      if (opportunity.status === 'closed') throw new Error('该机会已终止')
      const partial = terminationPartialInputSchema.parse(input)
      const providedReason = readProvidedReason(providedValue)
      const reasonNote = providedReason ?? partial.reasonNote ?? ''

      // 即使模型已提取原因，也先展示可编辑卡片；用户提交后才进入可执行状态。
      if (providedReason === null) {
        return {
          status: 'waiting_input',
          input: { reasonNote, expectedStatus: opportunity.status },
          missingArguments: [],
          presentation: createTerminationPresentation(opportunity, reasonNote),
        }
      }

      return {
        status: 'ready',
        input: terminationInputSchema.parse({
          reasonNote,
          expectedStatus: partial.expectedStatus ?? opportunity.status,
        }),
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const parsed = terminationInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('终止机会流程已取消')

      const result = await terminateOpportunityForUser({
        opportunityId: opportunity.id,
        userId,
        expectedStatus: parsed.expectedStatus,
        reasonNote: parsed.reasonNote,
      })
      return {
        status: 'terminated',
        opportunityId: result.opportunity.id,
        company: result.opportunity.company,
        jobTitle: result.opportunity.jobTitle,
        previousStatus: parsed.expectedStatus,
        opportunityStatus: result.opportunity.status,
        statusLabel: statusLabels[result.opportunity.status],
        reasonNote: parsed.reasonNote,
        alreadyApplied: result.alreadyApplied,
        updatedAt: result.opportunity.updatedAt,
      }
    },
  }
}

export function createGlobalTerminateOpportunityTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  terminateOpportunityForUser: TerminateOpportunityForUser,
): AgentToolDefinition {
  return {
    name: 'terminate_opportunity',
    version: '1',
    description:
      '终止某一个已保存机会的整个求职流程。使用 opportunityReference 传入用户提到的“公司 + 岗位”；目标不明确时仍然调用，产品会让用户选择。终止原因可选，真正写库前必须经用户编辑并确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”；不要编造数据库 ID。',
        },
        reasonNote: {
          type: 'string',
          maxLength: 1_000,
          description: '用户明确说出的终止原因；未说明时省略。',
        },
      },
    },
    inputValidator: globalTerminationInputSchema,
    requiresConfirmation: false,
    prepareInput: async (input, providedValue, context) => {
      const partial = globalTerminationPartialInputSchema.parse(input)
      const findTerminableOpportunitiesByUserId: FindOpportunitiesByUserId = async (targetUserId) => {
        const opportunities = await findOpportunitiesByUserId(targetUserId)
        return opportunities.filter((opportunity) => opportunity.status !== 'closed')
      }
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId: findTerminableOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要终止的机会',
        description: '请选择本次要终止流程的机会。确认前不会修改数据。',
      })
      if (resolution.status === 'waiting_input') return resolution
      if (resolution.opportunity.status === 'closed') throw new Error('该机会已终止')

      const localTool = createTerminateOpportunityTool(userId, resolution.opportunity, terminateOpportunityForUser)
      if (!localTool.prepareInput) throw new Error('机会终止工具缺少用户确认逻辑')
      const localPreparation = await localTool.prepareInput(
        {
          reasonNote: partial.reasonNote ?? '',
          ...(partial.expectedStatus ? { expectedStatus: partial.expectedStatus } : {}),
        },
        providedValue,
        context,
      )
      const preparedInput = {
        ...(partial.opportunityReference ? { opportunityReference: partial.opportunityReference } : {}),
        opportunityId: resolution.opportunity.id,
        ...localPreparation.input,
      }
      if (localPreparation.status === 'waiting_input') {
        return { ...localPreparation, input: preparedInput }
      }
      return { status: 'ready', input: globalTerminationInputSchema.parse(preparedInput) }
    },
    execute: async (input, context) => {
      const parsed = globalTerminationInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('终止机会流程已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const localTool = createTerminateOpportunityTool(userId, opportunity, terminateOpportunityForUser)
      return localTool.execute(
        terminationInputSchema.parse({ reasonNote: parsed.reasonNote, expectedStatus: parsed.expectedStatus }),
        context,
      )
    },
  }
}
