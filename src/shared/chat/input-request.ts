import { chatToolInputPresentationSchema, type ChatToolInputPresentation } from './schemas'
import type { ChatRunEventRecord } from '@/services/chat-stream'

export type ChatToolInputRequest = {
  requestId: string
  toolActionId: string
  callId: string
  toolName: string
  status: 'waiting' | 'submitted'
  missingArguments: string[]
  presentation: ChatToolInputPresentation
}

export function readToolInputRequest(event: ChatRunEventRecord): ChatToolInputRequest | null {
  if (event.eventType !== 'input_requested') return null

  const requestId = event.payload.requestId
  const toolActionId = event.payload.toolActionId
  const callId = event.payload.callId
  const toolName = event.payload.toolName
  const missingArguments = event.payload.missingArguments
  const presentation = chatToolInputPresentationSchema.safeParse(event.payload.presentation)
  if (
    typeof requestId !== 'string' ||
    typeof toolActionId !== 'string' ||
    typeof callId !== 'string' ||
    typeof toolName !== 'string' ||
    !Array.isArray(missingArguments) ||
    !missingArguments.every((item) => typeof item === 'string') ||
    !presentation.success
  ) {
    return null
  }

  return {
    requestId,
    toolActionId,
    callId,
    toolName,
    status: 'waiting',
    missingArguments,
    presentation: presentation.data,
  }
}
