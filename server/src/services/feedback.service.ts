import crypto from 'node:crypto'
import { createFeedbackInputSchema, type FeedbackReceipt } from '@/shared/feedback/schemas'
import { getCurrentUserId } from '../context/current-user'
import { feedbackRepository } from '../repositories/feedback.repository'

export async function createFeedback(payload: unknown): Promise<FeedbackReceipt> {
  const input = createFeedbackInputSchema.parse(payload)
  const feedback = await feedbackRepository.create({
    id: crypto.randomUUID(),
    userId: await getCurrentUserId(),
    type: input.type,
    content: input.content,
    createdAt: new Date().toISOString(),
  })

  return {
    id: feedback.id,
    createdAt: new Date(feedback.createdAt).toISOString(),
  }
}
