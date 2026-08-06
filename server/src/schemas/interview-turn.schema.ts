import { z } from 'zod'
import {
  interviewAnswerSchema,
  interviewAssistanceLevelSchema,
  interviewConfigurationSchema,
  interviewDifficultyRubricSchema,
  interviewLogicalKeySchema,
  interviewQuestionSchema,
  interviewTurnKindSchema,
  questionAssessmentPlanDraftSchema,
} from '@/shared/interview/schemas'

const requiredText = z.string().trim().min(1)

const interviewTurnBudgetProgressSchema = z
  .object({
    mainQuestionsAsked: z.number().int().nonnegative(),
    totalQuestionsAsked: z.number().int().nonnegative(),
    followUpsForCurrentRoot: z.number().int().nonnegative(),
    remainingMainQuestions: z.number().int().nonnegative(),
    remainingTotalQuestions: z.number().int().nonnegative(),
    remainingFollowUpsForCurrentRoot: z.number().int().nonnegative(),
    compoundQuestionsAsked: z.number().int().nonnegative(),
    remainingCompoundQuestions: z.number().int().nonnegative(),
  })
  .strict()

const interviewTurnCurrentQuestionSchema = z
  .object({
    kind: interviewTurnKindSchema,
    sequenceNumber: z.number().int().positive(),
    mainQuestionNumber: z.number().int().positive(),
    followUpNumber: z.number().int().nonnegative(),
    question: interviewQuestionSchema,
    hintUsage: interviewAssistanceLevelSchema,
  })
  .strict()

const interviewTurnHistoryItemSchema = z
  .object({
    sequenceNumber: z.number().int().positive(),
    kind: interviewTurnKindSchema,
    format: z.enum(['single', 'compound']),
    topicKey: interviewLogicalKeySchema,
    focusLabel: requiredText.max(80),
    question: requiredText.max(500),
    answerSummary: z.string().trim().max(500).nullable(),
    evidenceSummary: z.string().trim().max(500).nullable(),
  })
  .strict()

const interviewTurnReviewEvidenceItemSchema = z
  .object({
    referenceKey: z.string().regex(/^T[1-9][0-9]*$/),
    sequenceNumber: z.number().int().positive(),
    kind: interviewTurnKindSchema,
    format: z.enum(['single', 'compound']),
    topicKey: interviewLogicalKeySchema,
    focusLabel: requiredText.max(80),
    question: requiredText.max(500),
    answerSummary: z.string().trim().max(500).nullable(),
    evidenceSummary: z.string().trim().max(500).nullable(),
    pointResults: z
      .array(
        z
          .object({
            pointKey: interviewLogicalKeySchema,
            status: z.enum(['covered', 'partially_covered', 'missed', 'incorrect']),
            score: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(8),
    hintUsage: interviewAssistanceLevelSchema,
    skipReason: z.enum(['unknown', 'too_hard', 'unclear', 'irrelevant', 'declined', 'unspecified']).nullable(),
  })
  .strict()

export const interviewTurnRunInputSchema = z
  .object({
    configuration: interviewConfigurationSchema,
    budgetProgress: interviewTurnBudgetProgressSchema,
    assessmentPlan: z
      .object({
        difficultyRubric: interviewDifficultyRubricSchema,
        topics: z.array(questionAssessmentPlanDraftSchema).min(1).max(8),
      })
      .strict(),
    currentTurn: interviewTurnCurrentQuestionSchema,
    candidateAnswer: interviewAnswerSchema,
    recentHistory: z.array(interviewTurnHistoryItemSchema).max(8),
    reviewEvidence: z.array(interviewTurnReviewEvidenceItemSchema).max(60),
  })
  .strict()
  .superRefine((input, context) => {
    const topicKeys = input.assessmentPlan.topics.map((topic) => topic.key)
    if (new Set(topicKeys).size !== topicKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['assessmentPlan', 'topics'],
        message: 'assessmentPlan.topics.key 必须唯一',
      })
    }

    const referenceKeys = input.reviewEvidence.map((item) => item.referenceKey)
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['reviewEvidence'],
        message: 'reviewEvidence.referenceKey 必须唯一',
      })
    }

    input.assessmentPlan.topics.forEach((topic, topicIndex) => {
      const pointKeys = topic.evaluationPoints.map((point) => point.key)
      if (new Set(pointKeys).size !== pointKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['assessmentPlan', 'topics', topicIndex, 'evaluationPoints'],
          message: '同一主题内 evaluationPoints.key 必须唯一',
        })
      }

      const totalWeight = topic.evaluationPoints.reduce((total, point) => total + point.weight, 0)
      if (Math.abs(totalWeight - 100) > 0.01) {
        context.addIssue({
          code: 'custom',
          path: ['assessmentPlan', 'topics', topicIndex, 'evaluationPoints'],
          message: '同一主题内 evaluationPoints.weight 合计必须为 100',
        })
      }
    })

    const currentTopic = input.assessmentPlan.topics.find((topic) => topic.key === input.currentTurn.question.topicKey)
    if (!currentTopic) {
      context.addIssue({
        code: 'custom',
        path: ['currentTurn', 'question', 'topicKey'],
        message: 'currentTurn.question.topicKey 必须引用 assessmentPlan 中已存在的主题',
      })
      return
    }

    const currentTopicPointKeys = new Set(currentTopic.evaluationPoints.map((point) => point.key))
    input.currentTurn.question.targetEvaluationPointKeys.forEach((pointKey, pointIndex) => {
      if (!currentTopicPointKeys.has(pointKey)) {
        context.addIssue({
          code: 'custom',
          path: ['currentTurn', 'question', 'targetEvaluationPointKeys', pointIndex],
          message: '当前问题的目标评估点必须属于当前主题',
        })
      }
    })
  })

export type InterviewTurnRunInput = z.output<typeof interviewTurnRunInputSchema>
