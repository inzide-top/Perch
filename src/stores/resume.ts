import { defineStore } from 'pinia'
import type {
  CurrentStatus,
  JobSearchIdentity,
  Resume,
  ResumeContent,
  ResumeVersion,
  VersionDiffItem,
} from '@/types/resume'
import { resumeApi, type CreateResumePayload, type SaveResumeVersionResponse } from '@/services/resumes'

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
  const { title: _title, ...contentWithoutTitle } = content as ResumeContent & { title?: string }
  const address = content.address as string[] | string | undefined
  const jobSearchIdentity = normalizeJobSearchIdentity(contentWithoutTitle.jobSearchIdentity)

  return {
    ...contentWithoutTitle,
    targetDirection: contentWithoutTitle.targetDirection ?? '',
    address: Array.isArray(address) ? address : address ? [address] : [],
    jobSearchIdentity,
    currentStatus: normalizeCurrentStatus(jobSearchIdentity, contentWithoutTitle.currentStatus),
    workExperiences: (contentWithoutTitle.workExperiences ?? []).map((experience) => ({
      ...experience,
      id: experience.id || crypto.randomUUID(),
      period: {
        start: experience.period?.start ?? '',
        end: experience.period?.end ?? '',
      },
    })),
    projects: contentWithoutTitle.projects.map((project) => ({
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
  isLoading: boolean
  loadError: string | null
}

type ResumeSelectionState = Pick<ResumeState, 'resumes' | 'versions' | 'currentResumeId' | 'currentVersionId'>

type SaveNewVersionPayload = {
  resumeId: string
  title: string
  content: ResumeContent
  changeNote?: string
}

type LegacyResume = Resume & {
  targetDirection?: string
}

type LegacyResumeVersion = Omit<ResumeVersion, 'content' | 'updatedAt' | 'diffSummary'> & {
  targetDirection?: string
  updatedAt?: string
  diffSummary?: VersionDiffItem[]
  content: ResumeContent & {
    title?: string
    targetDirection?: string
  }
}

function normalizeResumes(resumes: LegacyResume[]): Resume[] {
  return resumes.map((resume) => ({
    id: resume.id,
    title: resume.title,
    currentVersionId: resume.currentVersionId,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  }))
}

function normalizeVersions(versions: LegacyResumeVersion[], resumes: LegacyResume[]) {
  return versions.map((version) => {
    const resume = resumes.find((item) => item.id === version.resumeId)
    const targetDirection = version.content.targetDirection ?? version.targetDirection ?? resume?.targetDirection ?? ''

    return {
      id: version.id,
      resumeId: version.resumeId,
      versionNumber: version.versionNumber,
      parentVersionId: version.parentVersionId,
      content: cloneResumeContent({
        ...version.content,
        targetDirection,
      }),
      diffSummary: version.diffSummary ?? [],
      changeNote: version.changeNote,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt ?? version.createdAt,
    }
  })
}

function resolveCurrentIds(state: ResumeSelectionState) {
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
    isLoading: false,
    loadError: null,
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
    async loadFromApi() {
      this.isLoading = true
      this.loadError = null

      try {
        const { resumes, versions } = await resumeApi.getResumeWorkspace()

        const currentIds = resolveCurrentIds({
          resumes,
          versions,
          currentResumeId: this.currentResumeId,
          currentVersionId: this.currentVersionId,
        })

        this.resumes = resumes
        this.versions = versions
        this.currentResumeId = currentIds.currentResumeId
        this.currentVersionId = currentIds.currentVersionId
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : 'load resume failed'
      } finally {
        this.isLoading = false
      }
    },
    hydrateFromStorage() {
      if (!canUseLocalStorage()) return

      const storedState = localStorage.getItem(resumeStoreStorageKey)
      if (!storedState) return

      try {
        const parsedState = JSON.parse(storedState) as ResumeState
        const storedResumes = Array.isArray(parsedState.resumes) ? (parsedState.resumes as LegacyResume[]) : []
        const resumes = normalizeResumes(storedResumes)
        const versions = Array.isArray(parsedState.versions)
          ? normalizeVersions(parsedState.versions as LegacyResumeVersion[], storedResumes)
          : []
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

    async createResume(payload: CreateResumePayload) {
      const result = await resumeApi.createResume({
        title: payload.title,
        content: cloneResumeContent(payload.content),
      })

      this.resumes.push(result.resume)
      this.versions.push(...result.versions)
      this.currentResumeId = result.resume.id
      this.currentVersionId = result.currentVersion.id

      return result.resume
    },

    async saveNewVersion(payload: SaveNewVersionPayload) {
      const resume = this.resumes.find((item) => item.id === payload.resumeId)
      if (!resume) return null

      const result = await resumeApi.saveResumeVersion(resume.id, {
        title: payload.title,
        content: cloneResumeContent(payload.content),
        changeNote: payload.changeNote ?? 'update resume',
      })

      this.upsertResumeSaveResult(result)

      return result
    },

    upsertResumeSaveResult(result: SaveResumeVersionResponse) {
      const resumeIndex = this.resumes.findIndex((item) => item.id === result.resume.id)
      if (resumeIndex === -1) {
        this.resumes.push(result.resume)
      } else {
        this.resumes.splice(resumeIndex, 1, result.resume)
      }

      const versionIndex = this.versions.findIndex((item) => item.id === result.version.id)
      if (versionIndex === -1) {
        this.versions.push(result.version)
      } else {
        this.versions.splice(versionIndex, 1, result.version)
      }

      this.currentResumeId = result.resume.id
      this.currentVersionId = result.version.id
    },

    async deleteResume(resumeId: string) {
      const result = await resumeApi.deleteResume(resumeId)
      const isDeletingCurrentResume = this.currentResumeId === result.deletedResumeId

      this.resumes = this.resumes.filter((resume) => resume.id !== result.deletedResumeId)
      this.versions = this.versions.filter((version) => version.resumeId !== result.deletedResumeId)

      if (isDeletingCurrentResume) {
        const nextResume = this.resumes[0] ?? null
        this.currentResumeId = nextResume?.id ?? null
        this.currentVersionId = nextResume?.currentVersionId ?? null
      }

      return result
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
