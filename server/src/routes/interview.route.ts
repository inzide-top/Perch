import type { FastifyPluginAsync } from 'fastify'
import {
  interviewSessionParamsSchema,
  interviewTurnParamsSchema,
  listInterviewSessionsQuerySchema,
  opportunityInterviewParamsSchema,
} from '../schemas/interview.schema'
import {
  cancelInterviewAnswer,
  createInterviewSession,
  deleteInterviewQuestionFeedback,
  endInterviewSession,
  getActiveInterviewModelUsage,
  getAnswerDeepEvaluation,
  getInterviewSession,
  getInterviewSessionStatus,
  getInterviewSessions,
  generateAnswerDeepEvaluation,
  retryInterviewAnswer,
  retryInterviewSkip,
  saveInterviewQuestionFeedback,
  skipInterviewTurn,
  submitInterviewAnswer,
  switchInterviewSessionModel,
} from '../services/interview.service'

export const interviewRoute: FastifyPluginAsync = async (app) => {
  app.post('/opportunities/:opportunityId/interview-sessions', async (request, reply) => {
    const { opportunityId } = opportunityInterviewParamsSchema.parse(request.params)
    const result = await createInterviewSession(opportunityId, request.body)
    return reply.status(201).send(result)
  })

  app.get('/interview-sessions', async (request, reply) => {
    const { opportunityId } = listInterviewSessionsQuerySchema.parse(request.query)
    const result = await getInterviewSessions(opportunityId)
    return reply.status(200).send(result)
  })

  app.get('/interview-sessions/active-model-usage', async (_request, reply) => {
    const result = await getActiveInterviewModelUsage()
    return reply.status(200).send(result)
  })

  app.get('/interview-sessions/:sessionId/status', async (request, reply) => {
    const { sessionId } = interviewSessionParamsSchema.parse(request.params)
    const result = await getInterviewSessionStatus(sessionId)
    return reply.status(200).send(result)
  })

  app.get('/interview-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = interviewSessionParamsSchema.parse(request.params)
    const result = await getInterviewSession(sessionId)
    return reply.status(200).send(result)
  })

  app.patch('/interview-sessions/:sessionId/model', async (request, reply) => {
    const { sessionId } = interviewSessionParamsSchema.parse(request.params)
    const result = await switchInterviewSessionModel(sessionId, request.body)
    return reply.status(200).send(result)
  })

  app.post('/interview-sessions/:sessionId/end', async (request, reply) => {
    const { sessionId } = interviewSessionParamsSchema.parse(request.params)
    const result = await endInterviewSession(sessionId, request.body)
    return reply.status(200).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/answers', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await submitInterviewAnswer(sessionId, turnId, request.body)
    return reply.status(202).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/retry-answer', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await retryInterviewAnswer(sessionId, turnId, request.body)
    return reply.status(202).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/skip', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await skipInterviewTurn(sessionId, turnId, request.body)
    return reply.status(202).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/retry-skip', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await retryInterviewSkip(sessionId, turnId, request.body)
    return reply.status(202).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/cancel-answer', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await cancelInterviewAnswer(sessionId, turnId, request.body)
    return reply.status(200).send(result)
  })

  app.put('/interview-sessions/:sessionId/turns/:turnId/feedback', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await saveInterviewQuestionFeedback(sessionId, turnId, request.body)
    return reply.status(200).send(result)
  })

  app.delete('/interview-sessions/:sessionId/turns/:turnId/feedback', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await deleteInterviewQuestionFeedback(sessionId, turnId)
    return reply.status(200).send(result)
  })

  app.post('/interview-sessions/:sessionId/turns/:turnId/deep-evaluation', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await generateAnswerDeepEvaluation(sessionId, turnId, request.body)
    return reply.status(202).send(result)
  })

  app.get('/interview-sessions/:sessionId/turns/:turnId/deep-evaluation', async (request, reply) => {
    const { sessionId, turnId } = interviewTurnParamsSchema.parse(request.params)
    const result = await getAnswerDeepEvaluation(sessionId, turnId)
    return reply.status(200).send(result)
  })
}
