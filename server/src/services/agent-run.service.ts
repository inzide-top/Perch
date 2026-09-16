import { agentRunRepository, type AgentRunDebugListFilters } from '../repositories/agent-run.repository'
import { getCurrentUserId } from '../context/current-user'
import { toAgentRunDebugItem } from './agent-run-debug'

type AgentRunDebugListPersistence = Pick<typeof agentRunRepository, 'findDebugList'>
type AgentRunDebugDetailPersistence = Pick<typeof agentRunRepository, 'findDebugById'>

export type ListAgentRunDebugInput = Omit<AgentRunDebugListFilters, 'userId'>

export class AgentRunNotFoundError extends Error {
  statusCode = 404
}

export async function getAgentRunDebugList(
  input: ListAgentRunDebugInput,
  persistence: AgentRunDebugListPersistence = agentRunRepository,
) {
  const userId = await getCurrentUserId()
  const entries = await persistence.findDebugList({ ...input, userId })

  return entries.map(toAgentRunDebugItem)
}

export async function getAgentRunDebugDetail(
  runId: string,
  persistence: AgentRunDebugDetailPersistence = agentRunRepository,
) {
  const userId = await getCurrentUserId()
  const entry = await persistence.findDebugById(runId, userId)
  if (!entry) throw new AgentRunNotFoundError('AgentRun 不存在')

  return {
    ...toAgentRunDebugItem(entry),
    input: entry.run.input,
    rawOutput: entry.run.rawOutput,
    parsedOutput: entry.run.parsedOutput,
  }
}
