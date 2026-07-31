import { z } from 'zod'

const requiredText = z.string().trim().min(1)
const optionalText = z.string().trim().min(1).optional()

const levelSchema = z.enum(['high', 'medium', 'low'])
const recommendationSchema = z.enum(['strong_match', 'worth_trying', 'risky', 'not_recommended'])
const requiredLevelSchema = z.enum(['expert', 'proficient', 'familiar', 'basic', 'preferred'])
const candidateLevelSchema = z.enum(['expert', 'proficient', 'familiar', 'basic', 'missing'])
const matchStatusSchema = z.enum(['matched', 'partial', 'missing', 'overqualified'])
const targetSectionSchema = z.enum(['summary', 'skills', 'project', 'experience'])
const matchDimensionKeySchema = z.enum([
  'core_requirements',
  'related_experience',
  'seniority_depth',
  'business_context',
  'bonus_points',
  'job_constraints',
])

const matchDimensionKeys = [
  'core_requirements',
  'related_experience',
  'seniority_depth',
  'business_context',
  'bonus_points',
  'job_constraints',
] as const

const analysisItemSchema = z.object({
  title: requiredText,
  evidenceFromJD: requiredText,
  evidenceFromResume: optionalText,
  level: levelSchema,
  reason: requiredText,
})

const scoreBreakdownItemSchema = z.object({
  key: matchDimensionKeySchema,
  label: requiredText,
  weight: z.number().positive().max(100),
  score: z.number().min(0).max(100),
  reason: requiredText,
  evidenceFromJD: optionalText,
  evidenceFromResume: optionalText,
})

export const jobAnalysisResultSchema = z
  .object({
    matchScore: z.number().min(0).max(100),
    recommendation: recommendationSchema,
    summary: requiredText,
    locationMatch: z.object({
      resumeCities: z.array(requiredText),
      jobAddress: optionalText,
      isMatched: z.boolean(),
      impact: z.literal('minor'),
      reason: requiredText,
    }),
    scoreBreakdown: z.array(scoreBreakdownItemSchema).length(matchDimensionKeys.length),
    requirementMatches: z.array(
      z.object({
        requirement: requiredText,
        requiredLevel: requiredLevelSchema,
        resumeEvidence: optionalText,
        candidateLevel: candidateLevelSchema,
        matchStatus: matchStatusSchema,
        importance: z.enum(['must_have', 'nice_to_have']),
        risk: levelSchema,
        suggestion: optionalText,
      }),
    ),
    strengths: z.array(analysisItemSchema),
    gaps: z.array(analysisItemSchema),
    resumeSuggestions: z.array(
      z.object({
        targetSection: targetSectionSchema,
        title: requiredText,
        reason: requiredText,
        priority: levelSchema,
        relatedJDText: optionalText,
      }),
    ),
    interviewFocus: z.array(
      z.object({
        topic: requiredText,
        reason: requiredText,
        difficulty: z.enum(['basic', 'medium', 'advanced']),
      }),
    ),
  })
  .superRefine((result, context) => {
    const keys = result.scoreBreakdown.map((item) => item.key)
    const uniqueKeys = new Set(keys)

    if (uniqueKeys.size !== matchDimensionKeys.length || matchDimensionKeys.some((key) => !uniqueKeys.has(key))) {
      context.addIssue({
        code: 'custom',
        path: ['scoreBreakdown'],
        message: 'scoreBreakdown 必须且只能包含六个固定匹配维度各一次',
      })
    }

    const totalWeight = result.scoreBreakdown.reduce((total, item) => total + item.weight, 0)
    if (Math.abs(totalWeight - 100) > Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['scoreBreakdown'],
        message: 'scoreBreakdown 的 weight 合计必须为 100',
      })
    }
  })

export type JobAnalysisResultOutput = z.output<typeof jobAnalysisResultSchema>

const modelConnectionSchema = z
  .object({
    baseUrl: z.string().trim().url(),
    modelName: requiredText,
    apiKey: requiredText,
  })
  .strict()

/** API Key 只用于本次请求，服务端不会把 modelConnection 写入任何表。 */
export const startJobAnalysisInputSchema = z
  .object({
    resumeId: z.string().uuid(),
    resumeVersionId: z.string().uuid(),
    modelConnection: modelConnectionSchema,
  })
  .strict()

export type StartJobAnalysisInput = z.output<typeof startJobAnalysisInputSchema>
