import { z } from 'zod'
import {
  answerDeepEvaluationContextRelationSchema,
  answerEvidenceDraftSchema,
  interviewAnswerContentMaxLength,
  interviewAssistanceLevelSchema,
  interviewLogicalKeySchema,
  interviewPlanSourceSchema,
  interviewTurnKindSchema,
} from '@/shared/interview/schemas'

const requiredText = z.string().trim().min(1)
const deepEvaluationQuestionPartKeySchema = z.string().regex(/^part_[1-3]$/)

const deepEvaluationPointTargetSchema = z
  .object({
    key: interviewLogicalKeySchema,
    label: requiredText.max(80),
    description: requiredText.max(300),
    relativeWeight: z.number().positive().max(100),
  })
  .strict()

const deepEvaluationQuestionSchema = z
  .object({
    format: z.enum(['single', 'compound']),
    content: requiredText.max(500),
    parts: z
      .array(
        z
          .object({
            key: deepEvaluationQuestionPartKeySchema,
            content: requiredText.max(300),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((question, context) => {
    const partKeys = question.parts.map((part) => part.key)
    if (new Set(partKeys).size !== partKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'question.parts.key 不能重复',
      })
    }

    const expectedKeys = question.parts.map((_, index) => `part_${index + 1}`)
    if (partKeys.some((partKey, index) => partKey !== expectedKeys[index])) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'question.parts 必须按 part_1、part_2、part_3 连续排列',
      })
    }

    if (question.format === 'single') {
      if (question.parts.length !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['parts'],
          message: 'single 问题必须且只能生成一个 part_1',
        })
      } else if (question.parts[0].content !== question.content) {
        context.addIssue({
          code: 'custom',
          path: ['parts', 0, 'content'],
          message: 'single 问题的 part_1 必须与 question.content 一致',
        })
      }
    }

    if (question.format === 'compound' && question.parts.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'compound 问题必须拆成 2～3 个问题部分',
      })
    }
  })

const deepEvaluationAssistanceSchema = z
  .object({
    level: interviewAssistanceLevelSchema,
    revealedHints: z.array(requiredText.max(500)).max(2),
  })
  .strict()
  .superRefine((assistance, context) => {
    const expectedHintCount = assistance.level === 'none' ? 0 : assistance.level === 'level_1' ? 1 : 2
    if (assistance.revealedHints.length !== expectedHintCount) {
      context.addIssue({
        code: 'custom',
        path: ['revealedHints'],
        message: `${assistance.level} 必须对应 ${expectedHintCount} 条已展示提示`,
      })
    }
  })

const deepEvaluationPreviousContextSchema = z
  .object({
    rootQuestion: requiredText.max(500),
    priorTurns: z
      .array(
        z
          .object({
            question: requiredText.max(500),
            answerSummary: requiredText.max(500),
            evidenceSummary: requiredText.max(500),
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict()

export const answerDeepEvaluationRunInputSchema = z
  .object({
    roleContext: z
      .object({
        jobTitle: requiredText.max(120),
        interviewType: z.enum(['foundation', 'project']),
        expectedDifficulty: z.enum(['basic', 'standard', 'advanced']),
        difficultyStandard: requiredText.max(300),
      })
      .strict(),
    assessmentTarget: z
      .object({
        topicKey: interviewLogicalKeySchema,
        topicLabel: requiredText.max(80),
        objective: requiredText.max(300),
        sources: z.array(interviewPlanSourceSchema).min(1).max(6),
        evaluationPoints: z.array(deepEvaluationPointTargetSchema).min(1).max(8),
      })
      .strict(),
    targetTurn: z
      .object({
        kind: interviewTurnKindSchema,
        focusLabel: requiredText.max(80),
        question: deepEvaluationQuestionSchema,
        answer: z
          .object({
            content: requiredText.max(interviewAnswerContentMaxLength),
          })
          .strict(),
        assistance: deepEvaluationAssistanceSchema,
        preliminaryEvidence: answerEvidenceDraftSchema,
      })
      .strict(),
    previousContext: deepEvaluationPreviousContextSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    const evaluationPoints = input.assessmentTarget.evaluationPoints
    const evaluationPointKeys = evaluationPoints.map((point) => point.key)
    if (new Set(evaluationPointKeys).size !== evaluationPointKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['assessmentTarget', 'evaluationPoints'],
        message: 'assessmentTarget.evaluationPoints.key 不能重复',
      })
    }

    const totalWeight = evaluationPoints.reduce((total, point) => total + point.relativeWeight, 0)
    if (Math.abs(totalWeight - 100) > 0.01) {
      context.addIssue({
        code: 'custom',
        path: ['assessmentTarget', 'evaluationPoints'],
        message: '目标评估点的 relativeWeight 合计必须为 100',
      })
    }

    const preliminaryPointKeys = input.targetTurn.preliminaryEvidence.pointResults.map((point) => point.pointKey)
    if (new Set(preliminaryPointKeys).size !== preliminaryPointKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['targetTurn', 'preliminaryEvidence', 'pointResults'],
        message: 'preliminaryEvidence.pointResults.pointKey 不能重复',
      })
    }

    if (
      preliminaryPointKeys.length !== evaluationPointKeys.length ||
      evaluationPointKeys.some((pointKey) => !preliminaryPointKeys.includes(pointKey))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetTurn', 'preliminaryEvidence', 'pointResults'],
        message: 'preliminaryEvidence 必须且只能覆盖当前问题的全部目标评估点',
      })
    }

    if (input.targetTurn.preliminaryEvidence.hintUsage !== input.targetTurn.assistance.level) {
      context.addIssue({
        code: 'custom',
        path: ['targetTurn', 'preliminaryEvidence', 'hintUsage'],
        message: 'preliminaryEvidence.hintUsage 必须与 assistance.level 一致',
      })
    }

    if (input.targetTurn.kind === 'main' && input.previousContext !== null) {
      context.addIssue({
        code: 'custom',
        path: ['previousContext'],
        message: '主问题深度点评不能携带上一主题上下文',
      })
    }
  })

const answerDeepEvaluationPointModelOutputSchema = z
  .object({
    pointKey: interviewLogicalKeySchema,
    status: z.enum(['fully_met', 'partially_met', 'missed', 'incorrect', 'not_assessable']),
    score: z.number().int().min(0).max(100),
    analysis: requiredText.max(500),
    evidenceExcerpt: z.string().trim().min(1).max(500).nullable(),
    missingOrIncorrectPoints: z.array(requiredText.max(200)).max(4),
    improvement: requiredText.max(300),
  })
  .strict()

const answerDeepEvaluationRelatedPointItemSchema = z
  .object({
    title: requiredText.max(100),
    analysis: requiredText.max(400),
    relatedPointKeys: z.array(interviewLogicalKeySchema).max(8),
  })
  .strict()

const answerDeepEvaluationModelOutputBaseSchema = z
  .object({
    summary: requiredText.max(600),
    contextRelation: answerDeepEvaluationContextRelationSchema,
    questionPartEvaluations: z
      .array(
        z
          .object({
            partKey: deepEvaluationQuestionPartKeySchema,
            status: z.enum(['answered', 'partial', 'missing', 'misunderstood']),
            analysis: requiredText.max(400),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    pointEvaluations: z.array(answerDeepEvaluationPointModelOutputSchema).min(1).max(8),
    communication: z
      .object({
        score: z.number().int().min(0).max(100),
        clarity: z.enum(['strong', 'adequate', 'weak']),
        structure: z.enum(['strong', 'adequate', 'weak']),
        conciseness: z.enum(['strong', 'adequate', 'weak']),
        analysis: requiredText.max(400),
      })
      .strict(),
    strengths: z.array(answerDeepEvaluationRelatedPointItemSchema).max(3),
    improvements: z
      .array(
        answerDeepEvaluationRelatedPointItemSchema.extend({
          priority: z.enum(['high', 'medium', 'low']),
          action: requiredText.max(300),
        }),
      )
      .max(3),
    answerRevision: z.discriminatedUnion('mode', [
      z
        .object({
          mode: z.literal('revision'),
          revisedAnswer: requiredText.max(interviewAnswerContentMaxLength),
          changes: z
            .array(
              z
                .object({
                  type: z.enum(['retain', 'clarify', 'correct', 'supplement', 'trim']),
                  description: requiredText.max(300),
                })
                .strict(),
            )
            .min(1)
            .max(6),
          placeholders: z
            .array(
              z
                .object({
                  placeholder: requiredText.max(100),
                  reason: requiredText.max(200),
                })
                .strict(),
            )
            .max(5),
        })
        .strict(),
      z
        .object({
          mode: z.literal('insufficient_source'),
          reason: requiredText.max(300),
          learningOutline: z.array(requiredText.max(300)).min(1).max(6),
        })
        .strict(),
    ]),
  })
  .strict()

export function createAnswerDeepEvaluationModelOutputSchema(input: AnswerDeepEvaluationRunInput) {
  return answerDeepEvaluationModelOutputBaseSchema.superRefine((output, context) => {
    const expectedPartKeys = input.targetTurn.question.parts.map((part) => part.key)
    const outputPartKeys = output.questionPartEvaluations.map((part) => part.partKey)
    if (
      new Set(outputPartKeys).size !== outputPartKeys.length ||
      outputPartKeys.length !== expectedPartKeys.length ||
      expectedPartKeys.some((partKey) => !outputPartKeys.includes(partKey))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questionPartEvaluations'],
        message: 'questionPartEvaluations 必须且只能覆盖输入中的全部问题部分',
      })
    }

    const expectedPointKeys = input.assessmentTarget.evaluationPoints.map((point) => point.key)
    const outputPointKeys = output.pointEvaluations.map((point) => point.pointKey)
    if (
      new Set(outputPointKeys).size !== outputPointKeys.length ||
      outputPointKeys.length !== expectedPointKeys.length ||
      expectedPointKeys.some((pointKey) => !outputPointKeys.includes(pointKey))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pointEvaluations'],
        message: 'pointEvaluations 必须且只能覆盖输入中的全部目标评估点',
      })
    }

    if (output.contextRelation.type === 'depends_on_previous' && input.previousContext === null) {
      context.addIssue({
        code: 'custom',
        path: ['contextRelation'],
        message: '没有 previousContext 时不能声称当前回答依赖历史问答',
      })
    }

    output.pointEvaluations.forEach((point, pointIndex) => {
      if (point.evidenceExcerpt && !input.targetTurn.answer.content.includes(point.evidenceExcerpt)) {
        context.addIssue({
          code: 'custom',
          path: ['pointEvaluations', pointIndex, 'evidenceExcerpt'],
          message: 'evidenceExcerpt 必须是当前回答中的原文片段',
        })
      }
    })

    const availablePointKeys = new Set(expectedPointKeys)
    ;[...output.strengths, ...output.improvements].forEach((item, itemIndex) => {
      const relatedPointKeys = item.relatedPointKeys
      if (new Set(relatedPointKeys).size !== relatedPointKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['relatedPointKeys', itemIndex],
          message: 'relatedPointKeys 不能重复',
        })
      }
      relatedPointKeys.forEach((pointKey) => {
        if (!availablePointKeys.has(pointKey)) {
          context.addIssue({
            code: 'custom',
            path: ['relatedPointKeys', itemIndex],
            message: 'relatedPointKeys 必须引用本次输入中的目标评估点',
          })
        }
      })
    })
  })
}

export type AnswerDeepEvaluationRunInput = z.output<typeof answerDeepEvaluationRunInputSchema>
export type AnswerDeepEvaluationModelOutput = z.output<typeof answerDeepEvaluationModelOutputBaseSchema>
