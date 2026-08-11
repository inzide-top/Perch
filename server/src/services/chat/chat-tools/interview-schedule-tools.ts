import crypto from 'node:crypto'
import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import {
  resolveGlobalOpportunityTarget,
  type CreateInterviewScheduleForUser,
  type FindOpportunitiesByUserId,
} from './read-tools'

const interviewRoundTypeSchema = z.enum(['technical_basic', 'project', 'business', 'hr', 'manager', 'other'])
const interviewRoundTypeLabels: Record<z.output<typeof interviewRoundTypeSchema>, string> = {
  technical_basic: '基础面',
  project: '项目面',
  business: '业务面',
  hr: 'HR 面',
  manager: '主管面',
  other: '其他',
}
const interviewSchedulePartialInputSchema = z
  .object({
    type: interviewRoundTypeSchema.optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    title: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
const interviewScheduleInputSchema = interviewSchedulePartialInputSchema.required({
  type: true,
  scheduledAt: true,
})
const globalInterviewSchedulePartialInputSchema = interviewSchedulePartialInputSchema
  .extend({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .strict()
const globalInterviewScheduleInputSchema = globalInterviewSchedulePartialInputSchema.required({
  opportunityId: true,
  type: true,
  scheduledAt: true,
})
const interviewScheduleExecutionContextSchema = z
  .object({
    roundId: z.string().uuid(),
    opportunityId: z.string().uuid(),
    type: interviewRoundTypeSchema,
    title: z.string().trim().min(1).max(100),
    scheduledAt: z.string().datetime({ offset: true }),
    note: z.string().trim().max(500),
  })
  .strict()

function extractInterviewScheduleProvidedValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as ChatJsonObject
  const scheduleValue = {
    ...('type' in record ? { type: record.type } : {}),
    ...('scheduledAt' in record ? { scheduledAt: record.scheduledAt } : {}),
    ...('title' in record ? { title: record.title } : {}),
    ...('note' in record ? { note: record.note } : {}),
  }
  if (Object.keys(scheduleValue).length === 0) return undefined

  return interviewSchedulePartialInputSchema.parse(scheduleValue)
}

export function createInterviewScheduleTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  createInterviewScheduleForUser: CreateInterviewScheduleForUser,
): AgentToolDefinition {
  return {
    name: 'create_interview_schedule',
    version: '1',
    description:
      '为当前绑定机会创建未来的真实面试安排。用户明确要求安排、记录或新增一次未来面试时调用；面试类型或准确时间缺失也要调用，产品会用表单补齐。添加已结束面试的复盘不使用该工具。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: interviewRoundTypeSchema.options,
          description:
            '面试类型：基础面 technical_basic、项目面 project、业务面 business、HR 面 hr、主管面 manager、其他 other。用户没有明确说明时不要猜测，省略此字段。',
        },
        scheduledAt: {
          type: 'string',
          format: 'date-time',
          description: '带时区的 ISO 8601 面试时间。无法从用户原话确定准确日期和时间时省略此字段。',
        },
        title: { type: 'string', maxLength: 100, description: '可选标题，只依据用户原话填写。' },
        note: { type: 'string', maxLength: 500, description: '可选备注，只依据用户原话填写。' },
      },
    },
    inputValidator: interviewScheduleInputSchema,
    requiresConfirmation: true,
    prepareInput: (input, providedValue) => {
      const provided = extractInterviewScheduleProvidedValue(providedValue) ?? {}
      const partial = interviewSchedulePartialInputSchema.parse({ ...input, ...provided })
      const missingArguments = [
        ...(!partial.type ? ['type' as const] : []),
        ...(!partial.scheduledAt ? ['scheduledAt' as const] : []),
      ]

      // 即使模型已经填全参数，也先让用户核对一次相对日期和面试类型；
      // 只有用户提交过表单后，后端才生成不可变的确认快照。
      if (missingArguments.length > 0 || !extractInterviewScheduleProvidedValue(providedValue)) {
        return {
          status: 'waiting_input',
          input: partial,
          missingArguments,
          presentation: {
            kind: 'interview_schedule_input',
            title: missingArguments.length > 0 ? '补全面试安排' : '核对面试安排',
            opportunityId: opportunity.id,
            company: opportunity.company,
            jobTitle: opportunity.jobTitle,
            missingArguments,
            values: partial,
          },
        }
      }

      const completed = interviewScheduleInputSchema.parse(partial)
      if (new Date(completed.scheduledAt).getTime() <= Date.now()) {
        throw new Error('面试安排时间必须晚于当前时间')
      }
      return { status: 'ready', input: completed }
    },
    prepareConfirmation: (input) => {
      const schedule = interviewScheduleInputSchema.parse(input)
      if (new Date(schedule.scheduledAt).getTime() <= Date.now()) {
        throw new Error('面试安排时间必须晚于当前时间')
      }
      const roundTypeLabel = interviewRoundTypeLabels[schedule.type]
      const roundTitle = schedule.title || roundTypeLabel
      const note = schedule.note || ''
      return {
        presentation: {
          kind: 'interview_schedule_create',
          title: '创建面试安排',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          roundType: schedule.type,
          roundTypeLabel,
          roundTitle,
          scheduledAt: schedule.scheduledAt,
          note,
        },
        executionContext: {
          roundId: crypto.randomUUID(),
          opportunityId: opportunity.id,
          type: schedule.type,
          title: roundTitle,
          scheduledAt: schedule.scheduledAt,
          note,
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const schedule = interviewScheduleInputSchema.parse(input)
      const trustedContext = interviewScheduleExecutionContextSchema.parse(context.confirmationContext)
      if (
        schedule.type !== trustedContext.type ||
        schedule.scheduledAt !== trustedContext.scheduledAt ||
        (schedule.title || interviewRoundTypeLabels[schedule.type]) !== trustedContext.title ||
        (schedule.note || '') !== trustedContext.note
      ) {
        throw new Error('确认时的面试安排与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('创建面试安排已取消')

      const result = await createInterviewScheduleForUser({
        ...trustedContext,
        userId,
      })
      return {
        status: 'created',
        opportunityId: opportunity.id,
        roundId: result.round.id,
        type: result.round.type,
        title: result.round.title,
        scheduledAt: result.round.scheduledAt,
        alreadyApplied: result.alreadyApplied,
      }
    },
  }
}

export function createGlobalInterviewScheduleTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  createInterviewScheduleForUser: CreateInterviewScheduleForUser,
): AgentToolDefinition {
  return {
    name: 'create_interview_schedule',
    version: '1',
    description:
      '为某一个已保存且处于面试中阶段的机会创建未来真实面试安排。使用 opportunityReference 指向公司、岗位或“公司 + 岗位”；目标缺失或同名时仍然调用，产品会先让用户选择。面试类型或准确时间缺失时也要调用，产品会继续展示补充表单。',
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
          enum: interviewRoundTypeSchema.options,
          description:
            '面试类型：基础面 technical_basic、项目面 project、业务面 business、HR 面 hr、主管面 manager、其他 other。用户没有明确说明时省略。',
        },
        scheduledAt: {
          type: 'string',
          format: 'date-time',
          description: '带时区的 ISO 8601 面试时间。无法从用户原话确定准确日期和时间时省略。',
        },
        title: { type: 'string', maxLength: 100, description: '可选标题，只依据用户原话填写。' },
        note: { type: 'string', maxLength: 500, description: '可选备注，只依据用户原话填写。' },
      },
    },
    inputValidator: globalInterviewScheduleInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const provided =
        providedValue && typeof providedValue === 'object' && !Array.isArray(providedValue)
          ? (providedValue as ChatJsonObject)
          : {}
      const partial = globalInterviewSchedulePartialInputSchema.parse({ ...input, ...provided })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要创建面试安排的机会',
        description: '请选择本次面试安排所属的机会。确定目标前不会创建任何记录。',
      })
      if (resolution.status === 'waiting_input') return resolution
      if (resolution.opportunity.status !== 'interviewing') {
        throw new Error('只有处于面试中阶段的机会才能创建面试安排')
      }

      const { opportunityReference, opportunityId: _opportunityId, ...scheduleInput } = partial
      const localTool = createInterviewScheduleTool(userId, resolution.opportunity, createInterviewScheduleForUser)
      if (!localTool.prepareInput) throw new Error('创建面试安排工具缺少参数补全逻辑')
      const schedulePreparation = await localTool.prepareInput(
        scheduleInput,
        extractInterviewScheduleProvidedValue(providedValue),
        context,
      )
      const preparedInput = {
        ...(opportunityReference ? { opportunityReference } : {}),
        opportunityId: resolution.opportunity.id,
        ...schedulePreparation.input,
      }
      if (schedulePreparation.status === 'waiting_input') {
        return { ...schedulePreparation, input: preparedInput }
      }
      return { status: 'ready', input: globalInterviewScheduleInputSchema.parse(preparedInput) }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalInterviewScheduleInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('创建面试安排已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      if (opportunity.status !== 'interviewing') throw new Error('只有处于面试中阶段的机会才能创建面试安排')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...scheduleInput } = parsed
      const localTool = createInterviewScheduleTool(userId, opportunity, createInterviewScheduleForUser)
      if (!localTool.prepareConfirmation) throw new Error('创建面试安排工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(interviewScheduleInputSchema.parse(scheduleInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalInterviewScheduleInputSchema.parse(input)
      const trustedContext = interviewScheduleExecutionContextSchema.parse(context.confirmationContext)
      if (parsed.opportunityId !== trustedContext.opportunityId) {
        throw new Error('确认时的目标机会与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('创建面试安排已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...scheduleInput } = parsed
      return createInterviewScheduleTool(userId, opportunity, createInterviewScheduleForUser).execute(
        interviewScheduleInputSchema.parse(scheduleInput),
        context,
      )
    },
  }
}
