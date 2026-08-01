import type { AnalysisItem, JobAnalysisResult, JobOpportunityStatus, ResumeSuggestion } from './opportunity'
import type { DashboardAbilityInsight, DashboardHistoricalWeakness } from './dashboard'

export type CapabilityProfileDataStatus = 'empty' | 'partial' | 'sufficient'

export type CapabilityProfileScope = {
  resumeId: string
  resumeTitle: string
  currentVersionId: string
  currentVersionNumber: number
  targetDirection: string
}

export type CapabilityProjectDeclaration = {
  id: string
  name: string
  role: string
  techStack: string
  description: string
  content: string
  outcomes?: string
}

export type CapabilityResumeDeclaration = {
  skills: string
  projects: CapabilityProjectDeclaration[]
}

export type CapabilityJdSignal = {
  opportunityId: string
  company: string
  jobTitle: string
  opportunityStatus: JobOpportunityStatus
  resumeVersionId: string
  versionNumber: number
  isCurrentVersion: boolean
  updatedAt: string
  modelName: string | null
  matchScore: number
  recommendation: JobAnalysisResult['recommendation']
  summary: string
  strengths: AnalysisItem[]
  gaps: AnalysisItem[]
  suggestions: ResumeSuggestion[]
}

export type CapabilityInterviewSession = {
  sessionId: string
  opportunityId: string
  company: string
  jobTitle: string
  resumeVersionId: string
  versionNumber: number
  isCurrentVersion: boolean
  status: 'completed' | 'ended_early'
  evidenceStatus: 'partial' | 'sufficient'
  score: number | null
  answeredQuestionCount: number
  validAnswerCount: number
  observedAt: string
}

export type CapabilityProfile = {
  generatedAt: string
  dataStatus: CapabilityProfileDataStatus
  scope: CapabilityProfileScope | null
  resumeDeclaration: CapabilityResumeDeclaration | null
  sourceCounts: {
    resumeDeclaration: number
    jdAnalyses: number
    completedJdAnalyses: number
    pendingJdAnalyses: number
    failedJdAnalyses: number
    simulatedSessions: number
  }
  jdSignals: CapabilityJdSignal[]
  interview: {
    strengths: DashboardAbilityInsight[]
    weaknesses: DashboardAbilityInsight[]
    historicalWeaknesses: DashboardHistoricalWeakness[]
    sessions: CapabilityInterviewSession[]
  }
}
