import type { FastifyPluginAsync } from 'fastify'
import { generateActionStrategy, getActionStrategyOverview } from '../services/action-strategy.service'

export const actionStrategyRoute: FastifyPluginAsync = async (app) => {
  app.get('/action-strategy', async (_request, reply) => {
    return reply.status(200).send(await getActionStrategyOverview())
  })

  app.post('/action-strategy/generate', async (request, reply) => {
    return reply.status(202).send(await generateActionStrategy(request.body))
  })
}
