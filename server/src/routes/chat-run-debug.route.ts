import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { chatConversationScopeTypeSchema, chatRunStatusSchema } from '@/shared/chat/schemas'
import { getChatRunDebugDetail, getChatRunDebugList } from '../services/chat-run-debug.service'

const cursorPayloadSchema = z.object({ createdAt: z.string().min(1), id: z.string().uuid() }).strict()
const cursorSchema = z
  .string()
  .max(500)
  .transform((value, context) => {
    try {
      return cursorPayloadSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    } catch {
      context.addIssue({ code: 'custom', message: 'Chat Run 游标无效' })
      return z.NEVER
    }
  })
const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(30),
    cursor: cursorSchema.optional(),
    status: chatRunStatusSchema.optional(),
    scopeType: chatConversationScopeTypeSchema.optional(),
    modelName: z.string().trim().min(1).max(200).optional(),
    search: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict()
const paramsSchema = z.object({ runId: z.string().uuid() }).strict()

/** 仅开发环境使用；列表按当前用户隔离，完整事件和模型调用详情按需读取。 */
export const chatRunDebugRoute: FastifyPluginAsync = async (app) => {
  app.get('/developer/chat-runs', async (request, reply) => {
    const query = listQuerySchema.parse(request.query)
    return reply.status(200).send(await getChatRunDebugList(query))
  })

  app.get('/developer/chat-runs/:runId', async (request, reply) => {
    const { runId } = paramsSchema.parse(request.params)
    return reply.status(200).send(await getChatRunDebugDetail(runId))
  })
}
