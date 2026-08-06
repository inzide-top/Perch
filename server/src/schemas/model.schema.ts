import { z } from 'zod'

const requiredText = z.string().trim().min(1)

export const modelConnectionSchema = z
  .object({
    baseUrl: z.string().trim().url(),
    modelName: requiredText,
    apiKey: requiredText,
  })
  .strict()

export type ModelConnection = z.output<typeof modelConnectionSchema>
