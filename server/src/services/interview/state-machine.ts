export type InterviewSubmissionReplay = 'new' | 'same_operation' | 'conflict'

export function getInterviewSubmissionReplay(input: {
  sessionId: string
  turnId: string
  existingAnswerTurn: { id: string; sessionId: string } | null
  existingInteraction: { turnId: string } | null
}): InterviewSubmissionReplay {
  if (input.existingAnswerTurn) {
    return input.existingAnswerTurn.sessionId === input.sessionId && input.existingAnswerTurn.id === input.turnId
      ? 'same_operation'
      : 'conflict'
  }

  if (input.existingInteraction) {
    return input.existingInteraction.turnId === input.turnId ? 'same_operation' : 'conflict'
  }

  return 'new'
}

export function getInterviewCancellationOperationKeys(
  sessionId: string,
  currentTurn: { id: string; answerSubmissionKey: string | null } | null,
) {
  const operationKeys = [`interview_plan:${sessionId}`]

  if (!currentTurn) return operationKeys

  operationKeys.push(`interview_skip:${currentTurn.id}`)
  if (currentTurn.answerSubmissionKey) {
    operationKeys.push(`interview_turn:${currentTurn.id}:${currentTurn.answerSubmissionKey}`)
  }

  return operationKeys
}
