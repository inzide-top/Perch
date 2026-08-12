import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import { resolveOpportunityTarget } from '../opportunity-target-resolver'
import {
  opportunityIntentionLevelSchema,
  readProvidedOpportunityId,
  resolveGlobalOpportunityTarget,
  statusLabels,
  type BatchUpdateOpportunityProfilesForUser,
  type FindOpportunitiesByUserId,
  type UpdateOpportunityProfileForUser,
} from './read-tools'

const opportunityProfilePatchShape = {
  intentionLevel: opportunityIntentionLevelSchema.optional(),
  industry: z.string().trim().max(100).optional(),
  address: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
  note: z.string().trim().max(2_000).optional(),
  includeWrittenTest: z.boolean().optional(),
}
const hasOpportunityProfilePatch = (value: Record<string, unknown>) =>
  Object.keys(opportunityProfilePatchShape).some((field) => value[field] !== undefined)

const opportunityProfilePatchSchema = z
  .object(opportunityProfilePatchShape)
  .strict()
  .refine(hasOpportunityProfilePatch, '至少需要修改一个机会字段')

const globalOpportunityProfilePartialInputSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
    ...opportunityProfilePatchShape,
  })
  .strict()
  .refine(hasOpportunityProfilePatch, '至少需要修改一个机会字段')
const globalOpportunityProfileInputSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid(),
    ...opportunityProfilePatchShape,
  })
  .strict()
  .refine(hasOpportunityProfilePatch, '至少需要修改一个机会字段')

const batchOpportunityProfilePartialOperationSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
    ...opportunityProfilePatchShape,
  })
  .strict()
  .refine(hasOpportunityProfilePatch, '每个机会都至少需要修改一个字段')
const batchOpportunityProfileOperationSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid(),
    ...opportunityProfilePatchShape,
  })
  .strict()
  .refine(hasOpportunityProfilePatch, '每个机会都至少需要修改一个字段')
const batchOpportunityProfilePartialInputSchema = z
  .object({ operations: z.array(batchOpportunityProfilePartialOperationSchema).min(2).max(10) })
  .strict()
const batchOpportunityProfileInputSchema = z
  .object({ operations: z.array(batchOpportunityProfileOperationSchema).min(2).max(10) })
  .strict()
  .superRefine((value, context) => {
    const opportunityIds = value.operations.map((operation) => operation.opportunityId)
    if (new Set(opportunityIds).size !== opportunityIds.length) {
      context.addIssue({ code: 'custom', path: ['operations'], message: '同一个机会不能重复修改' })
    }
  })

const batchOpportunityProfileExecutionContextSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            opportunityId: z.string().uuid(),
            expectedUpdatedAt: z.string().min(1),
            patch: opportunityProfilePatchSchema,
          })
          .strict(),
      )
      .min(2)
      .max(10),
  })
  .strict()

const opportunityProfileExecutionContextSchema = z
  .object({
    opportunityId: z.string().uuid(),
    expectedUpdatedAt: z.string().min(1),
    patch: opportunityProfilePatchSchema,
  })
  .strict()

const profileFieldLabels = {
  intentionLevel: '意向等级',
  industry: '行业',
  address: '工作地点',
  note: '备注',
  includeWrittenTest: '笔试流程',
} as const

function formatProfileValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '未填写'
  if (typeof value === 'boolean') return value ? '已开启' : '未开启'
  if (typeof value === 'string') return value || '未填写'
  return '未填写'
}

export function createUpdateOpportunityProfileTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  updateOpportunityProfileForUser: UpdateOpportunityProfileForUser,
): AgentToolDefinition {
  return {
    name: 'update_opportunity_profile',
    version: '1',
    description:
      '更新当前绑定机会的基础资料。用户明确要求设置意向等级、行业、工作地点、备注，或开启/关闭笔试流程时调用；一次可提交多个字段。咨询或比较时不要调用。关闭笔试流程传 includeWrittenTest=false。机会阶段流转、JD 正文、面试安排和复盘不属于该工具。执行前由产品确认卡片确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intentionLevel: {
          type: 'string',
          enum: opportunityIntentionLevelSchema.options,
          description: '目标意向等级。',
        },
        industry: { type: 'string', maxLength: 100, description: '目标行业；空字符串表示清空。' },
        address: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 100 },
          maxItems: 5,
          description: '目标工作地点列表；空数组表示清空。',
        },
        note: { type: 'string', maxLength: 2_000, description: '目标备注；空字符串表示清空。' },
        includeWrittenTest: {
          type: 'boolean',
          description: '目标笔试流程状态：true 表示开启，false 表示关闭。当前处于笔试中时关闭会同时回退到已投递。',
        },
      },
    },
    inputValidator: opportunityProfilePatchSchema,
    requiresConfirmation: true,
    prepareConfirmation: (input) => {
      const patch = opportunityProfilePatchSchema.parse(input)
      const changes: Array<{
        field: keyof typeof profileFieldLabels | 'status'
        label: string
        before: string
        after: string
      }> = (Object.keys(profileFieldLabels) as Array<keyof typeof profileFieldLabels>).flatMap((field) => {
        if (patch[field] === undefined) return []
        return [
          {
            field,
            label: profileFieldLabels[field],
            before: formatProfileValue(opportunity[field]),
            after: formatProfileValue(patch[field]),
          },
        ]
      })
      if (patch.includeWrittenTest === false && opportunity.status === 'written_test') {
        changes.push({
          field: 'status',
          label: '机会阶段',
          before: statusLabels.written_test,
          after: statusLabels.applied,
        })
      }
      return {
        presentation: {
          kind: 'opportunity_profile_change',
          title: '修改机会资料',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          changes,
        },
        executionContext: {
          opportunityId: opportunity.id,
          expectedUpdatedAt: opportunity.updatedAt,
          patch,
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const parsedInput = opportunityProfilePatchSchema.parse(input)
      const trustedContext = opportunityProfileExecutionContextSchema.parse(context.confirmationContext)
      if (JSON.stringify(parsedInput) !== JSON.stringify(trustedContext.patch)) {
        throw new Error('确认时的机会资料与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('修改机会资料已取消')

      const result = await updateOpportunityProfileForUser({
        opportunityId: trustedContext.opportunityId,
        userId,
        expectedUpdatedAt: trustedContext.expectedUpdatedAt,
        patch: trustedContext.patch,
      })

      return {
        status: 'updated',
        opportunityId: result.opportunity.id,
        company: result.opportunity.company,
        jobTitle: result.opportunity.jobTitle,
        changedFields: Object.keys(trustedContext.patch),
        alreadyApplied: result.alreadyApplied,
        updatedAt: result.opportunity.updatedAt,
      }
    },
  }
}

export function createGlobalUpdateOpportunityProfileTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  updateOpportunityProfileForUser: UpdateOpportunityProfileForUser,
): AgentToolDefinition {
  return {
    name: 'update_opportunity_profile',
    version: '1',
    description:
      '更新某一个已保存机会的意向等级、行业、工作地点、备注或笔试流程开关。全局对话中用户明确要求修改具体机会时调用；用 opportunityReference 传用户提到的公司、岗位或“公司 + 岗位”。目标缺失或同名时仍然调用，产品会让用户选择。执行前由产品确认卡片确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”名称；没有明确目标时省略，不要编造数据库 ID。',
        },
        intentionLevel: {
          type: 'string',
          enum: opportunityIntentionLevelSchema.options,
          description: '目标意向等级。',
        },
        industry: { type: 'string', maxLength: 100, description: '目标行业；空字符串表示清空。' },
        address: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 100 },
          maxItems: 5,
          description: '目标工作地点列表；空数组表示清空。',
        },
        note: { type: 'string', maxLength: 2_000, description: '目标备注；空字符串表示清空。' },
        includeWrittenTest: {
          type: 'boolean',
          description: '目标笔试流程状态。当前处于笔试中时关闭会同时回退到已投递。',
        },
      },
    },
    inputValidator: globalOpportunityProfileInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      const partial = globalOpportunityProfilePartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
      })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要修改的机会',
        description: '请选择本次需要修改资料的机会。确认具体目标前不会写入任何数据。',
      })
      if (resolution.status === 'waiting_input') return resolution
      return { status: 'ready', input: { ...partial, opportunityId: resolution.opportunity.id } }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalOpportunityProfileInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('修改机会资料已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      const { opportunityReference: _reference, opportunityId: _opportunityId, ...patchInput } = parsed
      const localTool = createUpdateOpportunityProfileTool(userId, opportunity, updateOpportunityProfileForUser)
      if (!localTool.prepareConfirmation) throw new Error('机会资料修改工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(opportunityProfilePatchSchema.parse(patchInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalOpportunityProfileInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('修改机会资料已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      const { opportunityReference: _reference, opportunityId: _opportunityId, ...patchInput } = parsed
      return createUpdateOpportunityProfileTool(userId, opportunity, updateOpportunityProfileForUser).execute(
        opportunityProfilePatchSchema.parse(patchInput),
        context,
      )
    },
  }
}

export function createBatchUpdateOpportunityProfilesTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  updateOpportunityProfileForUser: UpdateOpportunityProfileForUser,
  batchUpdateOpportunityProfilesForUser: BatchUpdateOpportunityProfilesForUser,
): AgentToolDefinition {
  return {
    name: 'batch_update_opportunity_profiles',
    version: '1',
    description:
      '在一次用户确认后原子修改 2 到 10 个已保存机会的意向等级、行业、工作地点、备注或笔试流程开关。用户明确要求同时修改多个机会时使用。每项用 opportunityReference 指向公司、岗位或“公司 + 岗位”；目标缺失或同名时仍然调用，产品会逐项让用户选择。不要用于阶段流转。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operations'],
      properties: {
        operations: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          description: '需要在同一次确认中完成的机会资料修改，按用户表达顺序填写。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              opportunityReference: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                description: '该项对应的公司、岗位或“公司 + 岗位”；不要编造数据库 ID。',
              },
              intentionLevel: {
                type: 'string',
                enum: opportunityIntentionLevelSchema.options,
                description: '目标意向等级。',
              },
              industry: { type: 'string', maxLength: 100, description: '目标行业；空字符串表示清空。' },
              address: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 100 },
                maxItems: 5,
                description: '目标工作地点；空数组表示清空。',
              },
              note: { type: 'string', maxLength: 2_000, description: '目标备注；空字符串表示清空。' },
              includeWrittenTest: { type: 'boolean', description: '目标笔试流程状态。' },
            },
          },
        },
      },
    },
    inputValidator: batchOpportunityProfileInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const partial = batchOpportunityProfilePartialInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('批量修改机会资料已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      if (context.signal.aborted) throw new Error('批量修改机会资料已取消')
      if (opportunities.length === 0) throw new Error('当前还没有可操作的求职机会')

      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      let providedSelectionConsumed = false
      const resolvedOperations: z.output<typeof batchOpportunityProfilePartialOperationSchema>[] = []

      for (const [index, operation] of partial.operations.entries()) {
        const selectedOpportunityId =
          operation.opportunityId ??
          (!providedSelectionConsumed && providedOpportunityId ? providedOpportunityId : undefined)
        const resolution = resolveOpportunityTarget({
          opportunities,
          reference: operation.opportunityReference,
          selectedOpportunityId,
        })
        if (selectedOpportunityId === providedOpportunityId) providedSelectionConsumed = true

        if (resolution.status === 'resolved') {
          resolvedOperations.push({ ...operation, opportunityId: resolution.opportunity.id })
          continue
        }

        return {
          status: 'waiting_input',
          input: {
            operations: [...resolvedOperations, operation, ...partial.operations.slice(index + 1)],
          },
          missingArguments: [`operations.${index}.opportunityId`],
          presentation: {
            kind: 'opportunity_target_input',
            title: `选择第 ${index + 1} 个目标机会`,
            description: `批量修改共 ${partial.operations.length} 项，请先确定“${operation.opportunityReference ?? `第 ${index + 1} 项`}”对应的机会。`,
            reason: resolution.reason,
            reference: operation.opportunityReference ?? null,
            sections: [],
            candidates: resolution.candidates.map((opportunity) => ({
              opportunityId: opportunity.id,
              company: opportunity.company,
              jobTitle: opportunity.jobTitle,
              status: opportunity.status,
              statusLabel: statusLabels[opportunity.status],
              intentionLevel: opportunity.intentionLevel,
              updatedAt: opportunity.updatedAt,
            })),
          },
        }
      }

      const completed = batchOpportunityProfileInputSchema.parse({ operations: resolvedOperations })
      return { status: 'ready', input: completed }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = batchOpportunityProfileInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('批量修改机会资料已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunitiesById = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]))
      const items: ChatJsonObject[] = []
      const updates: Array<z.output<typeof batchOpportunityProfileExecutionContextSchema>['updates'][number]> = []

      for (const operation of parsed.operations) {
        const opportunity = opportunitiesById.get(operation.opportunityId)
        if (!opportunity) throw new Error('批量修改中的目标机会不存在或不属于当前用户')
        const { opportunityReference: _reference, opportunityId: _opportunityId, ...patchInput } = operation
        const patch = opportunityProfilePatchSchema.parse(patchInput)
        const localTool = createUpdateOpportunityProfileTool(userId, opportunity, updateOpportunityProfileForUser)
        if (!localTool.prepareConfirmation) throw new Error('机会资料修改工具缺少确认准备逻辑')
        const confirmation = await localTool.prepareConfirmation(patch, context)
        items.push(confirmation.presentation)
        updates.push({ opportunityId: opportunity.id, expectedUpdatedAt: opportunity.updatedAt, patch })
      }

      return {
        presentation: {
          kind: 'opportunity_profile_batch_change',
          title: '批量修改机会资料',
          items,
        },
        executionContext: { updates },
      }
    },
    execute: async (input, context) => {
      const parsed = batchOpportunityProfileInputSchema.parse(input)
      const trustedContext = batchOpportunityProfileExecutionContextSchema.parse(context.confirmationContext)
      const requestedUpdates = parsed.operations.map((operation) => {
        const { opportunityReference: _reference, opportunityId, ...patchInput } = operation
        return { opportunityId, patch: opportunityProfilePatchSchema.parse(patchInput) }
      })
      const confirmedUpdates = trustedContext.updates.map(({ opportunityId, patch }) => ({ opportunityId, patch }))
      if (JSON.stringify(requestedUpdates) !== JSON.stringify(confirmedUpdates)) {
        throw new Error('确认时的批量修改内容与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('批量修改机会资料已取消')

      const result = await batchUpdateOpportunityProfilesForUser({
        userId,
        updates: trustedContext.updates,
      })
      return {
        status: 'updated',
        updatedCount: result.opportunities.length,
        alreadyApplied: result.alreadyApplied,
        opportunities: result.opportunities.map((opportunity) => ({
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          updatedAt: opportunity.updatedAt,
        })),
      }
    },
  }
}

const legacyUpdateOpportunityIntentionInputSchema = z
  .object({ intentionLevel: opportunityIntentionLevelSchema })
  .strict()
const legacyOpportunityIntentionExecutionContextSchema = z
  .object({
    opportunityId: z.string().uuid(),
    expectedIntentionLevel: opportunityIntentionLevelSchema,
    nextIntentionLevel: opportunityIntentionLevelSchema,
  })
  .strict()

/** 仅用于让升级前已经等待确认的旧 ToolAction 能从 checkpoint 安全恢复。 */
export function createLegacyUpdateOpportunityIntentionTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  updateOpportunityProfileForUser: UpdateOpportunityProfileForUser,
): AgentToolDefinition {
  return {
    name: 'update_opportunity_intention_level',
    version: '1',
    exposeToModel: false,
    description: '兼容历史等待确认动作。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['intentionLevel'],
      properties: { intentionLevel: { type: 'string', enum: opportunityIntentionLevelSchema.options } },
    },
    inputValidator: legacyUpdateOpportunityIntentionInputSchema,
    requiresConfirmation: true,
    execute: async (input, context): Promise<ChatJsonObject> => {
      const parsedInput = legacyUpdateOpportunityIntentionInputSchema.parse(input)
      const trustedContext = legacyOpportunityIntentionExecutionContextSchema.parse(context.confirmationContext)
      if (parsedInput.intentionLevel !== trustedContext.nextIntentionLevel) {
        throw new Error('确认时的目标意向等级与工具参数不一致')
      }
      if (
        opportunity.intentionLevel !== trustedContext.expectedIntentionLevel &&
        opportunity.intentionLevel !== trustedContext.nextIntentionLevel
      ) {
        throw new Error('机会信息已发生变化，请重新发起修改')
      }

      const result = await updateOpportunityProfileForUser({
        opportunityId: trustedContext.opportunityId,
        userId,
        expectedUpdatedAt: opportunity.updatedAt,
        patch: { intentionLevel: trustedContext.nextIntentionLevel },
      })
      return {
        status: 'updated',
        opportunityId: result.opportunity.id,
        intentionLevel: result.opportunity.intentionLevel,
        alreadyApplied: result.alreadyApplied,
        updatedAt: result.opportunity.updatedAt,
      }
    },
  }
}
