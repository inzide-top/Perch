import { isDeepStrictEqual } from 'node:util'
import type { ResumeContent, ResumeDraft, ResumeVersion, VersionDiffItem } from '@/types/resume'
import { resumeRepository, type ResumeRecord } from '../repositories/resume.repository'
import { getVersionDiff } from '../../../src/shared/resume/versionDiff'
import { createResumeInputSchema, saveResumeVersionInputSchema } from '../schemas/resume.schema'
import { interviewRepository } from '../repositories/interview.repository'
import { getCurrentUserId } from '../context/current-user'

export type CreateResumeResult = {
  resume: ResumeRecord
  currentVersion: ResumeVersion
  versions: ResumeVersion[]
}

export type SaveResumeVersionResult =
  | {
      type: 'created_new_version'
      resume: ResumeRecord
      version: ResumeVersion
      diffSummary: VersionDiffItem[]
    }
  | {
      type: 'updated_current_version'
      resume: ResumeRecord
      version: ResumeVersion
      diffSummary: []
    }
  | {
      type: 'no_change'
      resume: ResumeRecord
      version: ResumeVersion
      diffSummary: []
    }

export type DeleteResumeResult = {
  deletedResumeId: string
}

export class ResumeNotFoundError extends Error {
  constructor(resumeId: string) {
    super(`Resume ${resumeId} not found`)
    this.name = 'ResumeNotFoundError'
  }
}

class ResumeInterviewHistoryConflictError extends Error {
  statusCode = 409

  constructor() {
    super('该简历存在模拟面试历史，当前不能直接删除')
    this.name = 'ResumeInterviewHistoryConflictError'
  }
}

async function getResumeForCurrentUser(resumeId: string): Promise<ResumeRecord> {
  const [userId, resume] = await Promise.all([getCurrentUserId(), resumeRepository.findResumeById(resumeId)])

  if (!resume || resume.userId !== userId) {
    throw new ResumeNotFoundError(resumeId)
  }

  return resume
}

export async function createResumeWithInitialVersion(input: unknown): Promise<CreateResumeResult> {
  const parsedInput = createResumeInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const now = new Date().toISOString()
  const resumeId = crypto.randomUUID()
  const versionId = crypto.randomUUID()

  const resume: ResumeRecord = {
    id: resumeId,
    userId,
    title: parsedInput.title,
    currentVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  }

  const currentVersion: ResumeVersion = {
    id: versionId,
    resumeId,
    versionNumber: 1,
    parentVersionId: null,
    content: parsedInput.content,
    diffSummary: [],
    changeNote: 'create resume',
    createdAt: now,
    updatedAt: now,
  }

  await resumeRepository.createResumeWithInitialVersion({
    resume,
    version: currentVersion,
  })

  return {
    resume,
    currentVersion,
    versions: [currentVersion],
  }
}

function buildDraft(title: string, content: ResumeContent): ResumeDraft {
  return {
    title,
    ...content,
  }
}

export async function saveNewResumeVersion(resumeId: string, input: unknown): Promise<SaveResumeVersionResult> {
  const parsedInput = saveResumeVersionInputSchema.parse(input)
  const resume = await getResumeForCurrentUser(resumeId)

  const currentVersion = await resumeRepository.findVersionById(resume.currentVersionId)

  if (!currentVersion) {
    throw new Error(`Current version ${resume.currentVersionId} not found`)
  }

  const now = new Date().toISOString()

  const beforeDraft = buildDraft(resume.title, currentVersion.content)
  const afterDraft = buildDraft(parsedInput.title, parsedInput.content)

  const isRawContentSame = isDeepStrictEqual(currentVersion.content, parsedInput.content)
  const isTitleSame = resume.title === parsedInput.title

  const diffSummary = getVersionDiff(beforeDraft, afterDraft)

  if (isRawContentSame && isTitleSame) {
    return {
      type: 'no_change',
      resume,
      version: currentVersion,
      diffSummary: [],
    }
  }

  const updatedResume: ResumeRecord = {
    ...resume,
    title: parsedInput.title,
    updatedAt: now,
  }

  if (diffSummary.length === 0) {
    const updatedCurrentVersion: ResumeVersion = isRawContentSame
      ? currentVersion
      : {
          ...currentVersion,
          content: parsedInput.content,
          updatedAt: now,
        }

    await resumeRepository.updateCurrentVersion({
      resume: updatedResume,
      version: updatedCurrentVersion,
    })

    return {
      type: 'updated_current_version',
      resume: updatedResume,
      version: updatedCurrentVersion,
      diffSummary: [],
    }
  }

  const newVersion: ResumeVersion = {
    id: crypto.randomUUID(),
    resumeId,
    versionNumber: currentVersion.versionNumber + 1,
    parentVersionId: currentVersion.id,
    content: parsedInput.content,
    diffSummary,
    changeNote: parsedInput.changeNote ?? '更新简历',
    createdAt: now,
    updatedAt: now,
  }

  const resumeWithNewCurrentVersion: ResumeRecord = {
    ...updatedResume,
    currentVersionId: newVersion.id,
  }

  await resumeRepository.createNewVersionAndSetCurrent({
    resume: resumeWithNewCurrentVersion,
    version: newVersion,
  })
  return {
    type: 'created_new_version',
    resume: resumeWithNewCurrentVersion,
    version: newVersion,
    diffSummary,
  }
}

export async function getResumes() {
  const userId = await getCurrentUserId()

  return resumeRepository.findResumesByUserId(userId)
}

export async function getResumeWorkspace() {
  const userId = await getCurrentUserId()

  return resumeRepository.findResumeWorkspaceByUserId(userId)
}

export async function getResumeById(resumeId: string) {
  return getResumeForCurrentUser(resumeId)
}

export async function getResumeVersions(resumeId: string) {
  await getResumeForCurrentUser(resumeId)

  return resumeRepository.findVersionsByResumeId(resumeId)
}

export async function deleteResume(resumeId: string): Promise<DeleteResumeResult> {
  await getResumeForCurrentUser(resumeId)
  if (await interviewRepository.hasSessionsByResumeId(resumeId)) {
    throw new ResumeInterviewHistoryConflictError()
  }
  await resumeRepository.deleteResumeByResumeId(resumeId)

  return { deletedResumeId: resumeId }
}
