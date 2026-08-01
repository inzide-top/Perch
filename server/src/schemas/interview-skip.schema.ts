import { z } from 'zod'
import {
  interviewConfigurationSchema,
  interviewDifficultyRubricSchema,
  interviewLogicalKeySchema,
  interviewQuestionDraftSchema,
  interviewQuestionSchema,
  interviewSkipSchema,
  interviewTurnKindSchema,
  questionAssessmentPlanDraftSchema,
} from '@/shared/interview/schemas'

const requiredText = z.string().trim().min(1)

const skipBudgetProgressSchema = z
  .object({
    remainingMainQuestions: z.number().int().nonnegative(),
    remainingTotalQuestions: z.number().int().nonnegative(),
    remainingCompoundQuestions: z.number().int().nonnegative(),
  })
  .strict()

export const interviewSkipRunInputSchema = z
  .object({
    configuration: interviewConfigurationSchema,
    budgetProgress: skipBudgetProgressSchema,
    assessmentPlan: z
      .object({
        difficultyRubric: interviewDifficultyRubricSchema,
        topics: z.array(questionAssessmentPlanDraftSchema).min(1).max(8),
      })
      .strict(),
    currentTurn: z
      .object({
        kind: interviewTurnKindSchema,
        sequenceNumber: z.number().int().positive(),
        mainQuestionNumber: z.number().int().positive(),
        followUpNumber: z.number().int().nonnegative(),
        question: interviewQuestionSchema,
      })
      .strict(),
    skip: interviewSkipSchema,
    consumesBudget: z.boolean(),
    recentHistory: z
      .array(
        z
          .object({
            sequenceNumber: z.number().int().positive(),
            topicKey: interviewLogicalKeySchema,
            focusLabel: requiredText.max(80),
            question: requiredText.max(500),
            evidenceSummary: z.string().trim().max(500).nullable(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict()

export const interviewSkipModelOutputSchema = z
  .object({
    nextAction: z.discriminatedUnion('type', [
      z.object({ type: z.literal('ask_next_question'), reason: requiredText.max(300) }).strict(),
      z.object({ type: z.literal('finish_session'), reason: requiredText.max(300) }).strict(),
    ]),
    nextQuestion: interviewQuestionDraftSchema.optional(),
  })
  .strict()
  .superRefine((output, context) => {
    if (output.nextAction.type === 'ask_next_question' && !output.nextQuestion) {
      context.addIssue({
        code: 'custom',
        path: ['nextQuestion'],
        message: '继续面试时必须返回 nextQuestion',
      })
    }

    if (output.nextAction.type === 'finish_session' && output.nextQuestion) {
      context.addIssue({
        code: 'custom',
        path: ['nextQuestion'],
        message: '结束面试时不得返回 nextQuestion',
      })
    }
  })

export type InterviewSkipRunInput = z.output<typeof interviewSkipRunInputSchema>
export type InterviewSkipModelOutput = z.output<typeof interviewSkipModelOutputSchema>
