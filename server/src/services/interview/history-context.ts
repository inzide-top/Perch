import type { InterviewRound, InterviewRoundResult, WrittenTestReview } from '@/types/opportunity'
import type { ReviewDocumentResult, ReviewDocumentStatus } from '@/types/review'
import type { InterviewAssessmentPlan, InterviewSessionEvaluation } from '@/shared/interview/schemas'
import type { HistoricalInterviewReview, HistoricalInterviewWeakness } from '../../schemas/interview-plan.schema'

const historicalWeaknessLimit = 5
const historicalReviewLimit = 8
const weaknessScoreThreshold = 60

type HistoricalEvaluationSnapshot = {
  evaluation: InterviewSessionEvaluation
  assessmentPlan: InterviewAssessmentPlan | null
  observedAt: string
}

type WeaknessCandidate = {
  topicKey: string
  topicLabel: string
  summary: string
  scores: number[]
  latestScore: number
  confidences: Array<'high' | 'medium' | 'low'>
  occurrences: number
  lastObservedAt: string
}

export type HistoricalReviewDocument = {
  sourceType: 'written_test' | 'interview'
  interviewRoundId: string | null
  status: ReviewDocumentStatus
  result: ReviewDocumentResult | null
  updatedAt: string
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`
}

/**
 * postgres-js 的 timestamp 字符串可能是 `YYYY-MM-DD HH:mm:ss+00`，而进入
 * 面试计划 schema 的时间字段统一要求 RFC 3339/ISO 格式。
 */
function normalizeTimestamp(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null

  const timestamp = new Date(normalized)
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString()
}

function isWeakTopic(topic: InterviewSessionEvaluation['topicEvaluations'][number]) {
  return topic.status === 'weak' || topic.status === 'unknown' || topic.masteryScore < weaknessScoreThreshold
}

function combineConfidence(
  confidences: Array<'high' | 'medium' | 'low'>,
  occurrences: number,
): 'high' | 'medium' | 'low' {
  if (occurrences >= 2 || confidences.includes('high')) return 'high'
  if (confidences.includes('medium')) return 'medium'
  return 'low'
}

function formatWeaknessSummary(candidate: WeaknessCandidate) {
  const latestSummary = candidate.summary || `历史面试中“${candidate.topicLabel}”表现较弱。`
  const recurrence =
    candidate.occurrences > 1 ? `在 ${candidate.occurrences} 场历史模拟面试中重复暴露。` : '在历史模拟面试中出现过。'

  return truncate(`${recurrence}${latestSummary}`, 300)
}

/**
 * 从已结束且有足够证据的模拟面试中提取可复用的薄弱主题。
 * 只使用带 topicKey 的结构化 TopicEvaluation；没有主题归属的自由文本
 * weaknesses 不直接映射，避免把无法定位的结论误投给下一轮计划。
 */
export function collectHistoricalWeaknesses(records: HistoricalEvaluationSnapshot[]): HistoricalInterviewWeakness[] {
  const candidates = new Map<string, WeaknessCandidate>()

  for (const record of records) {
    const observedAt = normalizeTimestamp(record.observedAt) ?? '1970-01-01T00:00:00.000Z'
    const topicLabels = new Map((record.assessmentPlan?.topics ?? []).map((topic) => [topic.key, topic.label]))
    const seenTopicKeys = new Set<string>()

    for (const topic of record.evaluation.topicEvaluations) {
      if (!isWeakTopic(topic) || seenTopicKeys.has(topic.topicKey)) continue
      seenTopicKeys.add(topic.topicKey)

      const existing = candidates.get(topic.topicKey)
      const topicLabel = topicLabels.get(topic.topicKey) ?? topic.topicKey
      if (!existing) {
        candidates.set(topic.topicKey, {
          topicKey: topic.topicKey,
          topicLabel,
          summary: topic.summary,
          scores: [topic.masteryScore],
          latestScore: topic.masteryScore,
          confidences: [topic.evidenceConfidence],
          occurrences: 1,
          lastObservedAt: observedAt,
        })
        continue
      }

      existing.occurrences += 1
      existing.scores.push(topic.masteryScore)
      existing.confidences.push(topic.evidenceConfidence)
      if (observedAt > existing.lastObservedAt) {
        existing.lastObservedAt = observedAt
        existing.topicLabel = topicLabel
        existing.summary = topic.summary
        existing.latestScore = topic.masteryScore
      }
    }
  }

  return [...candidates.values()]
    .sort((current, next) => {
      if (current.occurrences !== next.occurrences) return next.occurrences - current.occurrences
      const currentScore = current.latestScore
      const nextScore = next.latestScore
      if (currentScore !== nextScore) return currentScore - nextScore
      return next.lastObservedAt.localeCompare(current.lastObservedAt)
    })
    .slice(0, historicalWeaknessLimit)
    .map((candidate) => ({
      topicKey: candidate.topicKey,
      topicLabel: candidate.topicLabel,
      summary: formatWeaknessSummary(candidate),
      masteryScore: Math.round(candidate.scores.reduce((total, score) => total + score, 0) / candidate.scores.length),
      confidence: combineConfidence(candidate.confidences, candidate.occurrences),
      lastObservedAt: candidate.lastObservedAt,
    }))
}

function normalizeParts(parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean)
}

function buildExtractedReviewSummary(result: ReviewDocumentResult) {
  const segments = result.segments.filter((segment) => segment.content.trim())
  if (!segments.length) return null

  const summary = truncate(
    segments
      .map((segment) => segment.content.trim())
      .filter(Boolean)
      .join('；'),
    500,
  )
  const keyTakeaways = [
    ...new Set(
      segments.filter((segment) => segment.kind !== 'context').map((segment) => truncate(segment.content, 160)),
    ),
  ].slice(0, 3)

  return { summary, keyTakeaways }
}

function mapInterviewOutcome(result: InterviewRoundResult): HistoricalInterviewReview['outcome'] {
  if (result === 'passed') return 'passed'
  if (result === 'failed') return 'failed'
  if (result === 'pending') return 'pending'
  return 'unknown'
}

function toWrittenTestReview(review: WrittenTestReview): HistoricalInterviewReview | null {
  const summary = review.reviewNote.trim()
  if (!summary) return null

  return {
    source: 'written_test',
    title: '笔试复盘',
    outcome: 'unknown',
    summary: truncate(summary, 500),
    keyTakeaways: [],
    observedAt: normalizeTimestamp(review.updatedAt || review.scheduledAt),
  }
}

function toInterviewRoundReview(round: InterviewRound): HistoricalInterviewReview | null {
  if (round.status !== 'completed') return null

  const keyTakeaways = normalizeParts(round.keyTakeaways).slice(0, 3)
  const details = normalizeParts([round.reviewNote, round.note])
  const summary = details.join('；') || (round.result !== 'pending' ? `本轮面试结果：${round.result}` : '')
  if (!summary && !keyTakeaways.length) return null

  return {
    source: 'interview_round',
    title: `第 ${round.sequence} 轮${round.title ? ` · ${round.title}` : ''}`,
    outcome: mapInterviewOutcome(round.result),
    summary: truncate(summary || keyTakeaways.join('；'), 500),
    keyTakeaways,
    observedAt: normalizeTimestamp(round.updatedAt || round.scheduledAt),
  }
}

function toExtractedReview(
  document: HistoricalReviewDocument,
  round: InterviewRound | null,
): HistoricalInterviewReview | null {
  if (document.status !== 'completed' || !document.result) return null

  const extracted = buildExtractedReviewSummary(document.result)
  if (!extracted) return null

  if (document.sourceType === 'written_test') {
    return {
      source: 'written_test',
      title: '笔试复盘',
      outcome: 'unknown',
      summary: extracted.summary,
      keyTakeaways: extracted.keyTakeaways,
      observedAt: normalizeTimestamp(document.updatedAt),
    }
  }

  if (!round || round.status !== 'completed') return null

  return {
    source: 'interview_round',
    title: `第 ${round.sequence} 轮${round.title ? ` · ${round.title}` : ''}`,
    outcome: mapInterviewOutcome(round.result),
    summary: extracted.summary,
    keyTakeaways: extracted.keyTakeaways,
    observedAt: normalizeTimestamp(document.updatedAt || round.updatedAt || round.scheduledAt),
  }
}

export function collectHistoricalReviews(input: {
  writtenTestReview: WrittenTestReview | null
  interviewRounds: InterviewRound[]
  reviewDocuments?: HistoricalReviewDocument[]
}): HistoricalInterviewReview[] {
  const reviewDocuments = input.reviewDocuments ?? []
  const writtenTestDocument = reviewDocuments.find(
    (document) => document.sourceType === 'written_test' && document.status === 'completed',
  )
  const writtenTestReview =
    (writtenTestDocument && toExtractedReview(writtenTestDocument, null)) ??
    toWrittenTestReview(input.writtenTestReview ?? { scheduledAt: '', reviewNote: '', updatedAt: '' })

  const interviewReviews = input.interviewRounds.map((round) => {
    const document = reviewDocuments.find(
      (candidate) =>
        candidate.sourceType === 'interview' &&
        candidate.interviewRoundId === round.id &&
        candidate.status === 'completed',
    )

    return (document && toExtractedReview(document, round)) ?? toInterviewRoundReview(round)
  })

  return [writtenTestReview, ...interviewReviews]
    .filter((review): review is HistoricalInterviewReview => review !== null)
    .sort((current, next) => {
      if (!current.observedAt) return 1
      if (!next.observedAt) return -1
      return next.observedAt.localeCompare(current.observedAt)
    })
    .slice(0, historicalReviewLimit)
}
