export const interviewForegroundPollDelayMs = 2_500
export const interviewBackgroundPollDelayMs = 30_000

type InterviewVisibilityState = 'visible' | 'hidden' | 'prerender' | 'unsupported'

export function getInterviewPollDelay(visibilityState: InterviewVisibilityState) {
  return visibilityState === 'hidden' ? interviewBackgroundPollDelayMs : interviewForegroundPollDelayMs
}

export function normalizeModelBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

export function isSameModelIdentity(
  first: { baseUrl: string; modelName: string },
  second: { baseUrl: string; modelName: string },
) {
  return (
    first.modelName.trim() === second.modelName.trim() &&
    normalizeModelBaseUrl(first.baseUrl) === normalizeModelBaseUrl(second.baseUrl)
  )
}

export function canApplyInterviewSessionResponse(requestGeneration: number, currentGeneration: number) {
  return requestGeneration === currentGeneration
}

type InterviewPresentationState = {
  status: string
  phase: string
  currentQuestionId: string | null
  questions: Array<{ id: string }>
  interactions: Array<{ id: string; role: string; type: string }>
}

const scoreDeferredPhases = new Set(['validating_answer', 'evaluating_answer', 'generating_question'])

/**
 * 后端可能先返回新评分，稍后才返回下一条面试官消息。
 * 在新问题或澄清内容尚未到达时，保留旧评分，避免右侧结果提前暴露。
 */
export function shouldDeferInterviewScoreUpdate(
  previous: InterviewPresentationState,
  next: InterviewPresentationState,
) {
  if (next.status !== 'active' || !scoreDeferredPhases.has(next.phase)) return false

  const hasIncomingQuestion = Boolean(
    next.currentQuestionId &&
    previous.currentQuestionId !== next.currentQuestionId &&
    !previous.questions.some((question) => question.id === next.currentQuestionId),
  )
  if (hasIncomingQuestion) return false

  const previousInteractionIds = new Set(previous.interactions.map((interaction) => interaction.id))
  const hasIncomingInterviewerMessage = next.interactions.some(
    (interaction) => interaction.role === 'interviewer' && !previousInteractionIds.has(interaction.id),
  )

  return !hasIncomingInterviewerMessage
}
