import { defineStore } from 'pinia'
import type { CurrentStatus, JobSearchIdentity, Resume, ResumeContent, ResumeVersion } from '@/types/resume'

const resumeStoreStorageKey = 'agent-seek-employment:resume-store'

const currentStatusOptionsByIdentity: Record<JobSearchIdentity, CurrentStatus[]> = {
  experienced: ['employed', 'unemployed'],
  campus: ['fresh_graduate', 'studying', 'interning'],
  internship: ['studying', 'interning', 'fresh_graduate'],
}

function normalizeJobSearchIdentity(value: ResumeContent['jobSearchIdentity']): JobSearchIdentity {
  if (value === 'campus' || value === 'internship' || value === 'experienced') return value

  return 'experienced'
}

function normalizeCurrentStatus(identity: JobSearchIdentity, value: ResumeContent['currentStatus']): CurrentStatus {
  const availableStatuses = currentStatusOptionsByIdentity[identity]

  if (value && availableStatuses.includes(value)) return value

  return availableStatuses[0]
}

function cloneResumeContent(content: ResumeContent): ResumeContent {
  const address = content.address as string[] | string | undefined
  const jobSearchIdentity = normalizeJobSearchIdentity(content.jobSearchIdentity)

  return {
    ...content,
    address: Array.isArray(address) ? address : address ? [address] : [],
    jobSearchIdentity,
    currentStatus: normalizeCurrentStatus(jobSearchIdentity, content.currentStatus),
    workExperiences: (content.workExperiences ?? []).map((experience) => ({
      ...experience,
      id: experience.id || crypto.randomUUID(),
      period: {
        start: experience.period?.start ?? '',
        end: experience.period?.end ?? '',
      },
    })),
    projects: content.projects.map((project) => ({
      ...project,
      id: project.id || crypto.randomUUID(),
    })),
  }
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

type ResumeState = {
  resumes: Resume[]
  versions: ResumeVersion[]
  currentResumeId: string | null
  currentVersionId: string | null
}

type CreateResumePayload = {
  title: string
  targetDirection: string
  content: ResumeContent
}

type SaveNewVersionPayload = CreateResumePayload & {
  resumeId: string
  changeNote?: string
}

type UpdateVersionPayload = SaveNewVersionPayload & {
  versionId: string
}

function normalizeVersions(versions: ResumeVersion[], resumes: Resume[]) {
  return versions.map((version) => {
    const resume = resumes.find((item) => item.id === version.resumeId)

    return {
      ...version,
      targetDirection: version.targetDirection ?? resume?.targetDirection ?? '',
      content: cloneResumeContent(version.content),
    }
  })
}

function resolveCurrentIds(state: ResumeState) {
  const currentResume = state.resumes.find((resume) => resume.id === state.currentResumeId) ?? state.resumes[0] ?? null
  const currentVersion =
    state.versions.find((version) => version.id === state.currentVersionId && version.resumeId === currentResume?.id) ??
    state.versions.find((version) => version.id === currentResume?.currentVersionId) ??
    null

  return {
    currentResumeId: currentResume?.id ?? null,
    currentVersionId: currentVersion?.id ?? currentResume?.currentVersionId ?? null,
  }
}

export const useResumeStore = defineStore('resume', {
  state: (): ResumeState => ({
    resumes: [],
    versions: [],
    currentResumeId: null,
    currentVersionId: null,
  }),

  getters: {
    currentResume: (state) => {
      return state.resumes.find((resume) => resume.id === state.currentResumeId) ?? null
    },

    currentVersion: (state) => {
      return state.versions.find((version) => version.id === state.currentVersionId) ?? null
    },

    currentResumeVersions: (state) => {
      if (!state.currentResumeId) return []

      return state.versions
        .filter((version) => version.resumeId === state.currentResumeId)
        .sort((current, next) => next.versionNumber - current.versionNumber)
    },
  },

  actions: {
    hydrateFromStorage() {
      if (!canUseLocalStorage()) return

      const storedState = localStorage.getItem(resumeStoreStorageKey)
      if (!storedState) return

      try {
        const parsedState = JSON.parse(storedState) as ResumeState
        const resumes = Array.isArray(parsedState.resumes) ? parsedState.resumes : []
        const versions = Array.isArray(parsedState.versions) ? normalizeVersions(parsedState.versions, resumes) : []
        const currentIds = resolveCurrentIds({
          resumes,
          versions,
          currentResumeId: parsedState.currentResumeId ?? null,
          currentVersionId: parsedState.currentVersionId ?? null,
        })

        this.resumes = resumes
        this.versions = versions
        this.currentResumeId = currentIds.currentResumeId
        this.currentVersionId = currentIds.currentVersionId
      } catch {
        localStorage.removeItem(resumeStoreStorageKey)
      }
    },

    persistToStorage() {
      if (!canUseLocalStorage()) return

      localStorage.setItem(
        resumeStoreStorageKey,
        JSON.stringify({
          resumes: this.resumes,
          versions: this.versions,
          currentResumeId: this.currentResumeId,
          currentVersionId: this.currentVersionId,
        }),
      )
    },

    createResume(payload: CreateResumePayload) {
      const now = new Date().toISOString()
      const resumeId = crypto.randomUUID()
      const versionId = crypto.randomUUID()

      const { title, targetDirection, content } = payload
      const resumeInfo = {
        title,
        targetDirection,
        id: resumeId,
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      }

      const versionInfo = {
        id: versionId,
        resumeId,
        versionNumber: 1,
        parentVersionId: null,
        targetDirection,
        content: cloneResumeContent(content),
        changeNote: 'create resume',
        createdAt: now,
      }

      this.resumes.push(resumeInfo)
      this.versions.push(versionInfo)
      this.currentResumeId = resumeId
      this.currentVersionId = versionId
      this.persistToStorage()

      return resumeInfo
    },

    saveNewVersion(payload: SaveNewVersionPayload) {
      const resume = this.resumes.find((item) => item.id === payload.resumeId)
      if (!resume) return null

      const now = new Date().toISOString()
      const versionId = crypto.randomUUID()
      const parentVersion = this.versions.find((version) => version.id === resume.currentVersionId)
      const latestVersionNumber = Math.max(
        0,
        ...this.versions
          .filter((version) => version.resumeId === payload.resumeId)
          .map((version) => version.versionNumber),
      )

      if (parentVersion && !parentVersion.targetDirection) {
        parentVersion.targetDirection = resume.targetDirection
      }

      const versionInfo = {
        id: versionId,
        resumeId: payload.resumeId,
        versionNumber: latestVersionNumber + 1,
        parentVersionId: resume.currentVersionId,
        targetDirection: payload.targetDirection,
        content: cloneResumeContent(payload.content),
        changeNote: payload.changeNote ?? 'update resume',
        createdAt: now,
      }

      resume.title = payload.title
      resume.targetDirection = payload.targetDirection
      resume.currentVersionId = versionId
      resume.updatedAt = now

      this.versions.push(versionInfo)
      this.currentResumeId = resume.id
      this.currentVersionId = versionId
      this.persistToStorage()

      return versionInfo
    },

    updateVersion(payload: UpdateVersionPayload) {
      const resume = this.resumes.find((item) => item.id === payload.resumeId)
      const version = this.versions.find((item) => item.id === payload.versionId && item.resumeId === payload.resumeId)
      if (!resume || !version) return null

      resume.title = payload.title
      resume.targetDirection = payload.targetDirection
      resume.updatedAt = new Date().toISOString()

      version.targetDirection = payload.targetDirection
      version.content = cloneResumeContent(payload.content)
      version.changeNote = payload.changeNote ?? version.changeNote

      this.currentResumeId = resume.id
      this.currentVersionId = version.id
      this.persistToStorage()

      return version
    },

    deleteResume(resumeId: string) {
      this.resumes = this.resumes.filter((resume) => resume.id !== resumeId)
      this.versions = this.versions.filter((version) => version.resumeId !== resumeId)

      if (this.currentResumeId !== resumeId) {
        this.persistToStorage()
        return
      }

      const nextResume = this.resumes[0]
      this.currentResumeId = nextResume?.id ?? null
      this.currentVersionId = nextResume?.currentVersionId ?? null
      this.persistToStorage()
    },

    selectResume(resumeId: string) {
      const resume = this.resumes.find((item) => item.id === resumeId)
      if (!resume) return

      this.currentResumeId = resume.id
      this.currentVersionId = resume.currentVersionId
      this.persistToStorage()
    },

    selectVersion(versionId: string) {
      const version = this.versions.find((item) => item.id === versionId)
      if (!version) return

      this.currentVersionId = version.id
      this.currentResumeId = version.resumeId
      this.persistToStorage()
    },
  },
})
