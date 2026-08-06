import type {
  InterviewAssistanceLevel,
  InterviewAssessmentPlan,
  InterviewSessionEvaluation,
  QuestionAssessmentPlan,
} from '@/shared/interview/schemas'

function clampScore(score: number) {
  return Math.min(100, Math.max(0, score))
}

export function getInterviewAssistanceFactor(level: InterviewAssistanceLevel) {
  if (level === 'level_1') return 0.75 as const
  if (level === 'level_2') return 0.5 as const
  return 1 as const
}

export function applyInterviewAssistanceFactor(score: number, level: InterviewAssistanceLevel) {
  return Math.round(clampScore(score) * getInterviewAssistanceFactor(level))
}

type WeightedEvaluationPointScore = {
  score: number
  weight: number
}

/**
 * 一道题通常只抽取 Topic 下的一部分评估点。这里必须先把本题命中的权重
 * 重新归一化，否则一个只考察 40% 权重评估点的满分回答会被错误算成 40 分。
 */
export function calculateWeightedEvaluationPointScore(points: WeightedEvaluationPointScore[]) {
  const totalWeight = points.reduce((total, point) => total + Math.max(0, point.weight), 0)
  if (totalWeight <= 0) return 0

  const weightedScore = points.reduce((total, point) => total + clampScore(point.score) * Math.max(0, point.weight), 0)

  return Math.round(weightedScore / totalWeight)
}

function getTopicStatus(score: number): InterviewSessionEvaluation['topicEvaluations'][number]['status'] {
  if (score >= 85) return 'mastered'
  if (score >= 70) return 'solid'
  if (score >= 45) return 'partial'
  if (score > 0) return 'weak'
  return 'unknown'
}

/**
 * 岗位掌握度决定主体得分，表达能力只在 95%～100% 区间内调节最终结果。
 * 因此表达再好也不能掩盖知识错误，表达一般也不会把正确答案过度扣分。
 */
export function calculateInterviewOverallScore(masteryScore: number, communicationScore: number) {
  const mastery = clampScore(masteryScore)
  const communication = clampScore(communicationScore)

  return Math.round(mastery * (0.95 + 0.05 * (communication / 100)))
}

/**
 * “不会回答”是明确的负向能力证据，但不能抹掉同一主题此前已经建立的有效证据。
 * 因此它按一次新的 0 分证据并入主题均值；其他跳过原因只记录行为，不直接改分。
 */
export function applyExplicitUnknownSkipEvaluation(
  current: InterviewSessionEvaluation,
  assessmentPlan: InterviewAssessmentPlan,
  topic: QuestionAssessmentPlan,
  turnId: string,
): InterviewSessionEvaluation {
  const existingTopic = current.topicEvaluations.find((item) => item.topicKey === topic.key)
  const existingEvidenceCount = Math.max(existingTopic?.supportingTurnIds.length ?? 0, existingTopic ? 1 : 0)
  const masteryScore = existingTopic
    ? Math.round((existingTopic.masteryScore * existingEvidenceCount) / (existingEvidenceCount + 1))
    : 0
  const topicEvaluation = {
    assessmentPlanId: topic.id,
    topicKey: topic.key,
    status: getTopicStatus(masteryScore),
    masteryScore,
    evidenceConfidence: 'high' as const,
    supportingTurnIds: [...new Set([...(existingTopic?.supportingTurnIds ?? []), turnId])],
    summary: `候选人明确选择不会回答“${topic.label}”相关问题。`,
  }
  const topicEvaluations = [...current.topicEvaluations.filter((item) => item.topicKey !== topic.key), topicEvaluation]
  const averageMastery = Math.round(
    topicEvaluations.reduce((total, item) => total + item.masteryScore, 0) / topicEvaluations.length,
  )
  const communicationScore = current.communicationScore
  const score =
    communicationScore === null ? averageMastery : calculateInterviewOverallScore(averageMastery, communicationScore)
  const plannedTopics = current.coverage.plannedTopics || assessmentPlan.topics.length
  const sufficientTopics = topicEvaluations.filter((item) => item.masteryScore >= 70).length
  const weakness = `${topic.label}：当前问题明确不会回答`

  return {
    ...current,
    status: topicEvaluations.length >= 2 ? 'provisional' : 'evaluating',
    score,
    masteryScore: averageMastery,
    coverage: {
      plannedTopics,
      evaluatedTopics: topicEvaluations.length,
      sufficientTopics,
    },
    consistency: topicEvaluations.length >= 3 ? 'stable' : 'unknown',
    topicEvaluations,
    summary: topicEvaluation.summary,
    weaknesses: [...new Set([weakness, ...current.weaknesses])].slice(0, 6),
  }
}
