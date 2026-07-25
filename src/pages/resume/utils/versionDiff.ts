import type { ResumeContent, ResumeDraft } from '@/types/resume'
import { diffWordsWithSpace } from 'diff'

type Project = ResumeContent['projects'][number]
type ComparableResumeField = 'comment' | 'skills' | 'targetDirection'
type ComparableProjectField = keyof Project

export type TextDiffSegment = {
  value: string
  added?: boolean
  removed?: boolean
}

export type VersionDiffItem = {
  field: string
  label: string
  before: unknown
  after: unknown
  textSegments?: TextDiffSegment[]
}

const resumeFieldLabels: Record<ComparableResumeField, string> = {
  comment: '自我评价',
  skills: '专业技能',
  targetDirection: '目标岗位',
}

const projectFieldLabels: Record<ComparableProjectField, string> = {
  id: '项目 ID',
  name: '项目名称',
  role: '角色',
  techStack: '技术栈',
  description: '项目介绍',
  content: '工作内容',
  outcomes: '项目成果',
}

const comparableResumeFields: ComparableResumeField[] = ['comment', 'skills', 'targetDirection']
const comparableProjectFields: ComparableProjectField[] = [
  'name',
  'role',
  'techStack',
  'description',
  'content',
  'outcomes',
]

function getTextSegments(before: unknown, after: unknown): TextDiffSegment[] {
  return diffWordsWithSpace(String(before ?? ''), String(after ?? '')).map((part) => ({
    value: part.value,
    added: part.added,
    removed: part.removed,
  }))
}

function normalizeValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function isSameValue(before: unknown, after: unknown) {
  return normalizeValue(before) === normalizeValue(after)
}

function getProjectIdentity(project: Project) {
  return project.id || normalizeValue(project.name)
}

function getProjectDisplayName(project: Project | undefined, fallbackIndex: number) {
  return project?.name?.trim() || `未命名项目 ${fallbackIndex + 1}`
}

function createProjectMatchKey(project: Project, index: number, usedKeys: Set<string>) {
  const nameKey = getProjectIdentity(project)

  if (nameKey && !usedKeys.has(nameKey)) {
    usedKeys.add(nameKey)
    return nameKey
  }

  const fallbackKey = `__index_${index}`
  usedKeys.add(fallbackKey)
  return fallbackKey
}

function createProjectMap(projects: Project[]) {
  const usedKeys = new Set<string>()

  return new Map(
    projects.map((project, index) => [createProjectMatchKey(project, index, usedKeys), { project, index }] as const),
  )
}

function pushProjectFieldDiff(diff: VersionDiffItem[], beforeProject: Project, afterProject: Project, index: number) {
  for (const field of comparableProjectFields) {
    if (isSameValue(beforeProject[field], afterProject[field])) continue

    const projectLabel = getProjectDisplayName(afterProject, index)

    diff.push({
      field: `projects.${index}.${field}`,
      label: `${projectLabel} - ${projectFieldLabels[field]}`,
      before: beforeProject[field] ?? '',
      after: afterProject[field] ?? '',
      textSegments: getTextSegments(beforeProject[field], afterProject[field]),
    })
  }
}

function pushProjectDiff(diff: VersionDiffItem[], before: Project[], after: Project[]) {
  const beforeProjectMap = createProjectMap(before)
  const matchedBeforeKeys = new Set<string>()

  after.forEach((afterProject, afterIndex) => {
    const nameKey = getProjectIdentity(afterProject)
    const fallbackKey = `__index_${afterIndex}`
    const matchedEntry = beforeProjectMap.get(nameKey) ?? beforeProjectMap.get(fallbackKey)

    if (!matchedEntry) {
      diff.push({
        field: `projects.${afterIndex}`,
        label: `${getProjectDisplayName(afterProject, afterIndex)} - 新增项目`,
        before: null,
        after: afterProject,
      })
      return
    }

    matchedBeforeKeys.add(beforeProjectMap.get(nameKey) ? nameKey : fallbackKey)
    pushProjectFieldDiff(diff, matchedEntry.project, afterProject, afterIndex)
  })

  beforeProjectMap.forEach(({ project, index }, key) => {
    if (matchedBeforeKeys.has(key)) return

    diff.push({
      field: `projects.${index}`,
      label: `${getProjectDisplayName(project, index)} - 删除项目`,
      before: project,
      after: null,
    })
  })
}

export function getVersionDiff(before: ResumeDraft, after: ResumeDraft) {
  const diff: VersionDiffItem[] = []

  for (const field of comparableResumeFields) {
    if (isSameValue(before[field], after[field])) continue

    diff.push({
      field,
      label: resumeFieldLabels[field],
      before: before[field] ?? '',
      after: after[field] ?? '',
      textSegments: getTextSegments(before[field], after[field]),
    })
  }

  pushProjectDiff(diff, before.projects, after.projects)

  return diff
}
