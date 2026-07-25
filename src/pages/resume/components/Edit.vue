<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ResumeContent, ResumeDraft } from '@/types/resume'
import { getVersionDiff } from '../utils/versionDiff'

type EditorMode = 'create' | 'edit'
type Project = ResumeContent['projects'][number]
type ProjectForm = Omit<Project, 'id'>
type ResumeRequiredField = 'title' | 'targetDirection' | 'name' | 'skills'
type ProjectRequiredField = 'name' | 'description' | 'content'

const props = defineProps<{
  mode: EditorMode
  initialDraft: ResumeDraft | null
  mockDraft: ResumeDraft
}>()

const emit = defineEmits<{
  cancel: []
  save: [draft: ResumeDraft]
  dirtyChange: [dirty: boolean]
  mockImported: []
  unchangedSave: []
}>()

const projects = ref<Project[]>([])
const expandedProjectIndexes = ref<Set<number>>(new Set())
const initialEditorSnapshot = ref('')
const initialSavedDraft = ref<ResumeDraft | null>(null)
const isResettingDraft = ref(false)
const isProjectDraftConfirmOpen = ref(false)
const projectDraftConfirmIntent = ref<'save' | 'cancel' | null>(null)
const editingProjectIndex = ref<number | null>(null)
const originalBodyOverflow = ref('')
const isProjectEditOpen = computed(() => editingProjectIndex.value !== null)

const resumeErrors = reactive<Record<ResumeRequiredField, string>>({
  title: '',
  targetDirection: '',
  name: '',
  skills: '',
})
const projectErrors = reactive<Record<ProjectRequiredField, string>>({
  name: '',
  description: '',
  content: '',
})
const projectEditErrors = reactive<Record<ProjectRequiredField, string>>({
  name: '',
  description: '',
  content: '',
})

const form = reactive({
  title: '',
  targetDirection: '',
  name: '',
  address: '',
  comment: '',
  skills: '',
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

function createEditorSnapshot() {
  return JSON.stringify({
    form: { ...form },
    projects: cloneProjects(projects.value),
    projectForm: { ...projectForm },
  })
}

function resetErrors() {
  resumeErrors.title = ''
  resumeErrors.targetDirection = ''
  resumeErrors.name = ''
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

function fillDraft(draft: ResumeDraft | null) {
  isResettingDraft.value = true
  resetErrors()

  Object.assign(form, {
    title: draft?.title ?? '',
    targetDirection: draft?.targetDirection ?? '',
    name: draft?.name ?? '',
    address: draft?.address ?? '',
    comment: draft?.comment ?? '',
    skills: draft?.skills ?? '',
  })

  projects.value = draft ? cloneProjects(draft.projects) : []
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
    address: form.address.trim(),
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
  resetProjectForm()
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

function openProjectEdit(index: number) {
  const project = projects.value[index]
  if (!project) return

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
    getVersionDiff(initialSavedDraft.value, draft).length === 0
  )
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

watch(isProjectEditOpen, (isOpen) => {
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
    <div class="mb-8 flex items-center justify-between gap-4">
      <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ editorTitle }}</h1>

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
          @click="requestProjectDraftConfirm('cancel')"
        >
          取消
        </UButton>
        <UButton icon="i-lucide-save" class="whitespace-nowrap" @click="requestProjectDraftConfirm('save')">
          {{ mode === 'edit' ? '保存修改' : '保存简历' }}
        </UButton>
      </div>
    </div>

    <div class="grid items-start gap-10 xl:grid-cols-2">
      <div class="space-y-6">
        <section>
          <h2 class="mb-5 text-base font-semibold text-highlighted">基础信息</h2>

          <div class="grid gap-x-5 gap-y-3 md:grid-cols-2">
            <UFormField label="简历名称" required>
              <UInput
                v-model="form.title"
                class="w-full"
                :class="{ 'form-control-error': resumeErrors.title }"
                placeholder="前端开发简历"
                @update:model-value="clearResumeError('title')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="resumeErrors.title ? 'text-error' : 'invisible'"
              >
                {{ resumeErrors.title || '占位' }}
              </p>
            </UFormField>
            <UFormField label="目标岗位" required>
              <UInput
                v-model="form.targetDirection"
                class="w-full"
                :class="{ 'form-control-error': resumeErrors.targetDirection }"
                placeholder="前端开发工程师"
                @update:model-value="clearResumeError('targetDirection')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="resumeErrors.targetDirection ? 'text-error' : 'invisible'"
              >
                {{ resumeErrors.targetDirection || '占位' }}
              </p>
            </UFormField>
            <UFormField label="姓名" required>
              <UInput
                v-model="form.name"
                class="w-full"
                :class="{ 'form-control-error': resumeErrors.name }"
                placeholder="请输入姓名"
                @update:model-value="clearResumeError('name')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="resumeErrors.name ? 'text-error' : 'invisible'"
              >
                {{ resumeErrors.name || '占位' }}
              </p>
            </UFormField>
            <UFormField label="所在城市">
              <UInput v-model="form.address" class="w-full" placeholder="例如：上海" />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>
          </div>

          <div class="mt-5 space-y-3">
            <UFormField label="专业技能" required>
              <UTextarea
                v-model="form.skills"
                class="w-full"
                :class="{ 'form-control-error': resumeErrors.skills }"
                :rows="5"
                placeholder="例如：Vue 3、TypeScript、Vite、前端工程化"
                @update:model-value="clearResumeError('skills')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="resumeErrors.skills ? 'text-error' : 'invisible'"
              >
                {{ resumeErrors.skills || '占位' }}
              </p>
            </UFormField>
            <UFormField label="自我评价">
              <UTextarea
                v-model="form.comment"
                class="w-full"
                :rows="5"
                placeholder="用几句话介绍你的工作方向、经验和优势"
              />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>
          </div>
        </section>

        <section class="border-t border-default pt-8">
          <div class="mb-5 flex items-center justify-between gap-4">
            <h2 class="text-base font-semibold text-highlighted">添加项目</h2>
            <UButton
              type="button"
              class="project-add-button whitespace-nowrap"
              color="primary"
              variant="solid"
              icon="i-lucide-plus"
              @click="addProject"
            >
              添加到项目列表
            </UButton>
          </div>

          <div class="grid items-start gap-5 md:grid-cols-2">
            <div class="space-y-3 md:pb-1.5">
              <div class="grid gap-5 sm:grid-cols-2">
                <UFormField label="项目名称" required>
                  <UInput
                    v-model="projectForm.name"
                    class="w-full"
                    :class="{ 'form-control-error': projectErrors.name }"
                    placeholder="Agent Seek Employment"
                    @update:model-value="clearProjectError('name')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="projectErrors.name ? 'text-error' : 'invisible'"
                  >
                    {{ projectErrors.name || '占位' }}
                  </p>
                </UFormField>
                <UFormField label="角色">
                  <UInput v-model="projectForm.role" class="w-full" placeholder="前端开发负责人" />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>
              </div>
              <UFormField label="技术栈">
                <UInput v-model="projectForm.techStack" class="w-full" placeholder="Vue 3, TypeScript, Vite, Pinia" />
                <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
              </UFormField>
              <UFormField label="项目介绍" required>
                <UTextarea
                  v-model="projectForm.description"
                  class="w-full"
                  :class="{ 'form-control-error': projectErrors.description }"
                  :rows="5"
                  placeholder="项目背景、目标和核心功能"
                  @update:model-value="clearProjectError('description')"
                />
                <p
                  class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                  :class="projectErrors.description ? 'text-error' : 'invisible'"
                >
                  {{ projectErrors.description || '占位' }}
                </p>
              </UFormField>
            </div>

            <div class="space-y-5">
              <UFormField label="工作内容" required>
                <UTextarea
                  v-model="projectForm.content"
                  class="w-full"
                  :class="{ 'form-control-error': projectErrors.content }"
                  :rows="5"
                  placeholder="负责内容、技术方案与可量化结果"
                  @update:model-value="clearProjectError('content')"
                />
                <p
                  class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                  :class="projectErrors.content ? 'text-error' : 'invisible'"
                >
                  {{ projectErrors.content || '占位' }}
                </p>
              </UFormField>
              <UFormField label="项目成果">
                <UTextarea
                  v-model="projectForm.outcomes"
                  class="w-full"
                  :rows="5"
                  placeholder="首屏加载时间降低 35%，支持 10 万日活用户"
                />
                <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
              </UFormField>
            </div>
          </div>
        </section>
      </div>

      <aside class="xl:border-l xl:border-default xl:pl-8">
        <div class="xl:sticky xl:top-6">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-highlighted">已添加项目</h2>
            <UBadge color="neutral" variant="subtle" :label="`${projects.length} 个`" />
          </div>

          <div
            v-if="projects.length === 0"
            class="mt-5 rounded-lg border border-dashed border-default px-5 py-10 text-center"
          >
            <UIcon name="i-lucide-folder-plus" class="mx-auto size-5 text-muted" />
            <p class="mt-3 text-sm text-muted">添加后的项目会显示在这里</p>
          </div>

          <div v-else class="mt-5 space-y-3">
            <article
              v-for="(project, index) in projects"
              :key="`${project.name}-${index}`"
              class="project-summary-card rounded-lg border border-default p-4"
              :class="{ 'project-summary-card-expanded': expandedProjectIndexes.has(index) }"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate font-medium text-highlighted">{{ project.name }}</p>
                  <p v-if="project.role" class="mt-1 text-xs text-muted">{{ project.role }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <UBadge color="primary" variant="subtle" :label="`项目 ${index + 1}`" />
                  <button
                    type="button"
                    class="project-card-edit"
                    :aria-label="`编辑 ${project.name}`"
                    :title="`编辑 ${project.name}`"
                    @click="openProjectEdit(index)"
                  >
                    <UIcon name="i-lucide-pencil" class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="project-card-remove"
                    :aria-label="`移除 ${project.name}`"
                    :title="`移除 ${project.name}`"
                    @click="removeProject(index)"
                  >
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="project-card-toggle"
                    :aria-expanded="expandedProjectIndexes.has(index)"
                    :aria-label="`${expandedProjectIndexes.has(index) ? '收起' : '展开'} ${project.name} 详情`"
                    :title="`${expandedProjectIndexes.has(index) ? '收起' : '展开'}详情`"
                    @click="toggleProject(index)"
                  >
                    <UIcon
                      name="i-lucide-chevron-down"
                      class="size-3.5 transition-transform duration-200"
                      :class="{ 'rotate-180': expandedProjectIndexes.has(index) }"
                    />
                  </button>
                </div>
              </div>
              <p v-if="project.techStack" class="mt-1 text-xs text-muted">{{ project.techStack }}</p>
              <p class="mt-2 text-sm leading-6 text-muted">{{ project.description }}</p>
              <Transition name="project-details">
                <div v-if="expandedProjectIndexes.has(index)" class="project-details">
                  <div class="mt-3 space-y-3 border-t border-default pt-3">
                    <div>
                      <p class="text-xs font-medium text-highlighted">工作内容</p>
                      <p class="mt-1 whitespace-pre-line text-xs leading-5 text-muted">{{ project.content }}</p>
                    </div>
                    <div v-if="project.outcomes">
                      <p class="text-xs font-medium text-highlighted">项目成果</p>
                      <p class="mt-1 whitespace-pre-line text-xs leading-5 text-primary">{{ project.outcomes }}</p>
                    </div>
                  </div>
                </div>
              </Transition>
            </article>
          </div>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div
        v-if="isProjectDraftConfirmOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      >
        <div class="w-full max-w-sm rounded-lg border border-default bg-default p-5 shadow-xl">
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

    <Teleport to="body">
      <Transition name="project-edit-drawer">
        <div v-if="isProjectEditOpen" class="fixed inset-0 z-50 flex justify-end bg-black/55">
          <button
            type="button"
            class="absolute inset-0 cursor-default"
            aria-label="取消编辑项目"
            @click="closeProjectEdit"
          />

          <section
            class="relative flex h-full w-full max-w-2xl flex-col border-l border-default bg-default shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-edit-title"
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-default px-6 py-5">
              <div class="min-w-0">
                <h2 id="project-edit-title" class="text-lg font-semibold text-highlighted">编辑项目经历</h2>
                <p class="mt-1 text-sm text-muted">修改后点击保存，才会同步到已添加项目列表。</p>
              </div>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="关闭编辑项目"
                @click="closeProjectEdit"
              />
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                <UFormField label="项目名称" required>
                  <UInput
                    v-model="projectEditForm.name"
                    class="w-full"
                    :class="{ 'form-control-error': projectEditErrors.name }"
                    placeholder="Agent Seek Employment"
                    @update:model-value="clearProjectEditError('name')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="projectEditErrors.name ? 'text-error' : 'invisible'"
                  >
                    {{ projectEditErrors.name || '占位' }}
                  </p>
                </UFormField>
                <UFormField label="角色">
                  <UInput v-model="projectEditForm.role" class="w-full" placeholder="前端开发负责人" />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>
              </div>

              <div class="mt-3 space-y-3">
                <UFormField label="技术栈">
                  <UInput
                    v-model="projectEditForm.techStack"
                    class="w-full"
                    placeholder="Vue 3, TypeScript, Vite, Pinia"
                  />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>

                <UFormField label="项目介绍" required>
                  <UTextarea
                    v-model="projectEditForm.description"
                    class="w-full"
                    :class="{ 'form-control-error': projectEditErrors.description }"
                    :rows="5"
                    placeholder="项目背景、目标和核心功能"
                    @update:model-value="clearProjectEditError('description')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="projectEditErrors.description ? 'text-error' : 'invisible'"
                  >
                    {{ projectEditErrors.description || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="工作内容" required>
                  <UTextarea
                    v-model="projectEditForm.content"
                    class="w-full"
                    :class="{ 'form-control-error': projectEditErrors.content }"
                    :rows="7"
                    placeholder="负责内容、技术方案与可量化结果"
                    @update:model-value="clearProjectEditError('content')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="projectEditErrors.content ? 'text-error' : 'invisible'"
                  >
                    {{ projectEditErrors.content || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="项目成果">
                  <UTextarea
                    v-model="projectEditForm.outcomes"
                    class="w-full"
                    :rows="5"
                    placeholder="首屏加载时间降低 35%，支持 10 万日活用户"
                  />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>
              </div>
            </div>

            <footer class="flex shrink-0 justify-end gap-2 border-t border-default px-6 py-4">
              <UButton type="button" color="neutral" variant="ghost" @click="closeProjectEdit">取消</UButton>
              <UButton type="button" icon="i-lucide-check" @click="saveProjectEdit">保存项目</UButton>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
  </form>
</template>
