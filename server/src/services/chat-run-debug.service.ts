import { getCurrentUserId } from '../context/current-user'
import { chatRunDebugRepository, type ChatRunDebugListFilters } from '../repositories/chat-run-debug.repository'

type ChatRunDebugPersistence = Pick<typeof chatRunDebugRepository, 'findList' | 'findDetail'>

export class ChatRunDebugNotFoundError extends Error {
  statusCode = 404
}

export type ListChatRunDebugInput = Omit<ChatRunDebugListFilters, 'userId' | 'cursor'> & {
  cursor?: { createdAt: string; id: string }
}

function encodeCursor(value: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export async function getChatRunDebugList(
  input: ListChatRunDebugInput,
  persistence: ChatRunDebugPersistence = chatRunDebugRepository,
) {
  const userId = await getCurrentUserId()
  const rows = await persistence.findList({ ...input, userId })
  const hasMore = rows.length > input.limit
  const items = rows.slice(0, input.limit)
  const lastItem = items.at(-1)

  return {
    items,
    hasMore,
    nextCursor: hasMore && lastItem ? encodeCursor({ createdAt: lastItem.createdAt, id: lastItem.id }) : null,
  }
}

export async function getChatRunDebugDetail(
  runId: string,
  persistence: ChatRunDebugPersistence = chatRunDebugRepository,
) {
  const userId = await getCurrentUserId()
  const detail = await persistence.findDetail(runId, userId)
  if (!detail) throw new ChatRunDebugNotFoundError('Chat Run 不存在')
  return detail
}
