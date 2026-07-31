import type { Resume, ResumeContent, ResumeVersion, VersionDiffItem } from '@/types/resume'
import { request } from './http'

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

  saveResumeVersion(resumeId: string, payload: SaveResumeVersionPayload) {
    return request.post<SaveResumeVersionResponse>(`/resumes/${encodeURIComponent(resumeId)}/versions`, payload)
  },

  deleteResume(resumeId: string) {
    return request.delete<DeleteResumeResponse>(`/resumes/${encodeURIComponent(resumeId)}`)
  },
}
