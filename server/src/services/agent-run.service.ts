import { agentRunRepository, type AgentRunDebugListFilters } from '../repositories/agent-run.repository'
import { toAgentRunDebugItem } from './agent-run-debug'

export class AgentRunNotFoundError extends Error {
  statusCode = 404
}

export async function getAgentRunDebugList(filters: AgentRunDebugListFilters) {
  const entries = await agentRunRepository.findDebugList(filters)

  return entries.map(toAgentRunDebugItem)
}

export async function getAgentRunDebugDetail(runId: string) {
  const entry = await agentRunRepository.findDebugById(runId)
  if (!entry) throw new AgentRunNotFoundError('AgentRun 不存在')

  return {
    ...toAgentRunDebugItem(entry),
    input: entry.run.input,
    rawOutput: entry.run.rawOutput,
    parsedOutput: entry.run.parsedOutput,
  }
}
