import type { AgentWorkflowType } from '@/shared/interview/schemas'
import type { AgentRunError, AgentRunStatus, AgentTokenUsage } from '@/types/opportunity'
import { request } from './http'

export type AgentRunDebugItem = {
  id: string
  workflowType: AgentWorkflowType
  analysisId: string | null
  sourceAnalysisId: string | null
  interviewSessionId: string | null
  interviewTurnId: string | null
  reviewDocumentId: string | null
  reviewSourceType: 'written_test' | 'interview' | null
  reviewDocumentStatus: 'pending' | 'processing' | 'completed' | 'failed' | null
  opportunityId: string | null
  company: string | null
  jobTitle: string | null
  turnSequenceNumber: number | null
  mainQuestionNumber: number | null
  attemptNumber: number
  status: AgentRunStatus
  modelName: string
  promptVersion: string
  durationMs: number | null
  tokenUsage: AgentTokenUsage | null
  error: AgentRunError | null
  startedAt: string
  finishedAt: string | null
}

export type AgentRunDebugDetail = AgentRunDebugItem & {
  input: unknown
  rawOutput: string | null
  parsedOutput: unknown
}

export const agentRunApi = {
  getAgentRuns(options: { limit?: number; workflowType?: AgentWorkflowType } = {}) {
    const searchParams = new URLSearchParams({ limit: String(options.limit ?? 50) })
    if (options.workflowType) searchParams.set('workflowType', options.workflowType)

    return request.get<AgentRunDebugItem[]>(`/developer/agent-runs?${searchParams.toString()}`)
  },

  getAgentRun(runId: string) {
    return request.get<AgentRunDebugDetail>(`/developer/agent-runs/${encodeURIComponent(runId)}`)
  },
}
