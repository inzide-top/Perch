import type { FastifyPluginAsync } from 'fastify'
import { getBackgroundTaskStatuses } from '../services/background-task-status.service'

export const backgroundTaskRoute: FastifyPluginAsync = async (app) => {
  app.post('/background-tasks/status', async (request, reply) => {
    const result = await getBackgroundTaskStatuses(request.body)
    return reply.status(200).send({ tasks: result })
  })
}
