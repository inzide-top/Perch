import { z } from 'zod'
import { interviewConfigurationSchema, interviewLogicalKeySchema } from '@/shared/interview/schemas'
import { jobAnalysisResultBaseSchema } from './job-analysis.schema'

const requiredText = z.string().trim().min(1)
const optionalText = requiredText.optional()

const interviewPlanOpportunityInputSchema = z
  .object({
    company: requiredText,
    jobTitle: requiredText,
    address: z.array(requiredText),
    introduction: z.string().trim(),
    description: requiredText,
  })
  .strict()

const workExperienceSummarySchema = z
  .object({
    companyName: requiredText,
    industry: optionalText,
    department: optionalText,
    jobTitle: requiredText,
    period: z
      .object({
        start: z.string().trim(),
        end: z.string().trim(),
      })
      .strict(),
  })
  .strict()

const foundationProjectInputSchema = z
  .object({
    name: requiredText,
    role: z.string().trim(),
    techStack: z.string().trim(),
    description: requiredText,
  })
  .strict()

const projectInterviewProjectInputSchema = foundationProjectInputSchema.extend({
  content: requiredText,
  outcomes: optionalText,
})

export const foundationInterviewResumeInputSchema = z
  .object({
    targetDirection: requiredText,
    skills: requiredText,
    workExperiences: z.array(workExperienceSummarySchema),
    projects: z.array(foundationProjectInputSchema),
  })
  .strict()

export const projectInterviewResumeInputSchema = z
  .object({
    targetDirection: requiredText,
    skills: requiredText,
    workExperiences: z.array(workExperienceSummarySchema),
    projects: z.array(projectInterviewProjectInputSchema),
  })
  .strict()

/**
 * 面试计划只消费能辅助选题的分析结论。
 * 匹配分、投递建议、城市匹配和简历优化建议不进入本次模型上下文。
 */
export const interviewPlanAnalysisInputSchema = jobAnalysisResultBaseSchema
  .pick({
    summary: true,
    scoreBreakdown: true,
    requirementMatches: true,
    strengths: true,
    gaps: true,
    interviewFocus: true,
  })
  .strict()

export const historicalInterviewWeaknessSchema = z
  .object({
    topicKey: interviewLogicalKeySchema,
    topicLabel: requiredText.max(80),
    summary: requiredText.max(300),
    masteryScore: z.number().min(0).max(100),
    confidence: z.enum(['high', 'medium', 'low']),
    lastObservedAt: z.string().datetime(),
  })
  .strict()

export const historicalInterviewReviewSchema = z
  .object({
    source: z.enum(['written_test', 'interview_round']),
    title: requiredText.max(120),
    outcome: z.enum(['pending', 'passed', 'failed', 'unknown']),
    summary: requiredText.max(500),
    keyTakeaways: z.array(requiredText.max(160)).max(3),
    observedAt: z.string().datetime().nullable(),
  })
  .strict()

const interviewPlanRunInputBaseShape = {
  opportunity: interviewPlanOpportunityInputSchema,
  analysis: interviewPlanAnalysisInputSchema,
  historicalWeaknesses: z.array(historicalInterviewWeaknessSchema).max(5),
  historicalReviews: z.array(historicalInterviewReviewSchema).max(8),
}

export const foundationInterviewPlanRunInputSchema = z
  .object({
    ...interviewPlanRunInputBaseShape,
    configuration: interviewConfigurationSchema.extend({
      type: z.literal('foundation'),
    }),
    resume: foundationInterviewResumeInputSchema,
  })
  .strict()

export const projectInterviewPlanRunInputSchema = z
  .object({
    ...interviewPlanRunInputBaseShape,
    configuration: interviewConfigurationSchema.extend({
      type: z.literal('project'),
    }),
    resume: projectInterviewResumeInputSchema,
  })
  .strict()

/** configuration.type 同时决定允许进入模型的简历信息粒度。 */
export const interviewPlanRunInputSchema = z.union([
  foundationInterviewPlanRunInputSchema,
  projectInterviewPlanRunInputSchema,
])

export type HistoricalInterviewWeakness = z.output<typeof historicalInterviewWeaknessSchema>
export type HistoricalInterviewReview = z.output<typeof historicalInterviewReviewSchema>
export type InterviewPlanRunInput = z.output<typeof interviewPlanRunInputSchema>
