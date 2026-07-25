export type Resume = {
  id: string
  title: string
  targetDirection: string
  currentVersionId: string
  createdAt: string
  updatedAt: string
}

export type ResumeVersion = {
  id: string
  resumeId: string
  versionNumber: number
  parentVersionId: string | null
  targetDirection: string
  content: ResumeContent
  changeNote: string
  createdAt: string
}

export type ResumeContent = {
  name: string
  address?: string
  comment?: string
  skills: string
  projects: {
    id: string
    name: string
    role: string
    techStack: string
    description: string
    content: string
    outcomes?: string
  }[]
}

export type ResumeDraft = ResumeContent & {
  title: string
  targetDirection: string
}
