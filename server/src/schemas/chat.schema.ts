import { z } from 'zod'
import {
  chatConversationScopeTypeSchema,
  chatMessageReferenceInputSchema,
  chatRunBudgetSchema,
} from '@/shared/chat/schemas'
import { modelConnectionSchema } from './model.schema'

const uuidSchema = z.string().uuid()
const requiredText = z.string().trim().min(1)

export const chatConversationParamsSchema = z.object({ conversationId: uuidSchema })
export const chatRunParamsSchema = z.object({ runId: uuidSchema })
export const chatMessageParamsSchema = z.object({ messageId: uuidSchema })

export const completeOpportunityImportItemsInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemIndex: z.number().int().nonnegative(),
            opportunityId: uuidSchema,
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict()
  .refine((input) => new Set(input.items.map((item) => item.itemIndex)).size === input.items.length, {
    message: '同一个导入结果不能重复提交',
  })

const chatConversationCursorPayloadSchema = z
  .object({
    updatedAt: z.string().min(1),
    id: uuidSchema,
  })
  .strict()

const chatConversationCursorSchema = z
  .string()
  .max(500)
  .transform((value, context) => {
    try {
      const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
      return chatConversationCursorPayloadSchema.parse(decoded)
    } catch {
      context.addIssue({ code: 'custom', message: '聊天会话游标无效' })
      return z.NEVER
    }
  })

export const listChatConversationsQuerySchema = z
  .object({
    cursor: chatConversationCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    search: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((value) => value || undefined),
    scopeType: z.enum(['global', 'opportunity']).optional(),
    opportunityId: uuidSchema.optional(),
    archived: z.enum(['active', 'archived', 'all']).default('active'),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.scopeType === 'global' && input.opportunityId) {
      context.addIssue({ code: 'custom', path: ['opportunityId'], message: '全局会话筛选不能携带岗位机会' })
    }
  })

export const createChatConversationInputSchema = z
  .object({
    title: requiredText.max(120),
    scopeType: chatConversationScopeTypeSchema,
    opportunityId: uuidSchema.nullable().default(null),
  })

  .strict()
  .superRefine((input, context) => {
    if (input.scopeType === 'global' && input.opportunityId !== null) {
      context.addIssue({ code: 'custom', path: ['opportunityId'], message: '全局会话不能绑定岗位机会' })
    }
    if (input.scopeType === 'opportunity' && input.opportunityId === null) {
      context.addIssue({ code: 'custom', path: ['opportunityId'], message: '岗位会话必须绑定岗位机会' })
    }
  })

export const updateChatConversationInputSchema = z
  .object({
    title: requiredText.max(120).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.archived !== undefined, {
    message: '至少提供一个需要修改的会话字段',
  })

export const sendChatMessageInputSchema = z
  .object({
    commandId: uuidSchema,
    text: requiredText.max(8_000),
    references: z
      .array(chatMessageReferenceInputSchema)
      .max(5)
      .default([])
      .refine(
        (references) =>
          new Set(references.map((reference) => `${reference.type}:${reference.id}`)).size === references.length,
        {
          message: '同一个机会不能重复引用',
        },
      ),
    modelConnection: modelConnectionSchema,
    promptVersion: requiredText.max(100).default('chat.v1'),
    budget: chatRunBudgetSchema.default({ maxModelCalls: 4, maxToolCalls: 8 }).transform((budget) => ({
      maxModelCalls: budget.maxModelCalls,
      maxToolCalls: budget.maxToolCalls,
      ...(budget.maxInputTokens !== undefined ? { maxInputTokens: budget.maxInputTokens } : {}),
      ...(budget.maxOutputTokens !== undefined ? { maxOutputTokens: budget.maxOutputTokens } : {}),
    })),
  })
  .strict()

export const chatRunEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(200),
})

const chatCommandRevisionSchema = z.number().int().nonnegative()

export const createChatCommandInputSchema = z.discriminatedUnion('type', [
  z
    .object({
      commandId: uuidSchema,
      type: z.literal('provide_input'),
      expectedRevision: chatCommandRevisionSchema,
      payload: z
        .object({
          requestId: uuidSchema,
          value: z.unknown(),
        })
        .strict(),
      // 补充信息后可能立即进入确认，也可能继续执行模型，因此同样需要原模型连接。
      modelConnection: modelConnectionSchema,
    })
    .strict(),
  z
    .object({
      commandId: uuidSchema,
      type: z.literal('confirm_tool'),
      expectedRevision: chatCommandRevisionSchema,
      payload: z
        .object({
          toolActionId: uuidSchema,
          decision: z.enum(['approved', 'rejected']),
        })
        .strict(),
      // API Key 只用于本次内存续跑，不放进 Command payload，也不会写入数据库。
      modelConnection: modelConnectionSchema,
    })
    .strict(),
  z
    .object({
      commandId: uuidSchema,
      type: z.literal('cancel_run'),
      expectedRevision: chatCommandRevisionSchema,
      payload: z
        .object({
          reason: z.string().trim().max(200).optional(),
          visibleTextLength: z.number().int().nonnegative().max(1_000_000).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      commandId: uuidSchema,
      type: z.literal('retry_run'),
      expectedRevision: chatCommandRevisionSchema,
      payload: z.object({}).strict(),
    })
    .strict(),
])

export type CreateChatConversationInput = z.output<typeof createChatConversationInputSchema>
export type ListChatConversationsQuery = z.output<typeof listChatConversationsQuerySchema>
export type UpdateChatConversationInput = z.output<typeof updateChatConversationInputSchema>
export type SendChatMessageInput = z.output<typeof sendChatMessageInputSchema>
export type ChatRunEventsQuery = z.output<typeof chatRunEventsQuerySchema>
export type CreateChatCommandInput = z.output<typeof createChatCommandInputSchema>
