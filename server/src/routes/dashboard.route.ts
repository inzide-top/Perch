import type { FastifyPluginAsync } from 'fastify'
import { getDashboardOverview } from '../services/dashboard.service'

export const dashboardRoute: FastifyPluginAsync = async (app) => {
  app.get('/dashboard/overview', async (_request, reply) => {
    const result = await getDashboardOverview()
    return reply.status(200).send(result)
  })
}
