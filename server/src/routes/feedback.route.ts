import type { FastifyPluginAsync } from 'fastify'
import { createFeedback } from '../services/feedback.service'

export const feedbackRoute: FastifyPluginAsync = async (app) => {
  app.post('/feedback', async (request, reply) => {
    return reply.status(201).send(await createFeedback(request.body))
  })
}
