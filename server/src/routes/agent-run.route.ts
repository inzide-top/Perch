import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getAgentRunDebugDetail, getAgentRunDebugList } from '../services/agent-run.service'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})
const runParamsSchema = z.object({ runId: z.string().uuid() })

/** 仅开发环境使用的观测入口，不返回模型配置中的 API Key。 */
export const agentRunRoute: FastifyPluginAsync = async (app) => {
  app.get('/developer/agent-runs', async (request, reply) => {
    const { limit } = listQuerySchema.parse(request.query)
    const result = await getAgentRunDebugList(limit)

    return reply.status(200).send(result)
  })

  app.get<{ Params: { runId: string } }>('/developer/agent-runs/:runId', async (request, reply) => {
    const { runId } = runParamsSchema.parse(request.params)
    const result = await getAgentRunDebugDetail(runId)

    return reply.status(200).send(result)
  })
}
