import type { FastifyPluginAsync } from 'fastify'
import {
  createResumeWithInitialVersion,
  getResumeById,
  getResumes,
  getResumeWorkspace,
  getResumeVersions,
  saveNewResumeVersion,
  deleteResume,
} from '../services/resume.service'
import { resumeIdParamsSchema } from '../schemas/resume.schema'

function parseResumeId(params: unknown) {
  return resumeIdParamsSchema.parse(params).resumeId
}

export const resumeRoute: FastifyPluginAsync = async (app) => {
  app.post('/resumes', async (request, reply) => {
    const result = await createResumeWithInitialVersion(request.body)

    return reply.status(201).send(result)
  })

  app.post<{ Params: { resumeId: string } }>('/resumes/:resumeId/versions', async (request, reply) => {
    const resumeId = parseResumeId(request.params)
    const result = await saveNewResumeVersion(resumeId, request.body)
    const status = result.type === 'created_new_version' ? 201 : 200

    return reply.status(status).send(result)
  })

  app.get('/resumes', async (_, reply) => {
    const result = await getResumes()
    return reply.status(200).send(result)
  })

  app.get('/resumes/workspace', async (_, reply) => {
    const result = await getResumeWorkspace()
    return reply.status(200).send(result)
  })

  app.get<{ Params: { resumeId: string } }>('/resumes/:resumeId', async (request, reply) => {
    const resumeId = parseResumeId(request.params)
    const result = await getResumeById(resumeId)
    return reply.status(200).send(result)
  })

  app.get<{ Params: { resumeId: string } }>('/resumes/:resumeId/versions', async (request, reply) => {
    const resumeId = parseResumeId(request.params)
    const result = await getResumeVersions(resumeId)
    return reply.status(200).send(result)
  })

  app.delete('/resumes/:resumeId', async (request, reply) => {
    const resumeId = parseResumeId(request.params)
    const result = await deleteResume(resumeId)
    return reply.status(200).send(result)
  })
}
