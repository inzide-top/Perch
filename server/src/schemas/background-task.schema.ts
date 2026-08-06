import { z } from 'zod'

const uuidSchema = z.string().uuid()

const backgroundTaskReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job_analysis'), opportunityId: uuidSchema }).strict(),
  z.object({ type: z.literal('answer_deep_evaluation'), sessionId: uuidSchema, turnId: uuidSchema }).strict(),
  z.object({ type: z.literal('action_strategy'), snapshotId: uuidSchema }).strict(),
])

export const backgroundTaskStatusInputSchema = z
  .object({
    tasks: z.array(backgroundTaskReferenceSchema).min(1).max(50),
  })
  .strict()

export type BackgroundTaskStatusInput = z.output<typeof backgroundTaskStatusInputSchema>
export type BackgroundTaskReference = BackgroundTaskStatusInput['tasks'][number]
