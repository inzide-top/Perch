import { z } from 'zod'

const requiredText = z.string().trim().min(1)
const optionalText = z.string().trim().optional()

export const educationLevelSchema = z.enum(['college_or_below', 'bachelor', 'master', 'doctor_or_above'])
export const currentStatusSchema = z.enum(['employed', 'unemployed', 'fresh_graduate', 'studying', 'interning'])
export const jobSearchIdentitySchema = z.enum(['campus', 'experienced', 'internship'])
export const languageAbilityLevelSchema = z.enum([
  'basic',
  'reading_writing',
  'daily_communication',
  'working_professional',
  'fluent',
])

export const resumeProjectSchema = z.object({
  id: requiredText,
  name: requiredText,
  role: z.string().trim(),
  techStack: z.string().trim(),
  description: requiredText,
  content: requiredText,
  outcomes: optionalText,
})

export const resumeContentSchema = z.object({
  targetDirection: requiredText,
  name: requiredText,
  address: z.array(z.string().trim()).default([]),
  educationLevel: educationLevelSchema.optional(),
  school: optionalText,
  major: optionalText,
  graduationYear: optionalText,
  currentStatus: currentStatusSchema.optional(),
  jobSearchIdentity: jobSearchIdentitySchema,
  portfolioLinks: z
    .array(
      z.object({
        id: requiredText,
        label: z.string().trim(),
        url: requiredText,
      }),
    )
    .default([]),
  languages: z
    .array(
      z.object({
        id: requiredText,
        language: requiredText,
        level: languageAbilityLevelSchema,
      }),
    )
    .default([]),
  workExperiences: z
    .array(
      z.object({
        id: requiredText,
        companyName: requiredText,
        industry: optionalText,
        department: optionalText,
        jobTitle: requiredText,
        period: z.object({
          start: requiredText,
          end: requiredText,
        }),
      }),
    )
    .default([]),
  comment: optionalText,
  skills: requiredText,
  projects: z.array(resumeProjectSchema).default([]),
})

export const createResumeInputSchema = z.object({
  title: requiredText,
  content: resumeContentSchema,
})

export const resumeIdParamsSchema = z.object({
  resumeId: z.string().uuid(),
})

export type CreateResumeInput = z.input<typeof createResumeInputSchema>

export const saveResumeVersionInputSchema = createResumeInputSchema.extend({
  changeNote: z.string().trim().max(160).optional(),
})

export type SaveResumeVersionInput = z.input<typeof saveResumeVersionInputSchema>
