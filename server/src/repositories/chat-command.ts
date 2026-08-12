import { createHash } from 'node:crypto'
import type { ChatCommandType } from '@/shared/chat/schemas'

export type ChatCommandReplayIdentity = {
  conversationId: string
  runId: string | null
  type: ChatCommandType
  expectedRevision: number | null
  payloadHash: string
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
}

export function hashChatCommandPayload(input: {
  type: ChatCommandType
  expectedRevision: number | null
  payload: Record<string, unknown>
}) {
  return createHash('sha256').update(stableSerialize(input)).digest('hex')
}

export function chatCommandReplayMatches(existing: ChatCommandReplayIdentity, incoming: ChatCommandReplayIdentity) {
  return (
    existing.conversationId === incoming.conversationId &&
    existing.runId === incoming.runId &&
    existing.type === incoming.type &&
    existing.expectedRevision === incoming.expectedRevision &&
    existing.payloadHash === incoming.payloadHash
  )
}
