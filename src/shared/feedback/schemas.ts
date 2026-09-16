import { z } from 'zod'

export const feedbackTypeSchema = z.enum(['bug', 'improvement', 'feature'])

export const createFeedbackInputSchema = z.object({
  type: feedbackTypeSchema,
  content: z.string().trim().min(5, '请至少填写 5 个字').max(2_000, '反馈内容不能超过 2000 个字'),
})

export const feedbackReceiptSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
})

export type FeedbackType = z.infer<typeof feedbackTypeSchema>
export type CreateFeedbackInput = z.infer<typeof createFeedbackInputSchema>
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>
