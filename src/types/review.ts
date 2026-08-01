/** 真实笔试或面试复盘的输入来源。 */
export type ReviewDocumentKind = 'written_test' | 'interview'

/** 复盘文本结构化任务的业务状态。 */
export type ReviewDocumentStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ReviewDocumentSegmentKind =
  'question' | 'candidate_answer' | 'interviewer_feedback' | 'candidate_reflection' | 'context'

export type ReviewDocumentSegmentSourceType = 'interview' | 'written_test' | 'unknown'
export type ReviewDocumentSegmentConfidence = 'high' | 'medium' | 'low'
export type ReviewDocumentCandidateAnswerStatus = 'complete' | 'partial' | 'explicitly_unknown' | 'unclear'

/**
 * 复盘提取结果中除 sourceQuote 外，仍保留服务端计算的绝对偏移量。
 * 这样后续展示引用或合并多个 chunk 时，不需要重新扫描整段原文。
 */
export type ReviewDocumentSegment = {
  kind: ReviewDocumentSegmentKind
  sourceType: ReviewDocumentSegmentSourceType
  content: string
  sourceQuote: string
  confidence: ReviewDocumentSegmentConfidence
  answerStatus?: ReviewDocumentCandidateAnswerStatus
  sourceStartOffset: number
  sourceEndOffset: number
}

export type ReviewDocumentResult = {
  segments: ReviewDocumentSegment[]
}

/** 机会详情中展示的复盘提取状态，不包含用户原始长文本。 */
export type ReviewDocumentSummary = {
  id: string
  sourceType: ReviewDocumentKind
  interviewRoundId: string | null
  status: ReviewDocumentStatus
  revision: number
  currentAttempt: number
  modelName: string | null
  promptVersion: string | null
  result: ReviewDocumentResult | null
  error: {
    code: string
    message: string
    retryable: boolean
  } | null
  updatedAt: string
  completedAt: string | null
}
