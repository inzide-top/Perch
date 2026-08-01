import { z } from 'zod'
import type { OpportunityRegion } from '@/shared/opportunity/geography'
import { modelConnectionSchema } from './model.schema'

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
const analysisRecommendationSchema = z.enum(['strong_match', 'worth_trying', 'risky', 'not_recommended'])
const opportunityRegionSchema = z.enum([
  'north_china',
  'east_china',
  'south_china',
  'central_china',
  'southwest_china',
  'northwest_china',
  'northeast_china',
  'other',
])

const interviewRoundTypeSchema = z.enum(['technical_basic', 'project', 'business', 'hr', 'manager', 'other'])
const interviewRoundStatusSchema = z.enum(['planned', 'completed', 'canceled'])
const interviewRoundResultSchema = z.enum(['pending', 'passed', 'failed', 'unknown'])

function validateInterviewRoundState(
  value: {
    status?: z.output<typeof interviewRoundStatusSchema>
    result?: z.output<typeof interviewRoundResultSchema>
    reviewNote?: string
    keyTakeaways?: string[]
  },
  context: z.RefinementCtx,
) {
  const inferredStatus = value.status ?? (value.reviewNote?.trim() ? 'completed' : 'planned')
  const inferredResult = value.result ?? (inferredStatus === 'planned' ? 'pending' : 'unknown')

  if (inferredStatus === 'planned' && inferredResult !== 'pending') {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: '待进行的面试结果必须为 pending',
    })
  }

  if (inferredStatus === 'completed' && inferredResult === 'pending') {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: '已完成的面试结果不能为 pending',
    })
  }

  if (inferredStatus === 'canceled' && inferredResult !== 'unknown') {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: '已取消的面试结果必须为 unknown',
    })
  }
}

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

function commaSeparatedValues<T extends z.ZodType<string, string>>(schema: T) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value
        ? [
            ...new Set(
              value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ]
        : [],
    )
    .pipe(z.array(schema))
}

/** 机会列表的筛选均由服务端执行，避免列表只筛选已加载到前端的一小段数据。 */
export const jobOpportunityListQuerySchema = z.object({
  statuses: commaSeparatedValues(opportunityStatusSchema),
  intentionLevels: commaSeparatedValues(opportunityIntentionLevelSchema),
  recommendations: commaSeparatedValues(analysisRecommendationSchema),
  regions: commaSeparatedValues(opportunityRegionSchema),
})

export type JobOpportunityListFilters = {
  statuses: z.output<typeof opportunityStatusSchema>[]
  intentionLevels: z.output<typeof opportunityIntentionLevelSchema>[]
  recommendations: z.output<typeof analysisRecommendationSchema>[]
  regions: OpportunityRegion[]
}

export const jobAnalysisProgressQuerySchema = z.object({
  opportunityIds: z
    .string()
    .trim()
    .min(1)
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
  includeResult: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const interviewRoundParamsSchema = z.object({
  opportunityId: z.string().uuid(),
  roundId: z.string().uuid(),
})

export const reviewDocumentParamsSchema = z.object({
  opportunityId: z.string().uuid(),
  documentId: z.string().uuid(),
})

export const retryReviewDocumentInputSchema = z
  .object({
    modelConnection: modelConnectionSchema,
  })
  .strict()

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
    /** 仅用于本次异步复盘提取，不会落库。 */
    modelConnection: modelConnectionSchema.optional(),
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
    /** 仅当 reviewNote 非空时用于启动真实复盘提取，不会落库。 */
    modelConnection: modelConnectionSchema.optional(),
  })
  .strict()
  .superRefine(validateInterviewRoundState)

export const updateInterviewRoundInputSchema = z
  .object({
    type: interviewRoundTypeSchema.optional(),
    title: optionalText,
    scheduledAt: optionalNullableText,
    result: interviewRoundResultSchema.optional(),
    note: optionalText,
    reviewNote: optionalText,
    keyTakeaways: z.array(z.string().trim().min(1)).optional(),
    /** 仅当已完成轮次的 reviewNote 非空时用于启动真实复盘提取，不会落库。 */
    modelConnection: modelConnectionSchema.optional(),
  })
  .strict()

export const completeInterviewRoundInputSchema = z
  .object({
    result: z.enum(['passed', 'failed', 'unknown']).optional(),
  })
  .strict()

export const cancelInterviewRoundInputSchema = z.object({}).strict()

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
export type CompleteInterviewRoundInput = z.input<typeof completeInterviewRoundInputSchema>
export type CancelInterviewRoundInput = z.input<typeof cancelInterviewRoundInputSchema>
export type TerminateOpportunityInput = z.input<typeof terminateOpportunityInputSchema>
