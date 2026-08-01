import type { agentRuns } from '../db/schema'

type AgentRunDebugRun = Pick<
  typeof agentRuns.$inferSelect,
  | 'id'
  | 'workflowType'
  | 'analysisId'
  | 'interviewSessionId'
  | 'interviewTurnId'
  | 'attemptNumber'
  | 'status'
  | 'modelName'
  | 'promptVersion'
  | 'error'
  | 'durationMs'
  | 'startedAt'
  | 'finishedAt'
> & {
  /** 列表查询刻意不读取 tokenUsage；详情查询才返回完整 run。 */
  tokenUsage?: typeof agentRuns.$inferSelect.tokenUsage
  input?: typeof agentRuns.$inferSelect.input
  rawOutput?: typeof agentRuns.$inferSelect.rawOutput
  parsedOutput?: typeof agentRuns.$inferSelect.parsedOutput
} & Partial<typeof agentRuns.$inferSelect>

export type AgentRunDebugEntry = {
  run: AgentRunDebugRun
  sourceAnalysisId: string | null
  opportunityId: string | null
  company: string | null
  jobTitle: string | null
  turnSequenceNumber: number | null
  mainQuestionNumber: number | null
  reviewDocumentId: string | null
  reviewSourceType: 'written_test' | 'interview' | null
  reviewDocumentStatus: 'pending' | 'processing' | 'completed' | 'failed' | null
}

export function toAgentRunDebugItem(entry: AgentRunDebugEntry) {
  return {
    id: entry.run.id,
    workflowType: entry.run.workflowType,
    analysisId: entry.run.analysisId,
    sourceAnalysisId: entry.sourceAnalysisId,
    interviewSessionId: entry.run.interviewSessionId,
    interviewTurnId: entry.run.interviewTurnId,
    opportunityId: entry.opportunityId,
    company: entry.company,
    jobTitle: entry.jobTitle,
    turnSequenceNumber: entry.turnSequenceNumber,
    mainQuestionNumber: entry.mainQuestionNumber,
    reviewDocumentId: entry.reviewDocumentId,
    reviewSourceType: entry.reviewSourceType,
    reviewDocumentStatus: entry.reviewDocumentStatus,
    attemptNumber: entry.run.attemptNumber,
    status: entry.run.status,
    modelName: entry.run.modelName,
    promptVersion: entry.run.promptVersion,
    durationMs: entry.run.durationMs,
    tokenUsage: entry.run.tokenUsage ?? null,
    error: entry.run.error,
    startedAt: entry.run.startedAt,
    finishedAt: entry.run.finishedAt,
  }
}
