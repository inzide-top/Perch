<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { CurrentStatus, JobSearchIdentity, ResumeDraft } from '@/types/resume'
import BasicInfoSection from './components/BasicInfoSection.vue'
import ProjectSection from './components/ProjectSection.vue'
import type {
  CurrentStatusOption,
  EducationLevelOption,
  JobSearchIdentityOption,
  LanguageAbility,
  LanguageLevelOption,
  Project,
  ProjectErrors,
  ProjectForm,
  ProjectRequiredField,
  ResumeErrors,
  ResumeFormState,
  ResumeRequiredField,
  WorkExperience,
} from './types'

type EditorMode = 'create' | 'edit'

const educationLevelOptions: EducationLevelOption[] = [
  { label: '专科及以下', value: 'college_or_below' },
  { label: '本科', value: 'bachelor' },
  { label: '硕士', value: 'master' },
  { label: '博士及以上', value: 'doctor_or_above' },
]
const currentStatusOptions: CurrentStatusOption[] = [
  { label: '在职', value: 'employed' },
  { label: '离职', value: 'unemployed' },
  { label: '应届', value: 'fresh_graduate' },
  { label: '在读', value: 'studying' },
  { label: '实习中', value: 'interning' },
]
const currentStatusOptionsByIdentity: Record<JobSearchIdentity, CurrentStatus[]> = {
  experienced: ['employed', 'unemployed'],
  campus: ['fresh_graduate', 'studying', 'interning'],
  internship: ['studying', 'interning', 'fresh_graduate'],
}
const jobSearchIdentityOptions: JobSearchIdentityOption[] = [
  { label: '校招', value: 'campus' },
  { label: '社招', value: 'experienced' },
  { label: '实习', value: 'internship' },
]
const languageLevelOptions: LanguageLevelOption[] = [
  { label: '基础了解', value: 'basic' },
  { label: '读写良好', value: 'reading_writing' },
  { label: '日常交流', value: 'daily_communication' },
  { label: '工作沟通', value: 'working_professional' },
  { label: '流利 / 无障碍沟通', value: 'fluent' },
]

const props = defineProps<{
  mode: EditorMode
  initialDraft: ResumeDraft | null
  mockDraft: ResumeDraft
  isSaving: boolean
}>()

const emit = defineEmits<{
  cancel: []
  save: [draft: ResumeDraft]
  dirtyChange: [dirty: boolean]
  mockImported: []
  unchangedSave: []
}>()

const projects = ref<Project[]>([])
const workExperiences = ref<WorkExperience[]>([])
const portfolioLinksText = ref('')
const languages = ref<LanguageAbility[]>([])
const expandedProjectIndexes = ref<Set<number>>(new Set())
const initialEditorSnapshot = ref('')
const initialSavedDraft = ref<ResumeDraft | null>(null)
const isResettingDraft = ref(false)
const isProjectDraftConfirmOpen = ref(false)
const projectDraftConfirmIntent = ref<'save' | 'cancel' | null>(null)
const editingProjectIndex = ref<number | null>(null)
const pendingDeleteProjectIndex = ref<number | null>(null)
const originalBodyOverflow = ref('')
const isProjectCreateOpen = ref(false)
const isProjectEditOpen = computed(() => editingProjectIndex.value !== null)
const isProjectDrawerOpen = computed(() => isProjectCreateOpen.value || isProjectEditOpen.value)

const resumeErrors = reactive<ResumeErrors>({
  title: '',
  targetDirection: '',
  name: '',
  jobSearchIdentity: '',
  skills: '',
})

const projectErrors = reactive<ProjectErrors>({
  name: '',
  description: '',
  content: '',
})
const projectEditErrors = reactive<ProjectErrors>({
  name: '',
  description: '',
  content: '',
})

const form = reactive<ResumeFormState>({
  title: '',
  targetDirection: '',
  name: '',
  address: [] as string[],
  educationLevel: 'bachelor',
  school: '',
  major: '',
  graduationYear: '',
  currentStatus: 'employed',
  jobSearchIdentity: 'experienced',
  comment: '',
  skills: '',
})

const filteredCurrentStatusOptions = computed(() => {
  const availableStatuses = new Set(currentStatusOptionsByIdentity[form.jobSearchIdentity])

  return currentStatusOptions.filter((option) => availableStatuses.has(option.value))
})

const projectForm = reactive<ProjectForm>({
  name: '',
  role: '',
  techStack: '',
  description: '',
  content: '',
  outcomes: '',
})

const projectEditForm = reactive<ProjectForm>({
  name: '',
  role: '',
  techStack: '',
  description: '',
  content: '',
  outcomes: '',
})

const editorTitle = computed(() => (props.mode === 'edit' ? '编辑简历' : '新建简历'))
const hasPendingProjectDraft = computed(() => {
  return Object.values(projectForm).some((value) => value.trim())
})

function cloneProjects(sourceProjects: Project[]) {
  return sourceProjects.map((project) => ({
    ...project,
    id: project.id || crypto.randomUUID(),
  }))
}

function clonePortfolioLinks(sourceLinks: ResumeDraft['portfolioLinks']) {
  return (sourceLinks ?? []).map((link) => ({
    ...link,
    id: link.id || crypto.randomUUID(),
  }))
}

function cloneWorkExperiences(sourceExperiences: ResumeDraft['workExperiences']) {
  return (sourceExperiences ?? []).map((experience) => ({
    ...experience,
    id: experience.id || crypto.randomUUID(),
    period: {
      start: experience.period?.start ?? '',
      end: experience.period?.end ?? '',
    },
  }))
}

function stringifyPortfolioLinks(sourceLinks: ResumeDraft['portfolioLinks']) {
  return clonePortfolioLinks(sourceLinks)
    .map((link) => link.url.trim())
    .filter(Boolean)
    .join('\n')
}

function inferPortfolioLinkLabel(url: string) {
  const lowerUrl = url.toLowerCase()

  if (lowerUrl.includes('github.com')) return 'GitHub'
  if (lowerUrl.includes('juejin.cn')) return '掘金'
  if (lowerUrl.includes('csdn.net')) return 'CSDN'
  if (lowerUrl.includes('zhihu.com')) return '知乎'
  if (lowerUrl.includes('vercel.app') || lowerUrl.includes('netlify.app')) return 'Demo'

  return '作品链接'
}

function createStableId(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return `portfolio-${Math.abs(hash)}`
}

function parsePortfolioLinks(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\n|,|，/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ).map((url) => ({
    id: createStableId(url),
    label: inferPortfolioLinkLabel(url),
    url,
  }))
}

function cloneLanguages(sourceLanguages: ResumeDraft['languages']) {
  return (sourceLanguages ?? []).map((language) => ({
    ...language,
    id: language.id || crypto.randomUUID(),
  }))
}

function createEditorSnapshot() {
  return JSON.stringify({
    form: { ...form },
    projects: cloneProjects(projects.value),
    workExperiences: cloneWorkExperiences(workExperiences.value),
    portfolioLinksText: portfolioLinksText.value,
    languages: cloneLanguages(languages.value),
    projectForm: { ...projectForm },
  })
}

function resetErrors() {
  resumeErrors.title = ''
  resumeErrors.targetDirection = ''
  resumeErrors.name = ''
  resumeErrors.jobSearchIdentity = ''
  resumeErrors.skills = ''
  projectErrors.name = ''
  projectErrors.description = ''
  projectErrors.content = ''
  projectEditErrors.name = ''
  projectEditErrors.description = ''
  projectEditErrors.content = ''
}

function resetProjectForm() {
  Object.assign(projectForm, { name: '', role: '', techStack: '', description: '', content: '', outcomes: '' })
}

function resetProjectEditForm() {
  Object.assign(projectEditForm, { name: '', role: '', techStack: '', description: '', content: '', outcomes: '' })
}

function normalizeCityList(value: ResumeDraft['address'] | string) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function fillDraft(draft: ResumeDraft | null) {
  isResettingDraft.value = true
  resetErrors()

  Object.assign(form, {
    title: draft?.title ?? '',
    targetDirection: draft?.targetDirection ?? '',
    name: draft?.name ?? '',
    address: normalizeCityList(draft?.address),
    educationLevel: draft?.educationLevel ?? 'bachelor',
    school: draft?.school ?? '',
    major: draft?.major ?? '',
    graduationYear: draft?.graduationYear ?? '',
    currentStatus: draft?.currentStatus ?? 'employed',
    jobSearchIdentity: draft?.jobSearchIdentity ?? 'experienced',
    comment: draft?.comment ?? '',
    skills: draft?.skills ?? '',
  })
  syncCurrentStatusWithIdentity()

  projects.value = draft ? cloneProjects(draft.projects) : []
  workExperiences.value = draft ? cloneWorkExperiences(draft.workExperiences) : []
  portfolioLinksText.value = stringifyPortfolioLinks(draft?.portfolioLinks)
  languages.value = cloneLanguages(draft?.languages)
  expandedProjectIndexes.value = new Set()
  resetProjectForm()
  initialEditorSnapshot.value = createEditorSnapshot()
  initialSavedDraft.value = draft ? buildDraft() : null
  emit('dirtyChange', false)

  void nextTick(() => {
    isResettingDraft.value = false
  })
}

function buildDraft(): ResumeDraft {
  return {
    title: form.title.trim(),
    targetDirection: form.targetDirection.trim(),
    name: form.name.trim(),
    address: [...form.address],
    educationLevel: form.educationLevel,
    school: form.school.trim(),
    major: form.major.trim(),
    graduationYear: form.graduationYear.trim(),
    currentStatus: form.currentStatus,
    jobSearchIdentity: form.jobSearchIdentity,
    portfolioLinks: parsePortfolioLinks(portfolioLinksText.value),
    languages: languages.value.map((language) => ({
      id: language.id,
      language: language.language.trim(),
      level: language.level,
    })),
    workExperiences: workExperiences.value.map((experience) => ({
      id: experience.id,
      companyName: experience.companyName.trim(),
      industry: experience.industry?.trim() ?? '',
      department: experience.department?.trim() ?? '',
      jobTitle: experience.jobTitle.trim(),
      period: {
        start: experience.period.start,
        end: experience.period.end,
      },
    })),
    comment: form.comment.trim(),
    skills: form.skills.trim(),
    projects: projects.value.map((project) => ({
      id: project.id,
      name: project.name.trim(),
      role: project.role.trim(),
      techStack: project.techStack.trim(),
      description: project.description.trim(),
      content: project.content.trim(),
      outcomes: project.outcomes?.trim(),
    })),
  }
}

function importMockResumeDraft() {
  fillDraft(props.mockDraft)
  expandedProjectIndexes.value = new Set(props.mockDraft.projects.map((_, index) => index))
  initialEditorSnapshot.value = props.initialDraft ? createEditorSnapshot() : ''
  initialSavedDraft.value = props.initialDraft ? props.initialDraft : null
  emit('dirtyChange', createEditorSnapshot() !== initialEditorSnapshot.value)
  emit('mockImported')
}

function validateResumeForm() {
  resumeErrors.title = form.title.trim() ? '' : '请填写简历名称'
  resumeErrors.targetDirection = form.targetDirection.trim() ? '' : '请填写目标岗位'
  resumeErrors.name = form.name.trim() ? '' : '请填写姓名'
  resumeErrors.jobSearchIdentity = form.jobSearchIdentity ? '' : '请选择求职身份'
  resumeErrors.skills = form.skills.trim() ? '' : '请填写专业技能'

  return !Object.values(resumeErrors).some(Boolean)
}

function validateProjectForm() {
  projectErrors.name = projectForm.name.trim() ? '' : '请填写项目名称'
  projectErrors.description = projectForm.description.trim() ? '' : '请填写项目介绍'
  projectErrors.content = projectForm.content.trim() ? '' : '请填写工作内容'

  return !Object.values(projectErrors).some(Boolean)
}

function validateProjectEditForm() {
  projectEditErrors.name = projectEditForm.name.trim() ? '' : '请填写项目名称'
  projectEditErrors.description = projectEditForm.description.trim() ? '' : '请填写项目介绍'
  projectEditErrors.content = projectEditForm.content.trim() ? '' : '请填写工作内容'

  return !Object.values(projectEditErrors).some(Boolean)
}

function addProject() {
  if (!validateProjectForm()) return

  projects.value.push({ id: crypto.randomUUID(), ...projectForm })
  closeProjectCreate()
}

function openProjectCreate() {
  pendingDeleteProjectIndex.value = null
  resetProjectForm()
  projectErrors.name = ''
  projectErrors.description = ''
  projectErrors.content = ''
  isProjectCreateOpen.value = true
}

function closeProjectCreate() {
  isProjectCreateOpen.value = false
  resetProjectForm()
  projectErrors.name = ''
  projectErrors.description = ''
  projectErrors.content = ''
}

function toggleProject(index: number) {
  const nextIndexes = new Set(expandedProjectIndexes.value)

  if (nextIndexes.has(index)) {
    nextIndexes.delete(index)
  } else {
    nextIndexes.add(index)
  }

  expandedProjectIndexes.value = nextIndexes
}

function removeProject(index: number) {
  projects.value.splice(index, 1)

  expandedProjectIndexes.value = new Set(
    [...expandedProjectIndexes.value]
      .filter((expandedIndex) => expandedIndex !== index)
      .map((expandedIndex) => (expandedIndex > index ? expandedIndex - 1 : expandedIndex)),
  )
}

function requestRemoveProject(index: number) {
  pendingDeleteProjectIndex.value = pendingDeleteProjectIndex.value === index ? null : index
}

function cancelRemoveProject() {
  pendingDeleteProjectIndex.value = null
}

function confirmRemoveProject() {
  if (pendingDeleteProjectIndex.value === null) return

  removeProject(pendingDeleteProjectIndex.value)
  pendingDeleteProjectIndex.value = null
}

function openProjectEdit(index: number) {
  const project = projects.value[index]
  if (!project) return

  pendingDeleteProjectIndex.value = null
  editingProjectIndex.value = index
  Object.assign(projectEditForm, {
    name: project.name,
    role: project.role,
    techStack: project.techStack,
    description: project.description,
    content: project.content,
    outcomes: project.outcomes ?? '',
  })
  projectEditErrors.name = ''
  projectEditErrors.description = ''
  projectEditErrors.content = ''
}

function closeProjectEdit() {
  editingProjectIndex.value = null
  resetProjectEditForm()
  projectEditErrors.name = ''
  projectEditErrors.description = ''
  projectEditErrors.content = ''
}

function saveProjectEdit() {
  if (editingProjectIndex.value === null || !validateProjectEditForm()) return

  const project = projects.value[editingProjectIndex.value]
  if (!project) {
    closeProjectEdit()
    return
  }

  projects.value[editingProjectIndex.value] = {
    id: project.id,
    name: projectEditForm.name.trim(),
    role: projectEditForm.role.trim(),
    techStack: projectEditForm.techStack.trim(),
    description: projectEditForm.description.trim(),
    content: projectEditForm.content.trim(),
    outcomes: projectEditForm.outcomes?.trim() ?? '',
  }

  expandedProjectIndexes.value = new Set(expandedProjectIndexes.value).add(editingProjectIndex.value)
  closeProjectEdit()
}

function clearResumeError(field: ResumeRequiredField) {
  resumeErrors[field] = ''
}

function syncCurrentStatusWithIdentity() {
  const availableStatuses = currentStatusOptionsByIdentity[form.jobSearchIdentity]

  if (availableStatuses.includes(form.currentStatus)) return

  form.currentStatus = availableStatuses[0]
}

function clearProjectError(field: ProjectRequiredField) {
  projectErrors[field] = ''
}

function clearProjectEditError(field: ProjectRequiredField) {
  projectEditErrors[field] = ''
}

function isDraftUnchanged(draft: ResumeDraft) {
  return (
    props.mode === 'edit' &&
    initialSavedDraft.value !== null &&
    createSaveComparableSnapshot(initialSavedDraft.value) === createSaveComparableSnapshot(draft)
  )
}

function createSaveComparableSnapshot(draft: ResumeDraft) {
  return JSON.stringify({
    title: draft.title,
    targetDirection: draft.targetDirection,
    name: draft.name,
    address: draft.address,
    educationLevel: draft.educationLevel,
    school: draft.school,
    major: draft.major,
    graduationYear: draft.graduationYear,
    currentStatus: draft.currentStatus,
    jobSearchIdentity: draft.jobSearchIdentity,
    portfolioLinks: (draft.portfolioLinks ?? []).map((link) => ({
      label: link.label,
      url: link.url,
    })),
    languages: (draft.languages ?? []).map((language) => ({
      language: language.language,
      level: language.level,
    })),
    workExperiences: (draft.workExperiences ?? []).map((experience) => ({
      id: experience.id,
      companyName: experience.companyName,
      industry: experience.industry ?? '',
      department: experience.department ?? '',
      jobTitle: experience.jobTitle,
      period: {
        start: experience.period.start,
        end: experience.period.end,
      },
    })),
    comment: draft.comment,
    skills: draft.skills,
    projects: draft.projects.map((project) => ({
      id: project.id,
      name: project.name,
      role: project.role,
      techStack: project.techStack,
      description: project.description,
      content: project.content,
      outcomes: project.outcomes ?? '',
    })),
  })
}

function submitSave() {
  if (!validateResumeForm()) return

  const draft = buildDraft()

  if (isDraftUnchanged(draft)) {
    emit('unchangedSave')
    return
  }

  emit('save', draft)
}

function requestProjectDraftConfirm(intent: 'save' | 'cancel') {
  if (!hasPendingProjectDraft.value) {
    if (intent === 'save') submitSave()
    if (intent === 'cancel') emit('cancel')
    return
  }

  projectDraftConfirmIntent.value = intent
  isProjectDraftConfirmOpen.value = true
}

function confirmProjectDraftAction() {
  const intent = projectDraftConfirmIntent.value
  isProjectDraftConfirmOpen.value = false
  projectDraftConfirmIntent.value = null

  if (intent === 'save') submitSave()
  if (intent === 'cancel') emit('cancel')
}

function cancelProjectDraftAction() {
  isProjectDraftConfirmOpen.value = false
  projectDraftConfirmIntent.value = null
}

function lockBodyScroll() {
  if (typeof document === 'undefined') return

  originalBodyOverflow.value = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return

  document.body.style.overflow = originalBodyOverflow.value
}

watch(
  () => [props.mode, props.initialDraft] as const,
  () => fillDraft(props.initialDraft),
  { immediate: true },
)

watch(createEditorSnapshot, (snapshot) => {
  if (isResettingDraft.value) return

  emit('dirtyChange', snapshot !== initialEditorSnapshot.value)
})

watch(
  () => form.jobSearchIdentity,
  () => {
    syncCurrentStatusWithIdentity()
    clearResumeError('jobSearchIdentity')
  },
)

watch(isProjectDrawerOpen, (isOpen) => {
  if (isOpen) {
    lockBodyScroll()
    return
  }

  unlockBodyScroll()
})

onBeforeUnmount(() => {
  unlockBodyScroll()
})
</script>

<template>
  <form class="w-full" @submit.prevent>
    <div class="app-toolbar mb-6 flex items-center justify-between gap-4 px-5 py-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ editorTitle }}</h1>
        <p class="mt-1 text-xs text-muted">正式保存后才会进入版本链，编辑过程不会污染历史快照。</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          icon="i-lucide-file-input"
          class="whitespace-nowrap"
          @click="importMockResumeDraft"
        >
          导入 mock 数据
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          class="whitespace-nowrap"
          :disabled="isSaving"
          @click="requestProjectDraftConfirm('cancel')"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-save"
          class="whitespace-nowrap"
          :loading="isSaving"
          :disabled="isSaving"
          @click="requestProjectDraftConfirm('save')"
        >
          {{ mode === 'edit' ? '保存修改' : '保存简历' }}
        </UButton>
      </div>
    </div>

    <div class="grid items-start gap-6 xl:grid-cols-2">
      <div class="app-panel p-5">
        <BasicInfoSection
          v-model:form="form"
          v-model:work-experiences="workExperiences"
          v-model:portfolio-links-text="portfolioLinksText"
          v-model:languages="languages"
          :resume-errors="resumeErrors"
          :education-level-options="educationLevelOptions"
          :current-status-options="filteredCurrentStatusOptions"
          :job-search-identity-options="jobSearchIdentityOptions"
          :language-level-options="languageLevelOptions"
          @clear-resume-error="clearResumeError"
        />
      </div>

      <ProjectSection
        v-model:project-form="projectForm"
        v-model:project-edit-form="projectEditForm"
        :projects="projects"
        :project-errors="projectErrors"
        :project-edit-errors="projectEditErrors"
        :expanded-project-indexes="expandedProjectIndexes"
        :pending-delete-project-index="pendingDeleteProjectIndex"
        :is-project-create-open="isProjectCreateOpen"
        :is-project-edit-open="isProjectEditOpen"
        @open-project-create="openProjectCreate"
        @close-project-create="closeProjectCreate"
        @save-project-create="addProject"
        @clear-project-error="clearProjectError"
        @toggle-project="toggleProject"
        @open-project-edit="openProjectEdit"
        @request-remove-project="requestRemoveProject"
        @cancel-remove-project="cancelRemoveProject"
        @confirm-remove-project="confirmRemoveProject"
        @close-project-edit="closeProjectEdit"
        @clear-project-edit-error="clearProjectEditError"
        @save-project-edit="saveProjectEdit"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="isProjectDraftConfirmOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      >
        <div class="app-panel w-full max-w-sm p-5 shadow-xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
              <UIcon name="i-lucide-circle-alert" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">添加项目中有未完成内容</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                当前“添加项目”区域还有未添加到项目列表的内容。继续操作会忽略这部分草稿。
              </p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="cancelProjectDraftAction">取消</UButton>
            <UButton type="button" color="warning" @click="confirmProjectDraftAction">
              {{ projectDraftConfirmIntent === 'save' ? '确定保存' : '确定退出' }}
            </UButton>
          </div>
        </div>
      </div>
    </Teleport>
  </form>
</template>
