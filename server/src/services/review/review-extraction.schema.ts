import { z } from 'zod'

const requiredText = z.string().trim().min(1)
const exactSourceQuote = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'sourceQuote 不能只包含空白字符')

export const reviewSegmentKindSchema = z.enum([
  'question',
  'candidate_answer',
  'interviewer_feedback',
  'candidate_reflection',
  'context',
])

export const reviewSourceTypeSchema = z.enum(['interview', 'written_test', 'unknown'])

export const extractionConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const candidateAnswerStatusSchema = z.enum(['complete', 'partial', 'explicitly_unknown', 'unclear'])

export const reviewExtractionSegmentSchema = z
  .object({
    kind: reviewSegmentKindSchema,
    sourceType: reviewSourceTypeSchema,

    // AI 对这段内容的结构化表达
    content: requiredText.max(6000),

    // 必须从原文中原样复制，不能改写
    sourceQuote: exactSourceQuote.max(6000),

    // 这是 AI 对“识别结果”的信心，不是候选人的能力评分
    confidence: extractionConfidenceSchema,

    // 只有 candidate_answer 才允许出现
    answerStatus: candidateAnswerStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind !== 'candidate_answer' && value.answerStatus !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['answerStatus'],
        message: '只有 candidate_answer 才能填写 answerStatus',
      })
    }
  })

export const reviewExtractionOutputSchema = z
  .object({
    segments: z.array(reviewExtractionSegmentSchema).max(20),
  })
  .strict()

export type ReviewExtractionSegment = z.output<typeof reviewExtractionSegmentSchema>

export type ReviewExtractionOutput = z.output<typeof reviewExtractionOutputSchema>
