import type { ChatJsonObject, OpportunityContextSection } from '@/shared/chat/schemas'
import { interviewRepository } from '../../repositories/interview.repository'
import { jobAnalysisRepository } from '../../repositories/job-analysis.repository'
import { opportunityRepository } from '../../repositories/opportunity.repository'

const opportunityStatusLabels = {
  pending_apply: '待投递',
  applied: '已投递',
  written_test: '笔试中',
  interviewing: '面试中',
  oc: 'OC',
  offered: '已 Offer',
  closed: '已终止',
} as const

function clipText(value: string | null | undefined, maxChars: number) {
  const text = value?.trim() ?? ''
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

/**
 * 给模型提供有界的机会事实快照。这里只读数据库，不生成新分析，也不返回整段超长历史原文。
 */
export async function getOpportunityContextForUser(input: {
  userId: string
  opportunityId: string
  sections: OpportunityContextSection[]
}): Promise<ChatJsonObject> {
  const opportunity = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (!opportunity || opportunity.userId !== input.userId) {
    throw new Error('机会不存在或不属于当前用户')
  }

  const requestedSections = new Set(input.sections)
  const [analysis, interviewHistory, mockInterviewRows] = await Promise.all([
    requestedSections.has('job_analysis')
      ? jobAnalysisRepository.findAnalysisByOpportunityId(opportunity.id)
      : Promise.resolve(null),
    requestedSections.has('real_interviews')
      ? opportunityRepository.findInterviewHistoryByOpportunityId(opportunity.id, opportunity)
      : Promise.resolve(null),
    requestedSections.has('mock_interviews')
      ? interviewRepository.listSessionSummariesByOpportunityId(opportunity.id)
      : Promise.resolve([]),
  ])

  const result: ChatJsonObject = {
    opportunity: {
      id: opportunity.id,
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      status: opportunity.status,
      statusLabel: opportunityStatusLabels[opportunity.status],
      intentionLevel: opportunity.intentionLevel,
      updatedAt: opportunity.updatedAt,
    },
    requestedSections: input.sections,
  }

  if (requestedSections.has('profile')) {
    result.profile = {
      industry: opportunity.industry,
      address: opportunity.address ?? [],
      includeWrittenTest: opportunity.includeWrittenTest,
      introduction: clipText(opportunity.introduction, 1_000),
      description: clipText(opportunity.description, 5_000),
      note: clipText(opportunity.note, 1_500),
      createdAt: opportunity.createdAt,
    }
  }

  if (requestedSections.has('job_analysis')) {
    result.jobAnalysis = analysis
      ? {
          status: analysis.status,
          updatedAt: analysis.updatedAt,
          modelName: analysis.modelName,
          result:
            analysis.status === 'completed' && analysis.result
              ? {
                  matchScore: analysis.result.matchScore,
                  recommendation: analysis.result.recommendation,
                  summary: clipText(analysis.result.summary, 1_000),
                  strengths: analysis.result.strengths.slice(0, 3),
                  gaps: analysis.result.gaps.slice(0, 3),
                  resumeSuggestions: analysis.result.resumeSuggestions.slice(0, 3),
                  interviewFocus: analysis.result.interviewFocus.slice(0, 3),
                }
              : null,
        }
      : { status: 'not_created', result: null }
  }

  if (requestedSections.has('real_interviews')) {
    const extractedSignals =
      interviewHistory?.reviewDocuments
        .flatMap(
          (document) =>
            document.result?.segments
              .filter((segment) => segment.kind !== 'context')
              .slice(0, 8)
              .map((segment) => ({
                sourceType: document.sourceType,
                interviewRoundId: document.interviewRoundId,
                kind: segment.kind,
                content: clipText(segment.content, 300),
                confidence: segment.confidence,
                ...(segment.answerStatus ? { answerStatus: segment.answerStatus } : {}),
              })) ?? [],
        )
        .slice(0, 16) ?? []

    result.realInterviews = {
      writtenTest: interviewHistory?.writtenTestReview
        ? {
            scheduledAt: interviewHistory.writtenTestReview.scheduledAt || null,
            reviewExcerpt: clipText(interviewHistory.writtenTestReview.reviewNote, 2_000),
            updatedAt: interviewHistory.writtenTestReview.updatedAt || null,
          }
        : null,
      interviewRounds:
        interviewHistory?.interviewRounds.slice(0, 6).map((round) => ({
          id: round.id,
          sequence: round.sequence,
          type: round.type,
          title: round.title,
          scheduledAt: round.scheduledAt || null,
          status: round.status,
          result: round.result,
          note: clipText(round.note, 500),
          reviewExcerpt: clipText(round.reviewNote, 1_500),
          keyTakeaways: round.keyTakeaways.slice(0, 5),
          updatedAt: round.updatedAt,
        })) ?? [],
      extractedSignals,
    }
  }

  if (requestedSections.has('mock_interviews')) {
    result.mockInterviews = mockInterviewRows.slice(0, 5).map((row) => ({
      sessionId: row.session.id,
      status: row.session.status,
      evidenceStatus: row.session.evidenceStatus,
      configuration: row.session.configuration,
      score: row.evaluation?.score ?? row.session.latestOverallScore,
      answeredQuestionCount: Number(row.answeredQuestionCount ?? 0),
      validAnswerCount: Number(row.validAnswerCount ?? 0),
      strengths: row.evaluation?.strengths.slice(0, 3) ?? [],
      weaknesses: row.evaluation?.weaknesses.slice(0, 3) ?? [],
      suggestions: row.evaluation?.suggestions.slice(0, 3) ?? [],
      lastActiveAt: row.session.lastActiveAt,
      endedAt: row.session.endedAt,
    }))
  }

  return result
}
