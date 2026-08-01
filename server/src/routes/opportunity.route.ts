import type { FastifyPluginAsync } from 'fastify'
import {
  interviewRoundParamsSchema,
  jobAnalysisProgressQuerySchema,
  jobOpportunityListQuerySchema,
  opportunityIdParamsSchema,
  retryReviewDocumentInputSchema,
  reviewDocumentParamsSchema,
} from '../schemas/opportunity.schema'
import {
  addInterviewRound,
  cancelInterviewRound,
  completeInterviewRound,
  createJobOpportunity,
  deleteJobOpportunity,
  deleteInterviewRound,
  getJobOpportunities,
  getJobOpportunityById,
  terminateJobOpportunity,
  updateInterviewRound,
  updateJobOpportunity,
  updateJobOpportunityStatus,
  updateWrittenTestReview,
} from '../services/opportunity.service'
import { getJobAnalyses, startJobAnalysis } from '../services/job-analysis.service'
import {
  getReviewDocumentSummaries,
  retryReviewDocumentForOpportunity,
} from '../services/review/review-document.service'

function parseOpportunityId(params: unknown) {
  return opportunityIdParamsSchema.parse(params).opportunityId
}

function parseInterviewRoundParams(params: unknown) {
  return interviewRoundParamsSchema.parse(params)
}

export const opportunityRoute: FastifyPluginAsync = async (app) => {
  app.post('/opportunities', async (request, reply) => {
    const result = await createJobOpportunity(request.body)

    return reply.status(201).send(result)
  })

  app.get<{ Querystring: { opportunityIds?: string; includeResult?: string } }>(
    '/opportunities/analyses',
    async (request, reply) => {
      const { opportunityIds, includeResult } = jobAnalysisProgressQuerySchema.parse(request.query)
      const result = await getJobAnalyses(opportunityIds, { includeResult })

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string } }>('/opportunities/:opportunityId/analysis', async (request, reply) => {
    const opportunityId = parseOpportunityId(request.params)
    const result = await startJobAnalysis(opportunityId, request.body)

    return reply.status(202).send(result)
  })

  app.get('/opportunities', async (request, reply) => {
    const filters = jobOpportunityListQuerySchema.parse(request.query)
    const result = await getJobOpportunities(filters)

    return reply.status(200).send(result)
  })

  app.get<{ Params: { opportunityId: string } }>('/opportunities/:opportunityId', async (request, reply) => {
    const opportunityId = parseOpportunityId(request.params)
    const result = await getJobOpportunityById(opportunityId)

    return reply.status(200).send(result)
  })

  app.get<{ Params: { opportunityId: string } }>(
    '/opportunities/:opportunityId/review-documents',
    async (request, reply) => {
      const opportunityId = parseOpportunityId(request.params)
      const result = await getReviewDocumentSummaries(opportunityId)

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string; documentId: string } }>(
    '/opportunities/:opportunityId/review-documents/:documentId/retry',
    async (request, reply) => {
      const { opportunityId, documentId } = reviewDocumentParamsSchema.parse(request.params)
      const { modelConnection } = retryReviewDocumentInputSchema.parse(request.body)
      const result = await retryReviewDocumentForOpportunity(opportunityId, documentId, modelConnection)

      return reply.status(202).send(result)
    },
  )

  app.delete<{ Params: { opportunityId: string } }>('/opportunities/:opportunityId', async (request, reply) => {
    const opportunityId = parseOpportunityId(request.params)
    const result = await deleteJobOpportunity(opportunityId)

    return reply.status(200).send(result)
  })

  app.patch<{ Params: { opportunityId: string } }>('/opportunities/:opportunityId', async (request, reply) => {
    const opportunityId = parseOpportunityId(request.params)
    const result = await updateJobOpportunity(opportunityId, request.body)

    return reply.status(200).send(result)
  })

  app.patch<{ Params: { opportunityId: string } }>('/opportunities/:opportunityId/status', async (request, reply) => {
    const opportunityId = parseOpportunityId(request.params)
    const result = await updateJobOpportunityStatus(opportunityId, request.body)

    return reply.status(200).send(result)
  })

  app.patch<{ Params: { opportunityId: string } }>(
    '/opportunities/:opportunityId/written-test-review',
    async (request, reply) => {
      const opportunityId = parseOpportunityId(request.params)
      const result = await updateWrittenTestReview(opportunityId, request.body)

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string } }>(
    '/opportunities/:opportunityId/interview-rounds',
    async (request, reply) => {
      const opportunityId = parseOpportunityId(request.params)
      const result = await addInterviewRound(opportunityId, request.body)

      return reply.status(201).send(result)
    },
  )

  app.patch<{ Params: { opportunityId: string; roundId: string } }>(
    '/opportunities/:opportunityId/interview-rounds/:roundId',
    async (request, reply) => {
      const { opportunityId, roundId } = parseInterviewRoundParams(request.params)
      const result = await updateInterviewRound(opportunityId, roundId, request.body)

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string; roundId: string } }>(
    '/opportunities/:opportunityId/interview-rounds/:roundId/complete',
    async (request, reply) => {
      const { opportunityId, roundId } = parseInterviewRoundParams(request.params)
      const result = await completeInterviewRound(opportunityId, roundId, request.body)

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string; roundId: string } }>(
    '/opportunities/:opportunityId/interview-rounds/:roundId/cancel',
    async (request, reply) => {
      const { opportunityId, roundId } = parseInterviewRoundParams(request.params)
      const result = await cancelInterviewRound(opportunityId, roundId, request.body)

      return reply.status(200).send(result)
    },
  )

  app.delete<{ Params: { opportunityId: string; roundId: string } }>(
    '/opportunities/:opportunityId/interview-rounds/:roundId',
    async (request, reply) => {
      const { opportunityId, roundId } = parseInterviewRoundParams(request.params)
      const result = await deleteInterviewRound(opportunityId, roundId)

      return reply.status(200).send(result)
    },
  )

  app.post<{ Params: { opportunityId: string } }>(
    '/opportunities/:opportunityId/termination',
    async (request, reply) => {
      const opportunityId = parseOpportunityId(request.params)
      const result = await terminateJobOpportunity(opportunityId, request.body)

      return reply.status(200).send(result)
    },
  )
}
