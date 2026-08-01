import type { FastifyPluginAsync } from 'fastify'
import { capabilityProfileQuerySchema } from '../schemas/capability-profile.schema'
import { getCapabilityProfile } from '../services/capability-profile.service'

export const capabilityProfileRoute: FastifyPluginAsync = async (app) => {
  app.get('/capability-profile', async (request, reply) => {
    const { resumeId } = capabilityProfileQuerySchema.parse(request.query ?? {})
    const result = await getCapabilityProfile(resumeId)
    return reply.status(200).send(result)
  })
}
