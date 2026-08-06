import { z } from 'zod'

export const capabilityProfileQuerySchema = z
  .object({
    resumeId: z.string().uuid().optional(),
  })
  .strict()

export type CapabilityProfileQuery = z.infer<typeof capabilityProfileQuerySchema>
