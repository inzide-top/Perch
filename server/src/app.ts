import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { healthRoute } from './routes/health.route'
import { opportunityRoute } from './routes/opportunity.route'
import { agentRunRoute } from './routes/agent-run.route'
import { resumeRoute } from './routes/resume.route'
import { DuplicateJobOpportunityError, OpportunityNotFoundError } from './services/opportunity.service'
import { ResumeNotFoundError } from './services/resume.service'
import { JobAnalysisNotFoundError } from './services/job-analysis.service'

function isHttpClientError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error) || !('statusCode' in error)) return false

  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
}

export const app = Fastify({
  logger: true,
})

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: 'Request payload is invalid',
      issues: error.issues,
    })
  }

  if (
    error instanceof ResumeNotFoundError ||
    error instanceof OpportunityNotFoundError ||
    error instanceof JobAnalysisNotFoundError
  ) {
    return reply.status(404).send({
      message: error.message,
    })
  }

  if (error instanceof DuplicateJobOpportunityError) {
    return reply.status(error.statusCode).send({
      message: error.message,
      code: error.code,
      details: error.details,
    })
  }

  if (isHttpClientError(error)) {
    return reply.status(error.statusCode).send({
      message: error.message,
    })
  }

  request.log.error(error)

  return reply.status(500).send({
    message: 'Internal server error',
  })
})

await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

await app.register(healthRoute, { prefix: '/api' })
await app.register(opportunityRoute, { prefix: '/api' })
await app.register(resumeRoute, { prefix: '/api' })
await app.register(agentRunRoute, { prefix: '/api' })
