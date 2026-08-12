import type { ResumeContent } from '@/types/resume'

export type ResumePdfImportDraft = {
  title: string | null
  targetDirection: string | null
  name: string | null
  address: NonNullable<ResumeContent['address']>
  educationLevel: ResumeContent['educationLevel'] | null
  school: string | null
  major: string | null
  graduationYear: string | null
  currentStatus: ResumeContent['currentStatus'] | null
  jobSearchIdentity: ResumeContent['jobSearchIdentity'] | null
  portfolioLinks: NonNullable<ResumeContent['portfolioLinks']>
  languages: NonNullable<ResumeContent['languages']>
  workExperiences: NonNullable<ResumeContent['workExperiences']>
  comment: string | null
  skills: string | null
  projects: ResumeContent['projects']
}

export type ResumePdfImportResponse = {
  source: { fileName: string; pageCount: number; characterCount: number }
  draft: ResumePdfImportDraft
  recognizedFields: string[]
  missingRequiredFields: string[]
  warnings: string[]
}

export type ResumePdfImportTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ResumePdfImportTaskRecord = {
  id: string
  status: ResumePdfImportTaskStatus
  currentAttempt: number
  fileName: string
  result: ResumePdfImportResponse | null
  error: { code: string; message: string; retryable: boolean } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
