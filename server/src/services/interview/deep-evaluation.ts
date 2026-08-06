import type {
  AnswerDeepEvaluationModelOutput,
  AnswerDeepEvaluationRunInput,
} from '../../schemas/interview-deep-evaluation.schema'
import type { AnswerDeepEvaluationResult } from '@/shared/interview/schemas'
import { getInterviewAssistanceFactor } from './scoring'

function getAnswerDeepEvaluationLevel(contentScore: number): AnswerDeepEvaluationResult['score']['level'] {
  if (contentScore < 30) return 'not_mastered'
  if (contentScore < 60) return 'needs_improvement'
  if (contentScore < 90) return 'solid'
  return 'excellent'
}

/** 模型只做逐点评估；总分、提示折损、等级和持久化元数据全部由服务端确定性生成。 */
export function materializeAnswerDeepEvaluationResult(
  input: AnswerDeepEvaluationRunInput,
  modelOutput: AnswerDeepEvaluationModelOutput,
): AnswerDeepEvaluationResult {
  const targetPointByKey = new Map(input.assessmentTarget.evaluationPoints.map((point) => [point.key, point]))
  const pointEvaluations = modelOutput.pointEvaluations.map((point) => {
    const targetPoint = targetPointByKey.get(point.pointKey)
    if (!targetPoint) throw new TypeError(`深度点评引用了不存在的评估点：${point.pointKey}`)

    return {
      ...point,
      label: targetPoint.label,
      relativeWeight: targetPoint.relativeWeight,
    }
  })
  const masteryScore = Math.round(
    pointEvaluations.reduce((total, point) => total + point.score * (point.relativeWeight / 100), 0),
  )
  const communicationScore = modelOutput.communication.score
  const contentScore = Math.round(masteryScore * (0.95 + 0.05 * (communicationScore / 100)))
  const assistanceFactor = getInterviewAssistanceFactor(input.targetTurn.assistance.level)
  const creditedScore = Math.round(contentScore * assistanceFactor)

  return {
    ...modelOutput,
    score: {
      masteryScore,
      communicationScore,
      contentScore,
      creditedScore,
      assistanceFactor,
      level: getAnswerDeepEvaluationLevel(contentScore),
    },
    pointEvaluations,
  }
}
