import 'dotenv/config'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { interviewSessionEvaluations, interviewSessions, interviewTurns } from '../db/schema'
import {
  applyInterviewAssistanceFactor,
  calculateInterviewOverallScore,
  calculateWeightedEvaluationPointScore,
} from '../services/interview/scoring'
import type {
  AnswerEvidence,
  InterviewAssessmentPlan,
  InterviewSessionEvaluation,
  QuestionAssessmentPlan,
} from '@/shared/interview/schemas'

type ScoreEvidence = {
  turnId: string
  topicKey: string
  score: number
  confidence: 'high' | 'medium' | 'low'
  communicationScore: number | null
  summary: string
}

function getTopicStatus(score: number): InterviewSessionEvaluation['topicEvaluations'][number]['status'] {
  if (score >= 85) return 'mastered'
  if (score >= 70) return 'solid'
  if (score >= 45) return 'partial'
  if (score > 0) return 'weak'
  return 'unknown'
}

function getCombinedConfidence(values: Array<'high' | 'medium' | 'low'>): 'high' | 'medium' | 'low' {
  if (values.includes('low')) return 'low'
  if (values.includes('medium')) return 'medium'
  return 'high'
}

function findTopic(plan: InterviewAssessmentPlan, topicKey: string) {
  return plan.topics.find((topic) => topic.key === topicKey) ?? null
}

function calculateEvidenceScore(topic: QuestionAssessmentPlan, evidence: AnswerEvidence) {
  const contentScore = calculateWeightedEvaluationPointScore(
    evidence.pointResults.map((result) => ({
      score: result.score,
      weight: topic.evaluationPoints.find((point) => point.id === result.pointId)?.weight ?? 0,
    })),
  )

  return applyInterviewAssistanceFactor(contentScore, evidence.hintUsage)
}

function getRequiredSessionId() {
  const flagIndex = process.argv.indexOf('--session-id')
  const sessionId = flagIndex >= 0 ? process.argv[flagIndex + 1] : null
  if (!sessionId) throw new TypeError('必须通过 --session-id 显式指定需要修复的模拟面试记录')
  return sessionId
}

async function recalculateInterviewScore(sessionId: string) {
  const sessions = await db
    .select({
      id: interviewSessions.id,
      assessmentPlan: interviewSessions.assessmentPlan,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId))

  if (!sessions.length) throw new TypeError(`模拟面试不存在：${sessionId}`)
  let repaired = false

  for (const session of sessions) {
    if (!session.assessmentPlan) continue

    const [evaluation] = await db
      .select()
      .from(interviewSessionEvaluations)
      .where(eq(interviewSessionEvaluations.sessionId, session.id))
      .limit(1)
    if (!evaluation) continue

    const turns = await db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.sessionId, session.id))
      .orderBy(asc(interviewTurns.sequenceNumber))
    const evidence: ScoreEvidence[] = []

    turns.forEach((turn) => {
      const topic = findTopic(session.assessmentPlan!, turn.question.topicKey)
      if (!topic) return

      if (turn.answerEvidence) {
        evidence.push({
          turnId: turn.id,
          topicKey: topic.key,
          score: calculateEvidenceScore(topic, turn.answerEvidence),
          confidence: turn.answerEvidence.confidence,
          communicationScore: Math.round(
            (turn.answerEvidence.communication.clarity +
              turn.answerEvidence.communication.structure +
              turn.answerEvidence.communication.conciseness) /
              3,
          ),
          summary: turn.answerEvidence.summary,
        })
      } else if (turn.skip?.reason === 'unknown') {
        evidence.push({
          turnId: turn.id,
          topicKey: topic.key,
          score: 0,
          confidence: 'high',
          communicationScore: null,
          summary: `候选人明确选择不会回答“${topic.label}”相关问题。`,
        })
      }
    })

    if (!evidence.length) continue

    const previousTopicByKey = new Map(evaluation.result.topicEvaluations.map((topic) => [topic.topicKey, topic]))
    const evidenceByTopic = new Map<string, ScoreEvidence[]>()
    evidence.forEach((item) => {
      const values = evidenceByTopic.get(item.topicKey) ?? []
      values.push(item)
      evidenceByTopic.set(item.topicKey, values)
    })

    const topicEvaluations = [...evidenceByTopic.entries()].flatMap(([topicKey, topicEvidence]) => {
      const topic = findTopic(session.assessmentPlan!, topicKey)
      if (!topic) return []

      const masteryScore = Math.round(
        topicEvidence.reduce((total, item) => total + item.score, 0) / topicEvidence.length,
      )
      const previous = previousTopicByKey.get(topicKey)

      return [
        {
          assessmentPlanId: topic.id,
          topicKey,
          status: getTopicStatus(masteryScore),
          masteryScore,
          evidenceConfidence: getCombinedConfidence(topicEvidence.map((item) => item.confidence)),
          supportingTurnIds: topicEvidence.map((item) => item.turnId),
          summary: previous?.summary ?? topicEvidence.at(-1)?.summary ?? '',
        },
      ]
    })
    const masteryScore = Math.round(
      topicEvaluations.reduce((total, topic) => total + topic.masteryScore, 0) / topicEvaluations.length,
    )
    const communicationEvidence = evidence.flatMap((item) =>
      item.communicationScore === null ? [] : [item.communicationScore],
    )
    const communicationScore = communicationEvidence.length
      ? Math.round(communicationEvidence.reduce((total, score) => total + score, 0) / communicationEvidence.length)
      : null
    const score =
      communicationScore === null ? masteryScore : calculateInterviewOverallScore(masteryScore, communicationScore)
    const result: InterviewSessionEvaluation = {
      ...evaluation.result,
      score,
      masteryScore,
      communicationScore,
      coverage: {
        plannedTopics: session.assessmentPlan.topics.length,
        evaluatedTopics: topicEvaluations.length,
        sufficientTopics: topicEvaluations.filter((topic) => topic.masteryScore >= 70).length,
      },
      topicEvaluations,
    }

    const scoresChanged =
      result.score !== evaluation.result.score ||
      result.masteryScore !== evaluation.result.masteryScore ||
      JSON.stringify(result.topicEvaluations) !== JSON.stringify(evaluation.result.topicEvaluations)
    if (!scoresChanged) continue

    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      await tx
        .update(interviewSessionEvaluations)
        .set({
          result,
          revision: sql`${interviewSessionEvaluations.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(interviewSessionEvaluations.sessionId, session.id))

      await tx
        .update(interviewSessions)
        .set({
          latestOverallScore: result.score,
          overallScoreStatus: result.status,
          updatedAt: now,
        })
        .where(eq(interviewSessions.id, session.id))
    })
    repaired = true
  }

  console.info(repaired ? `Recalculated interview session score: ${sessionId}` : `Score already current: ${sessionId}`)
}

recalculateInterviewScore(getRequiredSessionId()).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
