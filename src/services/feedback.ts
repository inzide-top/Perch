import type { CreateFeedbackInput, FeedbackReceipt } from '@/shared/feedback/schemas'
import { request } from './http'

export const feedbackApi = {
  create(input: CreateFeedbackInput) {
    return request.post<FeedbackReceipt>('/feedback', input)
  },
}
