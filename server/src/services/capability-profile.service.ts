import type {
  CapabilityInterviewSession,
  CapabilityJdSignal,
  CapabilityProfile,
  CapabilityProjectDeclaration,
  CapabilityResumeDeclaration,
} from '@/types/capability'
import type { ResumeContent } from '@/types/resume'
import { buildDashboardOverview } from './dashboard.service'
import {
  capabilityProfileRepository,
  type CapabilityInterviewRecord,
  type CapabilityJobAnalysisRecord,
} from '../repositories/capability-profile.repository'
import { resumeRepository, type ResumeRecord } from '../repositories/resume.repository'
import { ResumeNotFoundError } from './resume.service'
import { getCurrentUserId } from '../context/current-user'
import {
  capabilityJdSignalRepository,
  type CapabilityJdSignalEmbeddingSource,
} from '../repositories/capability-jd-signal.repository'
import { buildCapabilityJdOverview } from './capability-jd-theme'
import { getConfiguredEmbeddingAdapter } from './retrieval/embedding-environment'

function hasText(value: string | undefined | null) {
  return Boolean(value?.trim())
}

function toProjectDeclaration(project: ResumeContent['projects'][number]): CapabilityProjectDeclaration {
  return {
    id: project.id,
    name: project.name,
    role: project.role,
    techStack: project.techStack,
    description: project.description,
    content: project.content,
    ...(project.outcomes ? { outcomes: project.outcomes } : {}),
  }
}

function toResumeDeclaration(content: ResumeContent): CapabilityResumeDeclaration {
  return {
    skills: content.skills,
    projects: content.projects.map(toProjectDeclaration),
  }
}

function toJdSignal(record: CapabilityJobAnalysisRecord, currentVersionId: string): CapabilityJdSignal | null {
  if (record.status !== 'completed' || !record.result) return null

  return {
    opportunityId: record.opportunityId,
    company: record.company,
    jobTitle: record.jobTitle,
    opportunityStatus: record.opportunityStatus,
    resumeVersionId: record.resumeVersionId,
    versionNumber: record.versionNumber,
    isCurrentVersion: record.resumeVersionId === currentVersionId,
    updatedAt: record.updatedAt,
    modelName: record.modelName,
    matchScore: record.result.matchScore,
    recommendation: record.result.recommendation,
    summary: record.result.summary,
    strengths: record.result.strengths,
    gaps: record.result.gaps,
    suggestions: record.result.resumeSuggestions,
  }
}

function toInterviewSession(record: CapabilityInterviewRecord, currentVersionId: string): CapabilityInterviewSession {
  return {
    sessionId: record.sessionId,
    opportunityId: record.opportunityId,
    company: record.company,
    jobTitle: record.jobTitle,
    resumeVersionId: record.resumeVersionId,
    versionNumber: record.versionNumber,
    isCurrentVersion: record.resumeVersionId === currentVersionId,
    status: record.status,
    evidenceStatus: record.evidenceStatus,
    score: record.evaluation.score ?? record.latestOverallScore,
    answeredQuestionCount: record.answeredQuestionCount,
    validAnswerCount: record.validAnswerCount,
    observedAt: record.observedAt,
  }
}

function resolveDataStatus(input: {
  resumeDeclaration: CapabilityResumeDeclaration | null
  jdSignals: CapabilityJdSignal[]
  interviewSessions: CapabilityInterviewSession[]
}): CapabilityProfile['dataStatus'] {
  const hasResumeEvidence =
    hasText(input.resumeDeclaration?.skills) || (input.resumeDeclaration?.projects.length ?? 0) > 0
  const sourceCount = [hasResumeEvidence, input.jdSignals.length > 0, input.interviewSessions.length > 0].filter(
    Boolean,
  ).length

  if (sourceCount === 0) return 'empty'
  if (sourceCount === 1) return 'partial'
  return 'sufficient'
}

export type CapabilityProfileBuildInput = {
  resume: ResumeRecord
  currentVersion: NonNullable<Awaited<ReturnType<typeof resumeRepository.findVersionById>>>
  analyses: CapabilityJobAnalysisRecord[]
  jdSignalEmbeddings?: CapabilityJdSignalEmbeddingSource[]
  interviewEvidence: CapabilityInterviewRecord[]
  generatedAt?: string
}

export function buildCapabilityProfile(input: CapabilityProfileBuildInput): CapabilityProfile {
  const resumeDeclaration = toResumeDeclaration(input.currentVersion.content)
  const jdSignals = input.analyses
    .map((record) => toJdSignal(record, input.currentVersion.id))
    .filter((signal): signal is CapabilityJdSignal => signal !== null)
  const interviewSessions = input.interviewEvidence.map((record) => toInterviewSession(record, input.currentVersion.id))
  const jdOverview = buildCapabilityJdOverview({
    records: input.jdSignalEmbeddings ?? [],
    analyzedOpportunityIds: jdSignals.map((signal) => signal.opportunityId),
    currentVersionId: input.currentVersion.id,
  })

  const interviewOverview = buildDashboardOverview({
    opportunities: [],
    analysisByOpportunityId: new Map(),
    interviewEvidence: input.interviewEvidence.map((record) => ({
      sessionId: record.sessionId,
      opportunityId: record.opportunityId,
      company: record.company,
      jobTitle: record.jobTitle,
      evaluation: record.evaluation,
      assessmentPlan: record.assessmentPlan,
      observedAt: record.observedAt,
    })),
    reviewSourceCounts: {
      writtenTestReviews: 0,
      interviewReviews: 0,
    },
    generatedAt: input.generatedAt,
  })

  const generatedAt = input.generatedAt ?? new Date().toISOString()
  return {
    generatedAt,
    dataStatus: resolveDataStatus({ resumeDeclaration, jdSignals, interviewSessions }),
    scope: {
      resumeId: input.resume.id,
      resumeTitle: input.resume.title,
      currentVersionId: input.currentVersion.id,
      currentVersionNumber: input.currentVersion.versionNumber,
      targetDirection: input.currentVersion.content.targetDirection,
    },
    resumeDeclaration,
    sourceCounts: {
      resumeDeclaration: 1,
      jdAnalyses: input.analyses.length,
      completedJdAnalyses: input.analyses.filter((record) => record.status === 'completed' && record.result).length,
      pendingJdAnalyses: input.analyses.filter(
        (record) => record.status === 'pending' || record.status === 'processing',
      ).length,
      failedJdAnalyses: input.analyses.filter((record) => record.status === 'failed').length,
      simulatedSessions: interviewSessions.length,
    },
    jdOverview,
    jdSignals,
    interview: {
      strengths: interviewOverview.ability.strengths,
      weaknesses: interviewOverview.ability.weaknesses,
      historicalWeaknesses: interviewOverview.ability.historicalWeaknesses,
      sessions: interviewSessions,
    },
  }
}

function selectResume(resumes: ResumeRecord[], resumeId?: string) {
  if (resumeId) {
    const selected = resumes.find((resume) => resume.id === resumeId)
    if (!selected) throw new ResumeNotFoundError(resumeId)
    return selected
  }

  return resumes[0] ?? null
}

export async function getCapabilityProfileForUser(userId: string, resumeId?: string): Promise<CapabilityProfile> {
  const resumes = await resumeRepository.findResumesByUserId(userId)
  const resume = selectResume(resumes, resumeId)

  if (!resume) {
    return {
      generatedAt: new Date().toISOString(),
      dataStatus: 'empty',
      scope: null,
      resumeDeclaration: null,
      sourceCounts: {
        resumeDeclaration: 0,
        jdAnalyses: 0,
        completedJdAnalyses: 0,
        pendingJdAnalyses: 0,
        failedJdAnalyses: 0,
        simulatedSessions: 0,
      },
      jdOverview: {
        indexingStatus: 'ready',
        analyzedOpportunityCount: 0,
        indexedOpportunityCount: 0,
        strengthThemes: [],
        gapThemes: [],
      },
      jdSignals: [],
      interview: {
        strengths: [],
        weaknesses: [],
        historicalWeaknesses: [],
        sessions: [],
      },
    }
  }

  const currentVersion = await resumeRepository.findVersionById(resume.currentVersionId)
  if (!currentVersion) throw new Error(`Current version ${resume.currentVersionId} not found`)

  let embeddingModel: string | null = null
  try {
    embeddingModel = getConfiguredEmbeddingAdapter()?.modelName ?? null
  } catch (error) {
    console.error('Capability profile cannot load JD signal embeddings because configuration is invalid', error)
  }

  const [analyses, interviewEvidence, jdSignalEmbeddings] = await Promise.all([
    capabilityProfileRepository.findJobAnalysesByResumeId(userId, resume.id),
    capabilityProfileRepository.findInterviewEvidenceByResumeId(userId, resume.id),
    embeddingModel
      ? capabilityJdSignalRepository.findSignalsByResumeId({ userId, resumeId: resume.id, embeddingModel })
      : Promise.resolve([]),
  ])

  return buildCapabilityProfile({
    resume,
    currentVersion,
    analyses,
    jdSignalEmbeddings,
    interviewEvidence,
  })
}

export async function getCapabilityProfile(resumeId?: string): Promise<CapabilityProfile> {
  return getCapabilityProfileForUser(await getCurrentUserId(), resumeId)
}
