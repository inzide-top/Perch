import type { AnswerDeepEvaluationRunInput } from '../../schemas/interview-deep-evaluation.schema'
import type {
  AnswerEvidence,
  InterviewAnswerContent,
  InterviewAssistanceLevel,
  InterviewDifficultyRubric,
  InterviewQuestionContent,
  InterviewQuestionHints,
  InterviewTurnKind,
  QuestionAssessmentPlan,
} from '@/shared/interview/schemas'

type DeepEvaluationSourceTurn = {
  id: string
  rootTurnId: string | null
  kind: InterviewTurnKind
  sequenceNumber: number
  question: InterviewQuestionContent
  hints: InterviewQuestionHints
  answer: InterviewAnswerContent | null
  hintUsage: InterviewAssistanceLevel
  answerEvidence: AnswerEvidence | null
}

type BuildAnswerDeepEvaluationRunInputOptions = {
  jobTitle: string
  interviewType: 'foundation' | 'project'
  configuredDifficulty: 'basic' | 'standard' | 'advanced' | 'adaptive'
  difficultyRubric: InterviewDifficultyRubric
  topic: QuestionAssessmentPlan
  turn: DeepEvaluationSourceTurn
  turns: DeepEvaluationSourceTurn[]
}

function normalizeEvaluationPointWeights(points: QuestionAssessmentPlan['evaluationPoints']) {
  const totalWeight = points.reduce((total, point) => total + point.weight, 0)
  if (totalWeight <= 0) throw new TypeError('深度点评目标评估点权重必须大于 0')

  let assignedWeight = 0
  return points.map((point, index) => {
    const relativeWeight =
      index === points.length - 1
        ? Number((100 - assignedWeight).toFixed(2))
        : Number(((point.weight / totalWeight) * 100).toFixed(2))
    assignedWeight += relativeWeight

    return {
      key: point.key,
      label: point.label,
      description: point.description,
      relativeWeight,
    }
  })
}

function getRevealedHints(turn: DeepEvaluationSourceTurn) {
  if (turn.hintUsage === 'level_1') return [turn.hints.level1]
  if (turn.hintUsage === 'level_2') return [turn.hints.level1, turn.hints.level2]
  return []
}

function getQuestionParts(question: InterviewQuestionContent) {
  if (question.format === 'single') return [{ key: 'part_1', content: question.content }]

  return question.subQuestions.map((content, index) => ({
    key: `part_${index + 1}`,
    content,
  }))
}

function buildPreviousContext(turn: DeepEvaluationSourceTurn, turns: DeepEvaluationSourceTurn[]) {
  if (turn.kind === 'main') return null

  const rootTurnId = turn.rootTurnId
  if (!rootTurnId) return null
  const rootTurn = turns.find((item) => item.id === rootTurnId)
  if (!rootTurn) return null

  const priorTurns = turns
    .filter(
      (item) =>
        item.sequenceNumber < turn.sequenceNumber &&
        (item.id === rootTurnId || item.rootTurnId === rootTurnId) &&
        Boolean(item.answerEvidence),
    )
    .slice(-2)
    .map((item) => ({
      question: item.question.content,
      answerSummary: item.answerEvidence?.summary ?? '此前回答没有形成可用摘要。',
      evidenceSummary:
        item.answerEvidence?.pointResults
          .map((point) => point.evidence)
          .filter((evidence): evidence is string => Boolean(evidence))
          .join('；')
          .slice(0, 500) ||
        item.answerEvidence?.summary ||
        '此前回答没有形成可用证据。',
    }))

  if (!priorTurns.length) return null
  return {
    rootQuestion: rootTurn.question.content,
    priorTurns,
  }
}

export function buildAnswerDeepEvaluationRunInput(
  options: BuildAnswerDeepEvaluationRunInputOptions,
): AnswerDeepEvaluationRunInput {
  const { turn, topic } = options
  if (!turn.answer || !turn.answerEvidence) throw new TypeError('只有已形成回答证据的 Turn 才能生成深度点评')

  const targetPointKeys = new Set(turn.question.targetEvaluationPointKeys)
  const targetPoints = topic.evaluationPoints.filter((point) => targetPointKeys.has(point.key))
  if (targetPoints.length !== targetPointKeys.size) throw new TypeError('当前问题引用了不存在的目标评估点')

  const resultByPointId = new Map(turn.answerEvidence.pointResults.map((result) => [result.pointId, result]))
  const pointResults = targetPoints.map((point) => {
    const result = resultByPointId.get(point.id)
    if (!result) throw new TypeError(`当前回答缺少评估点证据：${point.key}`)

    return {
      pointKey: point.key,
      status: result.status,
      evidence: result.evidence,
      score: result.score,
    }
  })
  const expectedDifficulty =
    options.configuredDifficulty === 'adaptive' ? topic.initialDifficulty : options.configuredDifficulty

  return {
    roleContext: {
      jobTitle: options.jobTitle,
      interviewType: options.interviewType,
      expectedDifficulty,
      difficultyStandard: options.difficultyRubric[expectedDifficulty],
    },
    assessmentTarget: {
      topicKey: topic.key,
      topicLabel: topic.label,
      objective: topic.objective,
      sources: topic.sources,
      evaluationPoints: normalizeEvaluationPointWeights(targetPoints),
    },
    targetTurn: {
      kind: turn.kind,
      focusLabel: turn.question.focusLabel,
      question: {
        format: turn.question.format,
        content: turn.question.content,
        parts: getQuestionParts(turn.question),
      },
      answer: {
        content: turn.answer.content,
      },
      assistance: {
        level: turn.hintUsage,
        revealedHints: getRevealedHints(turn),
      },
      preliminaryEvidence: {
        ...turn.answerEvidence,
        pointResults,
      },
    },
    previousContext: buildPreviousContext(turn, options.turns),
  }
}
