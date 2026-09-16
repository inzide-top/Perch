import { db } from '../db/client'
import { userFeedback } from '../db/schema'

export class DrizzleFeedbackRepository {
  async create(input: typeof userFeedback.$inferInsert) {
    const [feedback] = await db
      .insert(userFeedback)
      .values(input)
      .returning({ id: userFeedback.id, createdAt: userFeedback.createdAt })

    if (!feedback) throw new Error('反馈保存失败')
    return feedback
  }
}

export const feedbackRepository = new DrizzleFeedbackRepository()
