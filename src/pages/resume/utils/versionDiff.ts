import type { ResumeContent, ResumeDraft } from '@/types/resume'
import { diffWordsWithSpace } from 'diff'

type Project = ResumeContent['projects'][number]
type ComparableResumeField =
  | 'comment'
  | 'skills'
  | 'targetDirection'
  | 'educationLevel'
  | 'school'
  | 'major'
  | 'graduationYear'
  | 'currentStatus'
  | 'jobSearchIdentity'
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
  educationLevel: '学历',
  school: '毕业学校',
  major: '专业',
  graduationYear: '毕业时间',
  currentStatus: '当前状态',
  jobSearchIdentity: '求职身份',
}

const educationLevelLabels: Record<string, string> = {
  college_or_below: '专科及以下',
  bachelor: '本科',
  master: '硕士',
  doctor_or_above: '博士及以上',
}
const currentStatusLabels: Record<string, string> = {
  employed: '在职',
  unemployed: '离职',
  fresh_graduate: '应届',
  studying: '在读',
  interning: '实习中',
}
const jobSearchIdentityLabels: Record<string, string> = {
  campus: '校招',
  experienced: '社招',
  internship: '实习',
}
const languageLevelLabels: Record<string, string> = {
  basic: '基础了解',
  reading_writing: '读写良好',
  daily_communication: '日常交流',
  working_professional: '工作沟通',
  fluent: '流利 / 无障碍沟通',
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

const comparableResumeFields: ComparableResumeField[] = [
  'comment',
  'skills',
  'targetDirection',
  'educationLevel',
  'school',
  'major',
  'graduationYear',
  'currentStatus',
  'jobSearchIdentity',
]
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

function normalizeStructuredValue(value: unknown) {
  return JSON.stringify(value ?? [])
}

function formatPortfolioLinks(value: ResumeDraft['portfolioLinks']) {
  return (value ?? []).map((link) => `${link.label || '作品链接'}：${link.url}`).join('\n')
}

function formatLanguages(value: ResumeDraft['languages']) {
  return (value ?? [])
    .map((language) => `${language.language}：${languageLevelLabels[language.level] ?? language.level}`)
    .join('\n')
}

function formatWorkExperiences(value: ResumeDraft['workExperiences']) {
  return (value ?? [])
    .map((experience) => {
      const meta = [experience.industry, experience.department].filter(Boolean).join(' / ')
      const period = `${experience.period.start || '未填开始'} 至 ${experience.period.end || '未填结束'}`

      return `${experience.companyName}：${experience.jobTitle}｜${period}${meta ? `｜${meta}` : ''}`
    })
    .join('\n')
}

function formatResumeFieldValue(field: ComparableResumeField, value: unknown) {
  if (field === 'educationLevel') return educationLevelLabels[String(value ?? '')] ?? ''
  if (field === 'currentStatus') return currentStatusLabels[String(value ?? '')] ?? ''
  if (field === 'jobSearchIdentity') return jobSearchIdentityLabels[String(value ?? '')] ?? ''

  return String(value ?? '')
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
      before: formatResumeFieldValue(field, before[field]),
      after: formatResumeFieldValue(field, after[field]),
      textSegments: getTextSegments(
        formatResumeFieldValue(field, before[field]),
        formatResumeFieldValue(field, after[field]),
      ),
    })
  }

  if (normalizeStructuredValue(before.portfolioLinks) !== normalizeStructuredValue(after.portfolioLinks)) {
    diff.push({
      field: 'portfolioLinks',
      label: '作品链接',
      before: formatPortfolioLinks(before.portfolioLinks),
      after: formatPortfolioLinks(after.portfolioLinks),
      textSegments: getTextSegments(
        formatPortfolioLinks(before.portfolioLinks),
        formatPortfolioLinks(after.portfolioLinks),
      ),
    })
  }

  if (normalizeStructuredValue(before.languages) !== normalizeStructuredValue(after.languages)) {
    diff.push({
      field: 'languages',
      label: '语言能力',
      before: formatLanguages(before.languages),
      after: formatLanguages(after.languages),
      textSegments: getTextSegments(formatLanguages(before.languages), formatLanguages(after.languages)),
    })
  }

  if (normalizeStructuredValue(before.workExperiences) !== normalizeStructuredValue(after.workExperiences)) {
    diff.push({
      field: 'workExperiences',
      label: '过往工作经历',
      before: formatWorkExperiences(before.workExperiences),
      after: formatWorkExperiences(after.workExperiences),
      textSegments: getTextSegments(
        formatWorkExperiences(before.workExperiences),
        formatWorkExperiences(after.workExperiences),
      ),
    })
  }

  pushProjectDiff(diff, before.projects, after.projects)

  return diff
}
