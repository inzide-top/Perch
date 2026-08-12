import type { ChatRunStatus } from '@/shared/chat/schemas'

/** 将一个内部事件编码为浏览器 Fetch Stream 可以消费的 SSE 帧。 */
export function formatChatSseEvent(eventName: string, payload: unknown) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
}

/** 把业务状态映射为传输边界；等待用户输入或确认只暂停 HTTP 流，不结束 ChatRun。 */
export function getChatStreamBoundary(status: ChatRunStatus, hasPendingEvents: boolean) {
  if (hasPendingEvents) return null
  if (status === 'waiting_input' || status === 'waiting_confirmation') return 'suspended' as const
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return 'completed' as const
  return null
}
