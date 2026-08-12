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
import { resumeIdParamsSchema, resumePdfImportTaskParamsSchema } from '../schemas/resume.schema'
import { modelConnectionSchema } from '../schemas/model.schema'
import { ResumePdfImportError } from '../services/resume-pdf-import.service'
import {
  createResumePdfImportTask,
  getResumePdfImportTask,
  retryResumePdfImportTask,
} from '../services/resume-pdf-import-task.service'

function parseResumeId(params: unknown) {
  return resumeIdParamsSchema.parse(params).resumeId
}

export const resumeRoute: FastifyPluginAsync = async (app) => {
  app.post('/resumes/import-pdf', async (request, reply) => {
    let fileName = ''
    let mimeType = ''
    let fileBuffer: Buffer | null = null
    let modelConnectionValue: unknown = null

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer) throw new ResumePdfImportError('一次只能导入一份 PDF')
        fileName = part.filename
        mimeType = part.mimetype
        fileBuffer = await part.toBuffer()
        if (part.file.truncated) throw new ResumePdfImportError('PDF 不能超过 8MB', 413)
        continue
      }

      if (part.fieldname === 'modelConnection') {
        try {
          modelConnectionValue = JSON.parse(String(part.value))
        } catch {
          throw new ResumePdfImportError('模型配置格式不正确')
        }
      }
    }

    if (!fileBuffer) throw new ResumePdfImportError('请选择要导入的 PDF')
    if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
      throw new ResumePdfImportError('仅支持 PDF 文件')
    }

    const modelConnection = modelConnectionSchema.parse(modelConnectionValue)
    const result = await createResumePdfImportTask({ fileName, buffer: fileBuffer, modelConnection })
    return reply.status(202).send(result)
  })

  app.get('/resumes/import-pdf/:taskId', async (request, reply) => {
    const { taskId } = resumePdfImportTaskParamsSchema.parse(request.params)
    const result = await getResumePdfImportTask(taskId)
    return reply.status(200).send(result)
  })

  app.post('/resumes/import-pdf/:taskId/retry', async (request, reply) => {
    const { taskId } = resumePdfImportTaskParamsSchema.parse(request.params)
    const input = request.body as { modelConnection?: unknown }
    const modelConnection = modelConnectionSchema.parse(input?.modelConnection)
    const result = await retryResumePdfImportTask(taskId, modelConnection)
    return reply.status(202).send(result)
  })

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
