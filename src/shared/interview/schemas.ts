import { z } from 'zod'

const requiredText = z.string().trim().min(1)
const optionalText = z.string().trim().min(1).nullable()
const scoreSchema = z.number().min(0).max(100)
export const interviewAnswerContentMaxLength = 4000
export const interviewLogicalKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,63}$/, '必须使用 2～64 位小写英文、数字或下划线，并以字母开头')

export const interviewTypeSchema = z.enum(['foundation', 'project'])
export const interviewScaleSchema = z.enum(['quick', 'standard', 'deep'])
export const interviewDifficultySchema = z.enum(['basic', 'standard', 'advanced', 'adaptive'])
export const interviewAssistanceLevelSchema = z.enum(['none', 'level_1', 'level_2'])
export const interviewSessionStatusSchema = z.enum([
  'preparing',
  'preparation_failed',
  'active',
  'finalizing',
  'completed',
  'ended_early',
  'cancelled',
])
export const interviewEvidenceStatusSchema = z.enum(['insufficient', 'partial', 'sufficient'])
export const interviewOverallScoreStatusSchema = z.enum(['evaluating', 'provisional', 'final', 'insufficient'])
export const interviewTurnStatusSchema = z.enum([
  'awaiting_answer',
  'processing',
  'processing_failed',
  'completed',
  'skipped',
  'abandoned',
])
export const interviewTurnKindSchema = z.enum(['main', 'follow_up'])
export const interviewInteractionRoleSchema = z.enum(['candidate', 'interviewer'])
export const interviewInteractionTypeSchema = z.enum([
  'clarification_request',
  'clarification_response',
  'off_topic_message',
  'off_topic_redirect',
])
export const agentWorkflowTypeSchema = z.enum([
  'job_analysis',
  'interview_plan',
  'interview_turn',
  'interview_deep_evaluation',
  'interview_final_summary',
  'review_extraction',
  'action_strategy',
])

export const interviewBudgetSchema = z.object({
  mainTopicBudget: z.number().int().positive().max(30),
  totalQuestionBudget: z.number().int().positive().max(60),
  maxFollowUpsPerRoot: z.number().int().min(0).max(3),
})

export const interviewConfigurationSchema = z.object({
  type: interviewTypeSchema,
  scale: interviewScaleSchema,
  difficulty: interviewDifficultySchema,
  referenceHistoricalWeaknesses: z.boolean(),
  budget: interviewBudgetSchema,
})

/** 只保存可审计的模型快照，API Key 永远不进入 Session 或 AgentRun。 */
export const interviewModelSnapshotSchema = z
  .object({
    modelName: requiredText,
    baseUrl: z.string().trim().url(),
  })
  .strict()

export const interviewPlanSourceSchema = z
  .object({
    type: z.enum(['job_analysis', 'resume', 'jd', 'historical_weakness', 'historical_review']),
    evidence: requiredText.max(300),
  })
  .strict()

export const questionEvaluationPointDraftSchema = z
  .object({
    key: interviewLogicalKeySchema,
    label: requiredText.max(80),
    /** 描述需要从回答中观察到的能力证据，而不是要求逐字命中的标准答案。 */
    description: requiredText.max(300),
    weight: z.number().positive().max(100),
  })
  .strict()

export const questionEvaluationPointSchema = questionEvaluationPointDraftSchema.extend({
  id: z.string().uuid(),
})

export const questionAssessmentPlanDraftSchema = z
  .object({
    key: interviewLogicalKeySchema,
    label: requiredText.max(80),
    objective: requiredText.max(300),
    priority: z.enum(['high', 'medium', 'low']),
    sources: z.array(interviewPlanSourceSchema).min(1).max(6),
    initialDifficulty: z.enum(['basic', 'standard', 'advanced']),
    evaluationPoints: z.array(questionEvaluationPointDraftSchema).min(1).max(8),
  })
  .strict()

export const questionAssessmentPlanSchema = questionAssessmentPlanDraftSchema.extend({
  id: z.string().uuid(),
  evaluationPoints: z.array(questionEvaluationPointSchema).min(1).max(8),
})

const interviewQuestionShape = {
  topicKey: interviewLogicalKeySchema,
  targetEvaluationPointKeys: z.array(interviewLogicalKeySchema).min(1).max(8),
  format: z.enum(['single', 'compound']),
  content: requiredText.max(500),
  subQuestions: z.array(requiredText.max(120)).max(3),
  focusLabel: requiredText.max(80),
}

function validateQuestionFormat(
  question: { format: 'single' | 'compound'; content: string; subQuestions: string[] },
  context: z.RefinementCtx,
) {
  if (question.format === 'single' && question.subQuestions.length !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['subQuestions'],
      message: 'single 问题不能包含 subQuestions',
    })
  }

  if (question.format === 'compound' && (question.subQuestions.length < 2 || question.subQuestions.length > 3)) {
    context.addIssue({
      code: 'custom',
      path: ['subQuestions'],
      message: 'compound 问题必须包含 2～3 个 subQuestions',
    })
  }

  if (
    question.format === 'compound' &&
    question.content.length + question.subQuestions.reduce((total, item) => total + item.length, 0) > 240
  ) {
    context.addIssue({
      code: 'custom',
      path: ['subQuestions'],
      message: 'compound 问题的引导语和全部子问题合计不能超过 240 个字符',
    })
  }
}

export const interviewQuestionSchema = z.object(interviewQuestionShape).strict().superRefine(validateQuestionFormat)

/** 提示随题目提前生成，详情接口返回完整提示；前端按用户点击级别渐进展示。 */
export const interviewQuestionHintsSchema = z.object({
  level1: requiredText,
  level2: requiredText,
})

export const interviewDifficultyRubricSchema = z
  .object({
    basic: requiredText.max(300),
    standard: requiredText.max(300),
    advanced: requiredText.max(300),
  })
  .strict()

export const interviewAssessmentPlanSchema = z
  .object({
    difficultyRubric: interviewDifficultyRubricSchema,
    topics: z.array(questionAssessmentPlanSchema).min(1).max(8),
  })
  .strict()

export const interviewPlanFirstQuestionSchema = z
  .object({
    ...interviewQuestionShape,
    hints: interviewQuestionHintsSchema,
  })
  .strict()
  .superRefine(validateQuestionFormat)

/** 模型只输出业务 Key；服务端校验通过后再生成 Topic、评估点和 Turn UUID。 */
export const interviewPlanModelOutputSchema = z
  .object({
    difficultyRubric: interviewDifficultyRubricSchema,
    topics: z.array(questionAssessmentPlanDraftSchema).min(1).max(8),
    firstQuestion: interviewPlanFirstQuestionSchema,
  })
  .strict()
  .superRefine((output, context) => {
    const topicKeys = output.topics.map((topic) => topic.key)
    if (new Set(topicKeys).size !== topicKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: 'topics.key 在同一份面试计划中必须唯一',
      })
    }

    output.topics.forEach((topic, topicIndex) => {
      const pointKeys = topic.evaluationPoints.map((point) => point.key)
      if (new Set(pointKeys).size !== pointKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['topics', topicIndex, 'evaluationPoints'],
          message: '同一主题内的 evaluationPoints.key 必须唯一',
        })
      }

      const totalWeight = topic.evaluationPoints.reduce((total, point) => total + point.weight, 0)
      if (Math.abs(totalWeight - 100) > 0.01) {
        context.addIssue({
          code: 'custom',
          path: ['topics', topicIndex, 'evaluationPoints'],
          message: '同一主题内 evaluationPoints.weight 合计必须为 100',
        })
      }
    })

    const firstTopicIndex = output.topics.findIndex((topic) => topic.key === output.firstQuestion.topicKey)
    if (firstTopicIndex < 0) {
      context.addIssue({
        code: 'custom',
        path: ['firstQuestion', 'topicKey'],
        message: 'firstQuestion.topicKey 必须引用 topics 中已存在的主题',
      })
      return
    }

    const targetKeys = output.firstQuestion.targetEvaluationPointKeys
    if (new Set(targetKeys).size !== targetKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['firstQuestion', 'targetEvaluationPointKeys'],
        message: 'firstQuestion.targetEvaluationPointKeys 不能重复',
      })
    }

    const availablePointKeys = new Set(output.topics[firstTopicIndex].evaluationPoints.map((point) => point.key))
    targetKeys.forEach((key, keyIndex) => {
      if (!availablePointKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['firstQuestion', 'targetEvaluationPointKeys', keyIndex],
          message: '目标评估点必须属于 firstQuestion.topicKey 对应的主题',
        })
      }
    })
  })

export const interviewAnswerSchema = z.object({
  content: requiredText.max(interviewAnswerContentMaxLength),
  submittedAt: z.string().datetime(),
  acceptedAt: z.string().datetime(),
})

export const interviewSkipSchema = z.object({
  reason: z.enum(['unknown', 'too_hard', 'unclear', 'irrelevant', 'declined', 'unspecified']),
  note: z.string().trim().max(300).nullable(),
  skippedAt: z.string().datetime(),
})

export const communicationEvidenceSchema = z.object({
  clarity: scoreSchema,
  structure: scoreSchema,
  conciseness: scoreSchema,
  note: requiredText,
})

export const evaluationPointResultSchema = z.object({
  pointId: z.string().uuid(),
  status: z.enum(['covered', 'partially_covered', 'missed', 'incorrect']),
  evidence: optionalText,
  score: scoreSchema,
})

export const evaluationPointDraftResultSchema = z.object({
  pointKey: interviewLogicalKeySchema,
  status: z.enum(['covered', 'partially_covered', 'missed', 'incorrect']),
  evidence: optionalText,
  score: scoreSchema,
})

/**
 * 模型负责语义判断，服务端只接受受限枚举与数值，并据此执行确定性计分。
 * 第一版不维护开放式“额外能力候选池”，避免上下文和状态无限增长。
 */
export const answerEvidenceSchema = z.object({
  relevance: z.enum(['relevant', 'partially_relevant', 'off_topic']),
  explicitlyUnknown: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  hintUsage: interviewAssistanceLevelSchema,
  pointResults: z.array(evaluationPointResultSchema),
  communication: communicationEvidenceSchema,
  summary: requiredText,
})

export const answerEvidenceDraftSchema = answerEvidenceSchema.extend({
  pointResults: z.array(evaluationPointDraftResultSchema),
})

export const interviewTurnInputClassificationSchema = z.enum([
  'formal_answer',
  'clarification_request',
  'off_topic',
  'explicit_unknown',
])

export const interviewNextActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ask_follow_up'),
      reason: requiredText.max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('ask_next_topic'),
      reason: requiredText.max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('clarify_current_question'),
      reason: requiredText.max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('redirect_to_current_question'),
      reason: requiredText.max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('finish_session'),
      reason: requiredText.max(300),
    })
    .strict(),
])

export const interviewQuestionDraftSchema = interviewPlanFirstQuestionSchema

export const interviewClarificationResponseSchema = z
  .object({
    content: requiredText.max(500),
  })
  .strict()

export const interviewSessionEvaluationPatchSchema = z
  .object({
    topicEvaluation: z
      .object({
        topicKey: interviewLogicalKeySchema,
        status: z.enum(['mastered', 'solid', 'partial', 'weak', 'unknown']),
        masteryScore: scoreSchema,
        evidenceConfidence: z.enum(['high', 'medium', 'low']),
        summary: requiredText.max(500),
      })
      .strict()
      .nullable(),
    strengths: z.array(requiredText.max(120)).max(3),
    weaknesses: z.array(requiredText.max(120)).max(3),
    suggestions: z.array(requiredText.max(160)).max(3),
  })
  .strict()

const interviewFinalReviewReferenceKeySchema = z
  .string()
  .trim()
  .regex(/^T[1-9][0-9]*$/, '引用必须使用输入证据索引中的 T 编号')

const interviewFinalReviewStrengthSchema = z
  .object({
    title: requiredText.max(120),
    detail: requiredText.max(500),
    referenceKeys: z.array(interviewFinalReviewReferenceKeySchema).min(1).max(3),
  })
  .strict()

const interviewFinalReviewGapSchema = interviewFinalReviewStrengthSchema
  .extend({
    priority: z.enum(['high', 'medium', 'low']),
  })
  .strict()

/** 模型输出使用短引用键，服务端会将它们映射为真实 turnId。 */
export const interviewFinalReviewModelSchema = z
  .object({
    summary: requiredText.max(800),
    strengths: z.array(interviewFinalReviewStrengthSchema).max(3),
    gaps: z.array(interviewFinalReviewGapSchema).max(3),
    nextPractice: z.array(requiredText.max(200)).max(3),
  })
  .strict()

const interviewFinalReviewReferenceSchema = z
  .object({
    turnId: z.string().uuid(),
    sequenceNumber: z.number().int().positive(),
  })
  .strict()

const interviewFinalReviewPersistedStrengthSchema = z
  .object({
    title: requiredText.max(120),
    detail: requiredText.max(500),
    references: z.array(interviewFinalReviewReferenceSchema).min(1).max(3),
  })
  .strict()

const interviewFinalReviewPersistedGapSchema = interviewFinalReviewPersistedStrengthSchema
  .extend({
    priority: z.enum(['high', 'medium', 'low']),
  })
  .strict()

/** 持久化后的最终复盘，引用指向真实面试问题/回答。 */
export const interviewFinalReviewSchema = z
  .object({
    summary: requiredText.max(800),
    strengths: z.array(interviewFinalReviewPersistedStrengthSchema).max(3),
    gaps: z.array(interviewFinalReviewPersistedGapSchema).max(3),
    nextPractice: z.array(requiredText.max(200)).max(3),
    generatedAt: z.string().datetime(),
  })
  .strict()

export const interviewTurnModelOutputSchema = z
  .object({
    inputClassification: interviewTurnInputClassificationSchema,
    answerEvidence: answerEvidenceDraftSchema.nullable(),
    nextAction: interviewNextActionSchema,
    nextQuestion: interviewQuestionDraftSchema.optional(),
    clarificationResponse: interviewClarificationResponseSchema.optional(),
    sessionEvaluationPatch: interviewSessionEvaluationPatchSchema.optional(),
    finalReview: interviewFinalReviewModelSchema.optional(),
  })
  .strict()
  .superRefine((output, context) => {
    const actionType = output.nextAction.type
    const shouldCreateNextQuestion = actionType === 'ask_follow_up' || actionType === 'ask_next_topic'
    const shouldReplyInCurrentTurn =
      actionType === 'clarify_current_question' || actionType === 'redirect_to_current_question'

    if (shouldCreateNextQuestion && !output.nextQuestion) {
      context.addIssue({
        code: 'custom',
        path: ['nextQuestion'],
        message: 'ask_follow_up 或 ask_next_topic 必须返回 nextQuestion',
      })
    }

    if (!shouldCreateNextQuestion && output.nextQuestion) {
      context.addIssue({
        code: 'custom',
        path: ['nextQuestion'],
        message: '只有 ask_follow_up 或 ask_next_topic 可以返回 nextQuestion',
      })
    }

    if (shouldReplyInCurrentTurn && !output.clarificationResponse) {
      context.addIssue({
        code: 'custom',
        path: ['clarificationResponse'],
        message: '澄清或跑题引导必须返回 clarificationResponse',
      })
    }

    if (!shouldReplyInCurrentTurn && output.clarificationResponse) {
      context.addIssue({
        code: 'custom',
        path: ['clarificationResponse'],
        message: '只有澄清或跑题引导可以返回 clarificationResponse',
      })
    }

    if (actionType !== 'finish_session' && output.finalReview) {
      context.addIssue({
        code: 'custom',
        path: ['finalReview'],
        message: '只有 finish_session 可以返回 finalReview',
      })
    }

    if (
      (output.inputClassification === 'formal_answer' || output.inputClassification === 'explicit_unknown') &&
      !output.answerEvidence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answerEvidence'],
        message: '正式回答或明确不会必须返回 answerEvidence',
      })
    }

    if (
      (output.inputClassification === 'clarification_request' || output.inputClassification === 'off_topic') &&
      output.answerEvidence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answerEvidence'],
        message: '澄清请求或跑题内容不应返回正式评分型 answerEvidence',
      })
    }

    if (output.inputClassification === 'clarification_request' && actionType !== 'clarify_current_question') {
      context.addIssue({
        code: 'custom',
        path: ['nextAction', 'type'],
        message: '澄清请求必须继续解释当前问题',
      })
    }

    if (output.inputClassification === 'off_topic' && actionType !== 'redirect_to_current_question') {
      context.addIssue({
        code: 'custom',
        path: ['nextAction', 'type'],
        message: '跑题内容必须引导回当前问题',
      })
    }

    if (output.inputClassification === 'explicit_unknown' && actionType === 'ask_follow_up') {
      context.addIssue({
        code: 'custom',
        path: ['nextAction', 'type'],
        message: '候选人明确不会时不应继续追问同一主题',
      })
    }
  })

export const topicEvaluationSchema = z.object({
  assessmentPlanId: z.string().uuid(),
  topicKey: requiredText,
  status: z.enum(['mastered', 'solid', 'partial', 'weak', 'unknown']),
  masteryScore: scoreSchema,
  evidenceConfidence: z.enum(['high', 'medium', 'low']),
  supportingTurnIds: z.array(z.string().uuid()).default([]),
  summary: requiredText,
})

export const interviewSessionEvaluationSchema = z.object({
  status: interviewOverallScoreStatusSchema,
  score: scoreSchema.nullable(),
  masteryScore: scoreSchema.nullable(),
  communicationScore: scoreSchema.nullable(),
  coverage: z.object({
    plannedTopics: z.number().int().nonnegative(),
    evaluatedTopics: z.number().int().nonnegative(),
    sufficientTopics: z.number().int().nonnegative(),
  }),
  consistency: z.enum(['unknown', 'unstable', 'stable', 'strong']),
  topicEvaluations: z.array(topicEvaluationSchema),
  summary: z.string().trim(),
  strengths: z.array(requiredText),
  weaknesses: z.array(requiredText),
  suggestions: z.array(requiredText),
  finalReview: interviewFinalReviewSchema.nullable().default(null),
})

export const answerDeepEvaluationLevelSchema = z.enum(['not_mastered', 'needs_improvement', 'solid', 'excellent'])

export const answerDeepEvaluationContextRelationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('independent') }).strict(),
  z
    .object({
      type: z.literal('depends_on_previous'),
      summary: requiredText.max(300),
    })
    .strict(),
])

export const answerDeepEvaluationPointSchema = z
  .object({
    pointKey: interviewLogicalKeySchema,
    label: requiredText.max(80),
    relativeWeight: z.number().positive().max(100),
    status: z.enum(['fully_met', 'partially_met', 'missed', 'incorrect', 'not_assessable']),
    score: z.number().int().min(0).max(100),
    analysis: requiredText.max(500),
    evidenceExcerpt: z.string().trim().min(1).max(500).nullable(),
    missingOrIncorrectPoints: z.array(requiredText.max(200)).max(4),
    improvement: requiredText.max(300),
  })
  .strict()

export const answerDeepEvaluationResultSchema = z
  .object({
    score: z
      .object({
        masteryScore: z.number().int().min(0).max(100),
        communicationScore: z.number().int().min(0).max(100),
        contentScore: z.number().int().min(0).max(100),
        creditedScore: z.number().int().min(0).max(100),
        assistanceFactor: z.union([z.literal(1), z.literal(0.75), z.literal(0.5)]),
        level: answerDeepEvaluationLevelSchema,
      })
      .strict(),
    summary: requiredText.max(600),
    contextRelation: answerDeepEvaluationContextRelationSchema,
    questionPartEvaluations: z
      .array(
        z
          .object({
            partKey: z.string().regex(/^part_[1-3]$/),
            status: z.enum(['answered', 'partial', 'missing', 'misunderstood']),
            analysis: requiredText.max(400),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    pointEvaluations: z.array(answerDeepEvaluationPointSchema).min(1).max(8),
    communication: z
      .object({
        score: z.number().int().min(0).max(100),
        clarity: z.enum(['strong', 'adequate', 'weak']),
        structure: z.enum(['strong', 'adequate', 'weak']),
        conciseness: z.enum(['strong', 'adequate', 'weak']),
        analysis: requiredText.max(400),
      })
      .strict(),
    strengths: z
      .array(
        z
          .object({
            title: requiredText.max(100),
            analysis: requiredText.max(400),
            relatedPointKeys: z.array(interviewLogicalKeySchema).max(8),
          })
          .strict(),
      )
      .max(3),
    improvements: z
      .array(
        z
          .object({
            title: requiredText.max(100),
            analysis: requiredText.max(400),
            priority: z.enum(['high', 'medium', 'low']),
            action: requiredText.max(300),
            relatedPointKeys: z.array(interviewLogicalKeySchema).max(8),
          })
          .strict(),
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
  .superRefine((result, context) => {
    const partKeys = result.questionPartEvaluations.map((part) => part.partKey)
    if (new Set(partKeys).size !== partKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['questionPartEvaluations'],
        message: 'questionPartEvaluations.partKey 不能重复',
      })
    }

    const pointKeys = result.pointEvaluations.map((point) => point.pointKey)
    const availablePointKeys = new Set(pointKeys)
    if (availablePointKeys.size !== pointKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['pointEvaluations'],
        message: 'pointEvaluations.pointKey 不能重复',
      })
    }

    const totalWeight = result.pointEvaluations.reduce((total, point) => total + point.relativeWeight, 0)
    if (Math.abs(totalWeight - 100) > 0.01) {
      context.addIssue({
        code: 'custom',
        path: ['pointEvaluations'],
        message: 'pointEvaluations.relativeWeight 合计必须为 100',
      })
    }

    ;[...result.strengths, ...result.improvements].forEach((item, itemIndex) => {
      if (new Set(item.relatedPointKeys).size !== item.relatedPointKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['relatedPointKeys', itemIndex],
          message: 'relatedPointKeys 不能重复',
        })
      }
      item.relatedPointKeys.forEach((pointKey) => {
        if (!availablePointKeys.has(pointKey)) {
          context.addIssue({
            code: 'custom',
            path: ['relatedPointKeys', itemIndex],
            message: 'relatedPointKeys 必须引用 pointEvaluations 中已存在的评估点',
          })
        }
      })
    })

    if (result.communication.score !== result.score.communicationScore) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'communicationScore'],
        message: 'score.communicationScore 必须与 communication.score 一致',
      })
    }

    const expectedMasteryScore = Math.round(
      result.pointEvaluations.reduce((total, point) => total + point.score * (point.relativeWeight / 100), 0),
    )
    if (result.score.masteryScore !== expectedMasteryScore) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'masteryScore'],
        message: 'masteryScore 必须由各评估点分数和 relativeWeight 加权计算',
      })
    }

    const expectedContentScore = Math.round(
      expectedMasteryScore * (0.95 + 0.05 * (result.score.communicationScore / 100)),
    )
    if (result.score.contentScore !== expectedContentScore) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'contentScore'],
        message: 'contentScore 必须由 masteryScore 和 communicationScore 按既定公式计算',
      })
    }

    const expectedCreditedScore = Math.round(expectedContentScore * result.score.assistanceFactor)
    if (result.score.creditedScore !== expectedCreditedScore) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'creditedScore'],
        message: 'creditedScore 必须由 contentScore 和 assistanceFactor 计算',
      })
    }

    const expectedLevel =
      expectedContentScore < 30
        ? 'not_mastered'
        : expectedContentScore < 60
          ? 'needs_improvement'
          : expectedContentScore < 90
            ? 'solid'
            : 'excellent'
    if (result.score.level !== expectedLevel) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'level'],
        message: 'level 必须由 contentScore 的固定分段计算',
      })
    }
  })

export const interviewTurnInteractionSchema = z.object({
  role: interviewInteractionRoleSchema,
  type: interviewInteractionTypeSchema,
  content: requiredText,
  submittedAt: z.string().datetime().nullable(),
})

export const interviewFeedbackReasonsSchema = z.array(requiredText).max(5)

export type InterviewConfiguration = z.output<typeof interviewConfigurationSchema>
export type InterviewModelSnapshot = z.output<typeof interviewModelSnapshotSchema>
export type QuestionAssessmentPlan = z.output<typeof questionAssessmentPlanSchema>
export type QuestionAssessmentPlanDraft = z.output<typeof questionAssessmentPlanDraftSchema>
export type InterviewQuestionContent = z.output<typeof interviewQuestionSchema>
export type InterviewQuestionHints = z.output<typeof interviewQuestionHintsSchema>
export type InterviewDifficultyRubric = z.output<typeof interviewDifficultyRubricSchema>
export type InterviewPlanModelOutput = z.output<typeof interviewPlanModelOutputSchema>
export type InterviewAssessmentPlan = z.output<typeof interviewAssessmentPlanSchema>
export type InterviewTurnInputClassification = z.output<typeof interviewTurnInputClassificationSchema>
export type InterviewNextAction = z.output<typeof interviewNextActionSchema>
export type InterviewQuestionDraft = z.output<typeof interviewQuestionDraftSchema>
export type InterviewClarificationResponse = z.output<typeof interviewClarificationResponseSchema>
export type InterviewSessionEvaluationPatch = z.output<typeof interviewSessionEvaluationPatchSchema>
export type InterviewFinalReviewModel = z.output<typeof interviewFinalReviewModelSchema>
export type InterviewFinalReview = z.output<typeof interviewFinalReviewSchema>
export type InterviewTurnModelOutput = z.output<typeof interviewTurnModelOutputSchema>
export type InterviewAnswerContent = z.output<typeof interviewAnswerSchema>
export type InterviewSkip = z.output<typeof interviewSkipSchema>
export type AnswerEvidence = z.output<typeof answerEvidenceSchema>
export type AnswerEvidenceDraft = z.output<typeof answerEvidenceDraftSchema>
export type TopicEvaluation = z.output<typeof topicEvaluationSchema>
export type InterviewSessionEvaluation = z.output<typeof interviewSessionEvaluationSchema>
export type AnswerDeepEvaluationResult = z.output<typeof answerDeepEvaluationResultSchema>
export type InterviewFeedbackReasons = z.output<typeof interviewFeedbackReasonsSchema>
export type InterviewSessionStatus = z.output<typeof interviewSessionStatusSchema>
export type InterviewEvidenceStatus = z.output<typeof interviewEvidenceStatusSchema>
export type InterviewOverallScoreStatus = z.output<typeof interviewOverallScoreStatusSchema>
export type InterviewTurnStatus = z.output<typeof interviewTurnStatusSchema>
export type InterviewTurnKind = z.output<typeof interviewTurnKindSchema>
export type InterviewInteractionRole = z.output<typeof interviewInteractionRoleSchema>
export type InterviewInteractionType = z.output<typeof interviewInteractionTypeSchema>
export type InterviewAssistanceLevel = z.output<typeof interviewAssistanceLevelSchema>
export type AgentWorkflowType = z.output<typeof agentWorkflowTypeSchema>
