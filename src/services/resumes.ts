import type { Resume, ResumeContent, ResumeVersion, VersionDiffItem } from '@/types/resume'
import type { LlmConnectionSettings } from '@/types/settings'
import { request, type RequestOptions } from './http'
import type { ResumePdfImportTaskRecord } from '@/shared/resume/pdf-import'

export type {
  ResumePdfImportDraft,
  ResumePdfImportResponse,
  ResumePdfImportTaskRecord,
} from '@/shared/resume/pdf-import'

export type CreateResumePayload = {
  title: string
  content: ResumeContent
}

export type CreateResumeResponse = {
  resume: Resume
  currentVersion: ResumeVersion
  versions: ResumeVersion[]
}

export type SaveResumeVersionPayload = CreateResumePayload & {
  changeNote?: string
}

export type SaveResumeVersionResponse =
  | {
      type: 'created_new_version'
      resume: Resume
      version: ResumeVersion
      diffSummary: VersionDiffItem[]
    }
  | {
      type: 'updated_current_version' | 'no_change'
      resume: Resume
      version: ResumeVersion
      diffSummary: []
    }

export type DeleteResumeResponse = {
  deletedResumeId: string
}

export type ResumeWorkspaceResponse = {
  resumes: Resume[]
  versions: ResumeVersion[]
}

export const resumeApi = {
  getResumes() {
    return request.get<Resume[]>('/resumes')
  },

  getResumeWorkspace() {
    return request.get<ResumeWorkspaceResponse>('/resumes/workspace')
  },

  getResumeById(resumeId: string) {
    return request.get<Resume>(`/resumes/${encodeURIComponent(resumeId)}`)
  },

  getResumeVersions(resumeId: string) {
    return request.get<ResumeVersion[]>(`/resumes/${encodeURIComponent(resumeId)}/versions`)
  },

  createResume(payload: CreateResumePayload) {
    return request.post<CreateResumeResponse>('/resumes', payload)
  },

  importResumePdf(file: File, modelConnection: LlmConnectionSettings, options: RequestOptions = {}) {
    const payload = new FormData()
    payload.append('modelConnection', JSON.stringify(modelConnection))
    payload.append('file', file, file.name)
    return request.postForm<ResumePdfImportTaskRecord>('/resumes/import-pdf', payload, options)
  },

  getResumePdfImportTask(taskId: string) {
    return request.get<ResumePdfImportTaskRecord>(`/resumes/import-pdf/${encodeURIComponent(taskId)}`)
  },

  retryResumePdfImportTask(taskId: string, modelConnection: LlmConnectionSettings) {
    return request.post<ResumePdfImportTaskRecord>(`/resumes/import-pdf/${encodeURIComponent(taskId)}/retry`, {
      modelConnection,
    })
  },

  saveResumeVersion(resumeId: string, payload: SaveResumeVersionPayload) {
    return request.post<SaveResumeVersionResponse>(`/resumes/${encodeURIComponent(resumeId)}/versions`, payload)
  },

  deleteResume(resumeId: string) {
    return request.delete<DeleteResumeResponse>(`/resumes/${encodeURIComponent(resumeId)}`)
  },
}
