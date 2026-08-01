import type {
  AnswerDeepEvaluationResult,
  InterviewAssistanceLevel,
  InterviewConfiguration,
  InterviewSessionStatus as PersistedInterviewSessionStatus,
} from '@/shared/interview/schemas'
import type { AiTaskError } from './ai'

export type InterviewSessionStatus = PersistedInterviewSessionStatus

export type InterviewPhase =
  | 'building_plan'
  | 'preparation_failed'
  | 'generating_first_question'
  | 'awaiting_answer'
  | 'validating_answer'
  | 'clarifying_question'
  | 'evaluating_answer'
  | 'answer_processing_failed'
  | 'generating_question'
  | 'question_generation_failed'
  | 'model_configuration_required'
  | 'generating_review'
  | 'review_generation_failed'
  | 'review_ready'

export type InterviewType = InterviewConfiguration['type']
export type InterviewScale = InterviewConfiguration['scale']
export type InterviewDifficulty = InterviewConfiguration['difficulty']
export type AssistanceLevel = InterviewAssistanceLevel
export type QuestionRelation = 'main' | 'follow_up'
export type QuestionFormat = 'single' | 'compound'
export type SkipReason = 'unknown' | 'too_hard' | 'unclear' | 'irrelevant' | 'declined' | 'unspecified'
export type QuestionFeedbackValue = 'like' | 'dislike'

export type InterviewConfig = Omit<InterviewConfiguration, 'budget'>

export type InterviewBudget = InterviewConfiguration['budget']

export type InterviewQuestionFeedback = {
  value: QuestionFeedbackValue
  reason: string
  submittedAt: string
  locked: boolean
}

export type InterviewQuestion = {
  id: string
  sequence: number
  relation: QuestionRelation
  format: QuestionFormat
  rootQuestionId: string
  followUpCount: number
  content: string
  subQuestions: string[]
  focusLabel: string
  hintLevel1: string
  hintLevel2: string
  revealedHintLevel: AssistanceLevel
  feedback: InterviewQuestionFeedback | null
  createdAt: string
}

export type AnswerEvaluation = {
  qualityScore: number
  coverageScore: number
  confidence: number
  outcome: 'mastered' | 'mostly_correct' | 'partial' | 'weak' | 'incorrect' | 'unable_to_assess'
  evidence: string
  missedPoints: string[]
}

export type InterviewAnswer = {
  id: string
  questionId: string
  /** 后端接受回答时生成的幂等键；评估进行中用于中止并撤回本次提交。 */
  clientSubmissionId?: string
  content: string
  assistanceLevel: AssistanceLevel
  submittedAt: string
  evaluation: AnswerEvaluation | null
  deepReviewStatus: 'idle' | 'processing' | 'completed' | 'failed'
  deepReviewError: AiTaskError | null
  deepReview: AnswerDeepReview | null
}

export type AnswerDeepReview = AnswerDeepEvaluationResult & {
  createdAt: string
}

export type InterviewInteraction = {
  id: string
  questionId: string
  role: 'candidate' | 'interviewer'
  type: 'clarification_request' | 'clarification_response' | 'off_topic_message' | 'off_topic_redirect'
  content: string
  submittedAt: string | null
  createdAt: string
}

export type InterviewSkip = {
  id: string
  questionId: string
  reason: SkipReason
  createdAt: string
}

export type InterviewOverallScore = {
  state: 'evaluating' | 'provisional' | 'final' | 'partial' | 'insufficient'
  score: number | null
  coverage: number
  summary: string
  dimensions: Array<{
    key: string
    label: string
    score: number | null
  }>
}

export type InterviewReview = {
  summary: string
  strengths: Array<{
    title: string
    detail: string
    references: Array<{ turnId: string; sequenceNumber: number }>
  }>
  gaps: Array<{
    title: string
    detail: string
    priority: 'high' | 'medium' | 'low'
    references: Array<{ turnId: string; sequenceNumber: number }>
  }>
  nextPractice: string[]
  generatedAt: string
}

export type InterviewSession = {
  id: string
  opportunityId: string
  config: InterviewConfig
  budget: InterviewBudget
  model: {
    baseUrl: string
    modelName: string
  }
  stateVersion: number
  status: InterviewSessionStatus
  phase: InterviewPhase
  questions: InterviewQuestion[]
  answers: InterviewAnswer[]
  interactions: InterviewInteraction[]
  skips: InterviewSkip[]
  currentQuestionId: string | null
  streamingText: string
  streamingKind: 'question' | 'interaction' | null
  streamingCreatedAt: string | null
  overallScore: InterviewOverallScore
  review: InterviewReview | null
  taskError: AiTaskError | null
  hintImpactAcknowledged: boolean
  startedAt: string
  lastActivityAt: string
  completedAt: string | null
}

export type InterviewSessionSummary = Pick<
  InterviewSession,
  'id' | 'opportunityId' | 'config' | 'status' | 'phase' | 'startedAt' | 'lastActivityAt' | 'completedAt'
> & {
  answeredQuestionCount: number
  validAnswerCount: number
  overallScore: number | null
  primaryStrength: string | null
  primaryGap: string | null
}

export type InterviewOverview = {
  completedCount: number
  activeCount: number
  foundationCount: number
  projectCount: number
  recentScore: number | null
  primaryStrength: string | null
  primaryGap: string | null
}

export type CreateInterviewPayload = InterviewConfig
