import { z } from 'zod'
import {
  interviewAnswerContentMaxLength,
  interviewAssistanceLevelSchema,
  interviewConfigurationSchema,
  interviewFeedbackReasonsSchema,
} from '@/shared/interview/schemas'
import { modelConnectionSchema } from './model.schema'

const uuidSchema = z.string().uuid()
const requiredText = z.string().trim().min(1)

export const opportunityInterviewParamsSchema = z.object({
  opportunityId: uuidSchema,
})

export const interviewSessionParamsSchema = z.object({
  sessionId: uuidSchema,
})

export const interviewTurnParamsSchema = z.object({
  sessionId: uuidSchema,
  turnId: uuidSchema,
})

export const listInterviewSessionsQuerySchema = z.object({
  opportunityId: uuidSchema,
})

export const createInterviewSessionInputSchema = z
  .object({
    configuration: interviewConfigurationSchema,
    modelConnection: modelConnectionSchema,
  })
  .strict()

export const endInterviewSessionInputSchema = z
  .object({
    reason: z.literal('user_ended').default('user_ended'),
  })
  .strict()

export const submitInterviewAnswerInputSchema = z
  .object({
    content: requiredText.max(interviewAnswerContentMaxLength),
    clientSubmissionId: uuidSchema,
    submittedAt: z.string().datetime(),
    hintUsage: interviewAssistanceLevelSchema,
    modelConnection: modelConnectionSchema,
  })
  .strict()

export const retryInterviewAnswerInputSchema = z
  .object({
    modelConnection: modelConnectionSchema,
  })
  .strict()

export const cancelInterviewAnswerInputSchema = z
  .object({
    clientSubmissionId: uuidSchema.optional(),
  })
  .strict()

export const switchInterviewSessionModelInputSchema = z
  .object({
    modelConnection: modelConnectionSchema,
  })
  .strict()

export const skipInterviewTurnInputSchema = z
  .object({
    reason: z.enum(['unknown', 'too_hard', 'unclear', 'irrelevant', 'declined', 'unspecified']),
    note: z.string().trim().max(300).nullable().default(null),
    modelConnection: modelConnectionSchema,
  })
  .strict()

export const createInterviewInteractionInputSchema = z
  .object({
    clientMessageId: uuidSchema,
    content: requiredText.max(interviewAnswerContentMaxLength),
    submittedAt: z.string().datetime(),
  })
  .strict()

export const saveInterviewQuestionFeedbackInputSchema = z
  .object({
    rating: z.enum(['like', 'dislike']),
    reasons: interviewFeedbackReasonsSchema.default([]),
    comment: z.string().trim().max(500).nullable().default(null),
  })
  .strict()

export const generateInterviewDeepEvaluationInputSchema = z
  .object({
    modelConnection: modelConnectionSchema,
  })
  .strict()

export type CreateInterviewSessionInput = z.output<typeof createInterviewSessionInputSchema>
export type EndInterviewSessionInput = z.output<typeof endInterviewSessionInputSchema>
export type SubmitInterviewAnswerInput = z.output<typeof submitInterviewAnswerInputSchema>
export type RetryInterviewAnswerInput = z.output<typeof retryInterviewAnswerInputSchema>
export type CancelInterviewAnswerInput = z.output<typeof cancelInterviewAnswerInputSchema>
export type SwitchInterviewSessionModelInput = z.output<typeof switchInterviewSessionModelInputSchema>
export type SkipInterviewTurnInput = z.output<typeof skipInterviewTurnInputSchema>
export type CreateInterviewInteractionInput = z.output<typeof createInterviewInteractionInputSchema>
export type SaveInterviewQuestionFeedbackInput = z.output<typeof saveInterviewQuestionFeedbackInputSchema>
export type GenerateInterviewDeepEvaluationInput = z.output<typeof generateInterviewDeepEvaluationInputSchema>
