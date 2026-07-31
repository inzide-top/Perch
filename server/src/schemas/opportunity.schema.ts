import { z } from 'zod'

const requiredText = z.string().trim().min(1)
const optionalText = z.string().trim().optional()
const optionalNullableText = z.string().trim().nullable().optional()

const opportunityStatusSchema = z.enum([
  'pending_apply',
  'applied',
  'written_test',
  'interviewing',
  'oc',
  'offered',
  'closed',
])
const mutableOpportunityStatusSchema = z.enum([
  'pending_apply',
  'applied',
  'written_test',
  'interviewing',
  'oc',
  'offered',
])

const opportunityIntentionLevelSchema = z.enum(['S', 'A', 'B', 'C'])

const interviewRoundTypeSchema = z.enum(['technical_basic', 'project', 'business', 'hr', 'manager', 'other'])
const interviewRoundStatusSchema = z.enum(['planned', 'completed', 'passed', 'failed', 'canceled'])
const interviewRoundResultSchema = z.enum(['pending', 'passed', 'failed', 'unknown'])

const opportunityTerminationReasonCodeSchema = z.enum([
  'candidate_give_up',
  'resume_rejected',
  'written_test_failed',
  'interview_failed',
  'salary_unmatched',
  'offer_rejected',
  'hiring_freeze',
  'other',
])

export const createJobOpportunityInputSchema = z.object({
  company: requiredText,
  jobTitle: requiredText,
  address: z.array(z.string().trim().min(1)).max(5).default([]),
  introduction: optionalText.default(''),
  description: requiredText,
})

export const opportunityIdParamsSchema = z.object({
  opportunityId: z.string().uuid(),
})

export const interviewRoundParamsSchema = z.object({
  opportunityId: z.string().uuid(),
  roundId: z.string().uuid(),
})

export const updateJobOpportunityInputSchema = z
  .object({
    company: optionalText,
    jobTitle: optionalText,
    address: z.array(z.string().trim().min(1)).max(5).optional(),
    introduction: optionalText,
    description: optionalText,
    includeWrittenTest: z.boolean().optional(),
    intentionLevel: opportunityIntentionLevelSchema.optional(),
    industry: optionalText,
    note: optionalText,
  })
  .strict()

export const updateJobOpportunityStatusInputSchema = z
  .object({
    status: opportunityStatusSchema,
    expectedStatus: mutableOpportunityStatusSchema,
    note: optionalText,
  })
  .strict()

export const updateWrittenTestReviewInputSchema = z
  .object({
    scheduledAt: optionalNullableText,
    reviewNote: optionalText,
  })
  .strict()

export const addInterviewRoundInputSchema = z
  .object({
    type: interviewRoundTypeSchema,
    title: optionalText,
    scheduledAt: optionalNullableText,
    status: interviewRoundStatusSchema.optional(),
    result: interviewRoundResultSchema.optional(),
    note: optionalText,
    reviewNote: optionalText,
    keyTakeaways: z.array(z.string().trim().min(1)).optional(),
  })
  .strict()

export const updateInterviewRoundInputSchema = addInterviewRoundInputSchema.partial().strict()

export const terminateOpportunityInputSchema = z
  .object({
    relatedInterviewRoundId: z.string().uuid().optional(),
    reasonCode: opportunityTerminationReasonCodeSchema.optional(),
    reasonNote: optionalText,
  })
  .strict()

export type CreateJobOpportunityInput = z.input<typeof createJobOpportunityInputSchema>
export type UpdateJobOpportunityInput = z.input<typeof updateJobOpportunityInputSchema>
export type UpdateJobOpportunityStatusInput = z.input<typeof updateJobOpportunityStatusInputSchema>
export type UpdateWrittenTestReviewInput = z.input<typeof updateWrittenTestReviewInputSchema>
export type AddInterviewRoundInput = z.input<typeof addInterviewRoundInputSchema>
export type UpdateInterviewRoundInput = z.input<typeof updateInterviewRoundInputSchema>
export type TerminateOpportunityInput = z.input<typeof terminateOpportunityInputSchema>
