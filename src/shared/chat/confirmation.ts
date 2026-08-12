import {
  chatOpportunityToolConfirmationPresentationSchema,
  type ChatOpportunityToolConfirmationPresentation,
} from './schemas'
import type { ChatRunEventRecord } from '@/services/chat-stream'

export type ChatToolConfirmation = {
  toolActionId: string
  callId: string
  toolName: string
  status: 'waiting' | 'approved' | 'rejected'
  presentation: ChatOpportunityToolConfirmationPresentation
}

export function readToolConfirmationRequest(event: ChatRunEventRecord): ChatToolConfirmation | null {
  if (event.eventType !== 'confirmation_requested') return null

  const toolActionId = event.payload.toolActionId
  const callId = event.payload.callId
  const toolName = event.payload.toolName
  const presentation = chatOpportunityToolConfirmationPresentationSchema.safeParse(event.payload.presentation)
  if (
    typeof toolActionId !== 'string' ||
    typeof callId !== 'string' ||
    typeof toolName !== 'string' ||
    !presentation.success
  ) {
    return null
  }

  return {
    toolActionId,
    callId,
    toolName,
    status: 'waiting',
    presentation: presentation.data,
  }
}
