import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import {
  opportunityStatusSchema,
  readProvidedOpportunityId,
  resolveGlobalOpportunityTarget,
  statusLabels,
  type FindOpportunitiesByUserId,
  type TransitionOpportunityStatusForUser,
} from './read-tools'

const mutableOpportunityStatusSchema = opportunityStatusSchema.exclude(['closed'])
const transitionOpportunityStatusInputSchema = z
  .object({
    status: mutableOpportunityStatusSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict()
const globalTransitionOpportunityStatusPartialInputSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
    status: mutableOpportunityStatusSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict()
const globalTransitionOpportunityStatusInputSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid(),
    status: mutableOpportunityStatusSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict()
const transitionOpportunityStatusExecutionContextSchema = z
  .object({
    opportunityId: z.string().uuid(),
    expectedStatus: mutableOpportunityStatusSchema,
    nextStatus: mutableOpportunityStatusSchema,
    enableWrittenTest: z.boolean(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
const canonicalStatusFlow = ['pending_apply', 'applied', 'written_test', 'interviewing', 'oc', 'offered'] as const

export function createTransitionOpportunityStatusTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  transitionOpportunityStatusForUser: TransitionOpportunityStatusForUser,
): AgentToolDefinition {
  return {
    name: 'transition_opportunity_status',
    version: '1',
    description:
      '把当前绑定机会切换到用户明确指定的求职阶段。允许跳过中间阶段或回退纠错；终止机会不使用该工具。需要进入笔试中但当前未开启笔试流程时，确认卡会同时提示并开启笔试流程。执行前必须由用户确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: mutableOpportunityStatusSchema.options,
          description:
            '目标阶段：待投递 pending_apply、已投递 applied、笔试中 written_test、面试中 interviewing、OC oc、已 Offer offered。',
        },
        note: { type: 'string', maxLength: 300, description: '可选的状态修改原因，仅依据用户原话填写。' },
      },
    },
    inputValidator: transitionOpportunityStatusInputSchema,
    requiresConfirmation: true,
    prepareConfirmation: (input) => {
      const parsed = transitionOpportunityStatusInputSchema.parse(input)
      const fromIndex = canonicalStatusFlow.indexOf(opportunity.status as (typeof canonicalStatusFlow)[number])
      const toIndex = canonicalStatusFlow.indexOf(parsed.status)
      const direction = toIndex < fromIndex ? 'backward' : toIndex > fromIndex ? 'forward' : 'same'
      const enableWrittenTest = parsed.status === 'written_test' && !opportunity.includeWrittenTest
      return {
        presentation: {
          kind: 'opportunity_status_transition',
          title: direction === 'backward' ? '回退机会阶段' : '修改机会阶段',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          before: opportunity.status,
          beforeLabel: statusLabels[opportunity.status],
          after: parsed.status,
          afterLabel: statusLabels[parsed.status],
          direction,
          enableWrittenTest,
          warning:
            direction === 'backward'
              ? '已有面试安排、复盘和状态历史不会被删除。'
              : enableWrittenTest
                ? '确认后会同时开启该机会的笔试流程。'
                : null,
        },
        executionContext: {
          opportunityId: opportunity.id,
          expectedStatus: opportunity.status,
          nextStatus: parsed.status,
          enableWrittenTest,
          ...(parsed.note ? { note: parsed.note } : {}),
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const parsedInput = transitionOpportunityStatusInputSchema.parse(input)
      const trustedContext = transitionOpportunityStatusExecutionContextSchema.parse(context.confirmationContext)
      if (parsedInput.status !== trustedContext.nextStatus || parsedInput.note !== trustedContext.note) {
        throw new Error('确认时的目标阶段与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('修改机会阶段已取消')

      const result = await transitionOpportunityStatusForUser({
        opportunityId: trustedContext.opportunityId,
        userId,
        expectedStatus: trustedContext.expectedStatus,
        nextStatus: trustedContext.nextStatus,
        enableWrittenTest: trustedContext.enableWrittenTest,
        note: trustedContext.note,
      })
      return {
        status: 'updated',
        opportunityId: result.opportunity.id,
        company: result.opportunity.company,
        jobTitle: result.opportunity.jobTitle,
        previousStatus: trustedContext.expectedStatus,
        opportunityStatus: result.opportunity.status,
        statusLabel: statusLabels[result.opportunity.status],
        enabledWrittenTest: trustedContext.enableWrittenTest,
        alreadyApplied: result.alreadyApplied,
        updatedAt: result.opportunity.updatedAt,
      }
    },
  }
}

export function createGlobalTransitionOpportunityStatusTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  transitionOpportunityStatusForUser: TransitionOpportunityStatusForUser,
): AgentToolDefinition {
  return {
    name: 'transition_opportunity_status',
    version: '1',
    description:
      '把某一个已保存机会切换到用户明确指定的求职阶段。全局对话中用 opportunityReference 传用户提到的公司、岗位或“公司 + 岗位”；目标缺失或同名时仍然调用，产品会让用户选择。允许跨级或回退，终止机会不使用本工具，执行前必须确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”名称；没有明确目标时省略，不要编造数据库 ID。',
        },
        status: {
          type: 'string',
          enum: mutableOpportunityStatusSchema.options,
          description:
            '目标阶段：待投递 pending_apply、已投递 applied、笔试中 written_test、面试中 interviewing、OC oc、已 Offer offered。',
        },
        note: { type: 'string', maxLength: 300, description: '可选的状态修改原因，仅依据用户原话填写。' },
      },
    },
    inputValidator: globalTransitionOpportunityStatusInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      const partial = globalTransitionOpportunityStatusPartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
      })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要调整阶段的机会',
        description: '请选择本次需要调整求职阶段的机会。确认具体目标前不会写入任何数据。',
      })
      if (resolution.status === 'waiting_input') return resolution
      return { status: 'ready', input: { ...partial, opportunityId: resolution.opportunity.id } }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalTransitionOpportunityStatusInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('修改机会阶段已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      if (opportunity.status === 'closed') throw new Error('已终止机会不能通过普通阶段流转恢复')
      const { opportunityReference: _reference, opportunityId: _opportunityId, ...transitionInput } = parsed
      const localTool = createTransitionOpportunityStatusTool(userId, opportunity, transitionOpportunityStatusForUser)
      if (!localTool.prepareConfirmation) throw new Error('机会阶段修改工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(transitionOpportunityStatusInputSchema.parse(transitionInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalTransitionOpportunityStatusInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('修改机会阶段已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      if (opportunity.status === 'closed') throw new Error('已终止机会不能通过普通阶段流转恢复')
      const { opportunityReference: _reference, opportunityId: _opportunityId, ...transitionInput } = parsed
      return createTransitionOpportunityStatusTool(userId, opportunity, transitionOpportunityStatusForUser).execute(
        transitionOpportunityStatusInputSchema.parse(transitionInput),
        context,
      )
    },
  }
}
