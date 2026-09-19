import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { healthRoute } from './routes/health.route'
import { opportunityRoute } from './routes/opportunity.route'
import { agentRunRoute } from './routes/agent-run.route'
import { resumeRoute } from './routes/resume.route'
import { interviewRoute } from './routes/interview.route'
import { backgroundTaskRoute } from './routes/background-task.route'
import { dashboardRoute } from './routes/dashboard.route'
import { capabilityProfileRoute } from './routes/capability-profile.route'
import { actionStrategyRoute } from './routes/action-strategy.route'
import { chatRoute } from './routes/chat.route'
import { chatRunDebugRoute } from './routes/chat-run-debug.route'
import { feedbackRoute } from './routes/feedback.route'
import { modelSettingsRoute } from './routes/model-settings.route'
import {
  DuplicateJobOpportunityError,
  OpportunityInterviewHistoryConflictError,
  OpportunityNotFoundError,
} from './services/opportunity.service'
import { ResumeInterviewHistoryConflictError, ResumeNotFoundError } from './services/resume.service'
import { JobAnalysisNotFoundError } from './services/job-analysis.service'
import { InterviewConflictError, InterviewNotFoundError } from './services/interview.service'
import { BackgroundTaskCapacityError } from './services/background-task.service'
import {
  createRequestMetrics,
  enterRequestMetrics,
  getPayloadByteLength,
  type RequestMetrics,
} from './utils/request-metrics'
import { runWithCurrentUser } from './context/current-user'
import { authenticateRequest, UnauthorizedRequestError } from './services/request-auth.service'
import { developerToolsEnabled } from './config/developer-tools'

function isHttpClientError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error) || !('statusCode' in error)) return false

  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
}

export const app = Fastify({
  logger: true,
})

const requestMetricsByRequest = new WeakMap<object, RequestMetrics>()
const apiMetricsEnabled = process.env.API_METRICS_ENABLED === 'true'

app.addHook('onRequest', (request, _reply, done) => {
  if (!apiMetricsEnabled) return done()

  const metrics = createRequestMetrics()
  requestMetricsByRequest.set(request, metrics)
  enterRequestMetrics(metrics)
  done()
})

app.addHook('onSend', async (request, _reply, payload) => {
  const metrics = requestMetricsByRequest.get(request)
  if (metrics) metrics.responseBytes = getPayloadByteLength(payload)
  return payload
})

app.addHook('onResponse', async (request, reply) => {
  const metrics = requestMetricsByRequest.get(request)
  if (!metrics) return

  request.log.info(
    {
      event: 'api_metrics',
      route: request.routeOptions.url,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Math.round(performance.now() - metrics.startedAt),
      responseBytes: metrics.responseBytes,
      dbQueryCount: metrics.dbQueryCount,
      dbDurationMs: Math.round(metrics.dbDurationMs),
    },
    'API request metrics',
  )
})

app.setErrorHandler((error, request, reply) => {
  if (error instanceof UnauthorizedRequestError) {
    return reply.status(error.statusCode).send({ message: error.message })
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: 'Request payload is invalid',
      issues: error.issues,
    })
  }

  if (
    error instanceof ResumeNotFoundError ||
    error instanceof OpportunityNotFoundError ||
    error instanceof JobAnalysisNotFoundError ||
    error instanceof InterviewNotFoundError
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

  if (error instanceof OpportunityInterviewHistoryConflictError) {
    return reply.status(error.statusCode).send({
      message: error.message,
      code: error.code,
      details: error.details,
    })
  }

  if (error instanceof ResumeInterviewHistoryConflictError) {
    return reply.status(error.statusCode).send({
      message: error.message,
      code: error.code,
      details: error.details,
    })
  }

  if (error instanceof InterviewConflictError) {
    return reply.status(error.statusCode).send({ message: error.message })
  }

  if (error instanceof BackgroundTaskCapacityError) {
    return reply.status(error.statusCode).send({
      message: error.message,
      code: error.code,
      taskType: error.taskType,
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

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

await app.register(cors, {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

app.addHook('onRequest', (request, _reply, done) => {
  if (request.method === 'OPTIONS' || request.url === '/api/health') return done()

  void authenticateRequest(request.headers.authorization)
    .then((identity) => {
      runWithCurrentUser(identity, () => {
        request.log.debug({ userId: identity.userId, authMode: identity.authMode }, 'Authenticated API request')
        done()
      })
    })
    .catch(done)
})

await app.register(multipart, {
  limits: {
    files: 1,
    fields: 1,
    parts: 2,
    fileSize: 8 * 1024 * 1024,
  },
})

await app.register(healthRoute, { prefix: '/api' })
await app.register(opportunityRoute, { prefix: '/api' })
await app.register(resumeRoute, { prefix: '/api' })
if (developerToolsEnabled) {
  await app.register(agentRunRoute, { prefix: '/api' })
  await app.register(chatRunDebugRoute, { prefix: '/api' })
}
await app.register(interviewRoute, { prefix: '/api' })
await app.register(backgroundTaskRoute, { prefix: '/api' })
await app.register(dashboardRoute, { prefix: '/api' })
await app.register(capabilityProfileRoute, { prefix: '/api' })
await app.register(actionStrategyRoute, { prefix: '/api' })
await app.register(chatRoute, { prefix: '/api' })
await app.register(feedbackRoute, { prefix: '/api' })
await app.register(modelSettingsRoute, { prefix: '/api' })
