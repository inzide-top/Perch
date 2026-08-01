import { jobAnalysisRepository } from '../repositories/job-analysis.repository'

export class AgentRunNotFoundError extends Error {
  statusCode = 404
}

function toAgentRunDebugItem(entry: Awaited<ReturnType<typeof jobAnalysisRepository.findAgentRunDebugList>>[number]) {
  return {
    id: entry.run.id,
    analysisId: entry.analysisId,
    sourceAnalysisId: entry.sourceAnalysisId,
    opportunityId: entry.opportunityId,
    company: entry.company,
    jobTitle: entry.jobTitle,
    attemptNumber: entry.run.attemptNumber,
    status: entry.run.status,
    modelName: entry.run.modelName,
    promptVersion: entry.run.promptVersion,
    durationMs: entry.run.durationMs,
    tokenUsage: entry.run.tokenUsage,
    error: entry.run.error,
    startedAt: entry.run.startedAt,
    finishedAt: entry.run.finishedAt,
  }
}

export async function getAgentRunDebugList(limit = 50) {
  const entries = await jobAnalysisRepository.findAgentRunDebugList(limit)

  return entries.map(toAgentRunDebugItem)
}

export async function getAgentRunDebugDetail(runId: string) {
  const entry = await jobAnalysisRepository.findAgentRunDebugById(runId)
  if (!entry) throw new AgentRunNotFoundError('AgentRun 不存在')

  return {
    ...toAgentRunDebugItem(entry),
    input: entry.run.input,
    rawOutput: entry.run.rawOutput,
    parsedOutput: entry.run.parsedOutput,
  }
}
