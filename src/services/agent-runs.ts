import type { AgentRunError, AgentRunStatus, AgentTokenUsage, JobAnalysisResult, JobAnalysisRunInput } from '@/types/opportunity'
import { request } from './http'

export type AgentRunDebugItem = {
  id: string
  analysisId: string
  sourceAnalysisId: string | null
  opportunityId: string
  company: string
  jobTitle: string
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
  input: JobAnalysisRunInput
  rawOutput: string | null
  parsedOutput: JobAnalysisResult | null
}

export const agentRunApi = {
  getAgentRuns(limit = 50) {
    return request.get<AgentRunDebugItem[]>(`/developer/agent-runs?limit=${limit}`)
  },

  getAgentRun(runId: string) {
    return request.get<AgentRunDebugDetail>(`/developer/agent-runs/${encodeURIComponent(runId)}`)
  },
}
