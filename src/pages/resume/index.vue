<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { onBeforeRouteLeave } from 'vue-router'
import type { ResumeContent, ResumeDraft, ResumeVersion } from '@/types/resume'
import { useResumeStore } from '@/stores'
import ResumeEdit from './components/Edit.vue'
import VersionDiffList from './components/VersionDiffList.vue'
import { mockResumeDraft } from './mocks/resumeDraft'
import { getVersionDiff } from './utils/versionDiff'

type EditorMode = 'create' | 'edit'

const mockResumeDraftStorageKey = 'agent-seek-employment:mock-resume-draft'
let toastTimer: ReturnType<typeof window.setTimeout> | null = null

const resumeStore = useResumeStore()
const { resumes, versions, currentResume, currentVersion, currentResumeVersions } = storeToRefs(resumeStore)

const editorMode = ref<EditorMode | null>(null)
const editingResumeId = ref<string | null>(null)
const editorInitialDraft = ref<ResumeDraft | null>(null)
const isEditorDirty = ref(false)
const deleteResumeId = ref<string | null>(null)
const isUnsavedConfirmOpen = ref(false)
const isLatestVersionDiffOpen = ref(false)
const isVersionPanelExpanded = ref(true)
const toastMessage = ref('')
const toastType = ref<'success' | 'error' | 'warning'>('success')
const pendingUnsavedConfirmAction = ref<(() => void) | null>(null)
const pendingUnsavedCancelAction = ref<(() => void) | null>(null)
const originalBodyOverflow = ref('')

const deleteTargetResume = computed(() => resumes.value.find((resume) => resume.id === deleteResumeId.value) ?? null)
const activeMockDraft = computed(() => readMockResumeDraft())
const latestResumeVersion = computed(() => {
  if (!currentResume.value) return null

  return versions.value.find((version) => version.id === currentResume.value?.currentVersionId) ?? null
})
const canCompareWithLatest = computed(() => {
  return Boolean(
    currentVersion.value && latestResumeVersion.value && currentVersion.value.id !== latestResumeVersion.value.id,
  )
})
const versionDiffBase = computed(() => {
  if (!currentVersion.value) return null

  if (!currentVersion.value.parentVersionId) return null

  return versions.value.find((version) => version.id === currentVersion.value?.parentVersionId) ?? null
})
const versionDiffTarget = computed(() => {
  if (!currentVersion.value) return null

  return currentVersion.value
})
const versionDiffItems = computed(() => {
  if (!currentResume.value || !versionDiffBase.value || !versionDiffTarget.value) return []

  return getVersionDiff(buildDraftFromVersion(versionDiffBase.value), buildDraftFromVersion(versionDiffTarget.value))
})
const versionDiffTitle = computed(() => {
  if (!versionDiffBase.value || !versionDiffTarget.value) return ''

  return `版本 ${versionDiffBase.value.versionNumber} → 版本 ${versionDiffTarget.value.versionNumber}`
})
const latestVersionDiffItems = computed(() => {
  if (!currentResume.value || !currentVersion.value || !latestResumeVersion.value || !canCompareWithLatest.value)
    return []

  return getVersionDiff(buildDraftFromVersion(currentVersion.value), buildDraftFromVersion(latestResumeVersion.value))
})
const latestVersionDiffTitle = computed(() => {
  if (!currentVersion.value || !latestResumeVersion.value || !canCompareWithLatest.value) return ''

  return `版本 ${currentVersion.value.versionNumber} → 版本 ${latestResumeVersion.value.versionNumber}`
})
const selectedVersionTargetDirection = computed(() => getVersionTargetDirection(currentVersion.value))

function cloneProjects(sourceProjects: ResumeContent['projects']) {
  return sourceProjects.map((project) => ({
    ...project,
    id: project.id || crypto.randomUUID(),
  }))
}

function buildResumeDraft(title: string, targetDirection: string, content: ResumeContent): ResumeDraft {
  return {
    title,
    targetDirection,
    name: content.name,
    address: content.address ?? '',
    comment: content.comment ?? '',
    skills: content.skills,
    projects: cloneProjects(content.projects),
  }
}

function getVersionTargetDirection(version: ResumeVersion | null) {
  return version?.targetDirection ?? currentResume.value?.targetDirection ?? ''
}

function buildDraftFromVersion(version: ResumeVersion): ResumeDraft {
  return buildResumeDraft(currentResume.value?.title ?? '', getVersionTargetDirection(version), version.content)
}

function readMockResumeDraft() {
  const storedDraft = localStorage.getItem(mockResumeDraftStorageKey)

  if (!storedDraft) return mockResumeDraft

  try {
    return JSON.parse(storedDraft) as ResumeDraft
  } catch {
    return mockResumeDraft
  }
}

function writeMockResumeDraft(draft: ResumeDraft) {
  localStorage.setItem(mockResumeDraftStorageKey, JSON.stringify(draft))
}

function showToast(title: string, color: 'success' | 'error' | 'warning' = 'success') {
  toastMessage.value = title
  toastType.value = color

  if (toastTimer) window.clearTimeout(toastTimer)

  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
    toastTimer = null
  }, 3500)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function openCreateEditor() {
  editorMode.value = 'create'
  editingResumeId.value = null
  editorInitialDraft.value = null
  isEditorDirty.value = false
}

function startEditCurrentResume() {
  if (!currentResume.value || !currentVersion.value) return

  editorMode.value = 'edit'
  editingResumeId.value = currentResume.value.id
  editorInitialDraft.value = buildResumeDraft(
    currentResume.value.title,
    getVersionTargetDirection(currentVersion.value),
    currentVersion.value.content,
  )
  isEditorDirty.value = false
}

function closeEditor() {
  editorMode.value = null
  editingResumeId.value = null
  editorInitialDraft.value = null
  isEditorDirty.value = false
}

function handleEditorCancel() {
  requestUnsavedConfirm(closeEditor)
}

function handleEditorSave(draft: ResumeDraft) {
  if (editorMode.value === 'edit' && editingResumeId.value) {
    resumeStore.saveNewVersion({
      resumeId: editingResumeId.value,
      title: draft.title,
      targetDirection: draft.targetDirection,
      content: draft,
      changeNote: '编辑简历',
    })
  } else {
    resumeStore.createResume({
      title: draft.title,
      targetDirection: draft.targetDirection,
      content: draft,
    })
  }

  showToast(editorMode.value === 'edit' ? '简历修改已保存' : '简历已保存')
  closeEditor()
}

function saveCurrentResumeAsMockDraft() {
  if (!currentResume.value || !currentVersion.value) return

  writeMockResumeDraft(
    buildResumeDraft(
      currentResume.value.title,
      getVersionTargetDirection(currentVersion.value),
      currentVersion.value.content,
    ),
  )
  showToast('当前简历已设为 mock 数据')
}

function openDeleteResumeConfirm(resumeId: string) {
  deleteResumeId.value = resumeId
}

function closeDeleteResumeConfirm() {
  deleteResumeId.value = null
}

function confirmDeleteResume() {
  if (!deleteResumeId.value) return

  resumeStore.deleteResume(deleteResumeId.value)
  deleteResumeId.value = null
  showToast('简历已删除')
}

function requestUnsavedConfirm(confirmAction: () => void, cancelAction: () => void = () => {}) {
  if (!isEditorDirty.value) {
    confirmAction()
    return
  }

  pendingUnsavedConfirmAction.value = confirmAction
  pendingUnsavedCancelAction.value = cancelAction
  isUnsavedConfirmOpen.value = true
}

function confirmUnsavedLeave() {
  const action = pendingUnsavedConfirmAction.value
  isUnsavedConfirmOpen.value = false
  pendingUnsavedConfirmAction.value = null
  pendingUnsavedCancelAction.value = null
  action?.()
}

function cancelUnsavedLeave() {
  const action = pendingUnsavedCancelAction.value
  isUnsavedConfirmOpen.value = false
  pendingUnsavedConfirmAction.value = null
  pendingUnsavedCancelAction.value = null
  action?.()
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

function openLatestVersionDiff() {
  if (!canCompareWithLatest.value) return

  isLatestVersionDiffOpen.value = true
  lockBodyScroll()
}

function closeLatestVersionDiff() {
  isLatestVersionDiffOpen.value = false
  unlockBodyScroll()
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isEditorDirty.value) return

  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave((_to, _from, next) => {
  requestUnsavedConfirm(
    () => next(),
    () => next(false),
  )
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  unlockBodyScroll()

  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <section class="w-full">
    <Transition name="resume-toast">
      <div v-if="toastMessage" class="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
        <div
          class="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur"
          :class="{
            'border-success/30 bg-success/15 text-success': toastType === 'success',
            'border-error/30 bg-error/15 text-error': toastType === 'error',
            'border-warning/30 bg-warning/15 text-warning': toastType === 'warning',
          }"
        >
          <UIcon
            :name="
              toastType === 'success'
                ? 'i-lucide-circle-check'
                : toastType === 'error'
                  ? 'i-lucide-circle-x'
                  : 'i-lucide-circle-alert'
            "
            class="size-4"
          />
          <span>{{ toastMessage }}</span>
        </div>
      </div>
    </Transition>

    <UCard
      v-if="resumes.length === 0 && editorMode === null"
      class="flex min-h-[calc(100vh-8rem)] items-center justify-center"
    >
      <div class="w-full max-w-md px-6 py-14 text-center">
        <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-elevated">
          <UIcon name="i-lucide-file-text" class="size-6 text-muted" />
        </div>
        <p class="mt-4 text-sm font-medium text-highlighted">还没有创建简历</p>
        <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          先创建第一份简历。后续保存修改时，系统会为你保留历史版本。
        </p>
        <UButton class="mt-5 whitespace-nowrap" icon="i-lucide-plus" @click="openCreateEditor">
          创建第一份简历
        </UButton>
      </div>
    </UCard>

    <div v-else-if="editorMode === null" class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">简历管理</h1>

        <div class="flex shrink-0 items-center gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-save-all"
            class="whitespace-nowrap"
            :disabled="!currentResume || !currentVersion"
            @click="saveCurrentResumeAsMockDraft"
          >
            设为 mock 数据
          </UButton>
          <UButton icon="i-lucide-plus" class="whitespace-nowrap" @click="openCreateEditor">新建简历</UButton>
        </div>
      </div>

      <div class="grid items-start gap-6 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
        <section>
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-highlighted">简历主线</h2>
            <UBadge color="neutral" variant="subtle" :label="`${resumes.length} 份`" />
          </div>

          <div class="space-y-3">
            <button
              v-for="resume in resumes"
              :key="resume.id"
              type="button"
              class="w-full rounded-lg border border-default p-4 text-left transition-colors hover:border-accented hover:bg-elevated"
              :class="currentResume?.id === resume.id ? 'border-primary bg-elevated' : ''"
              @click="resumeStore.selectResume(resume.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-highlighted">{{ resume.title }}</p>
                  <p class="mt-1 truncate text-xs text-muted">{{ resume.targetDirection }}</p>
                </div>
                <UIcon
                  v-if="currentResume?.id === resume.id"
                  name="i-lucide-check"
                  class="mt-0.5 size-4 shrink-0 text-primary"
                />
              </div>
              <p class="mt-3 text-xs text-muted">更新于 {{ formatDate(resume.updatedAt) }}</p>
            </button>
          </div>
        </section>

        <section v-if="currentResume && currentVersion" class="rounded-lg border border-default p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm text-muted">当前快照</p>
                <UBadge color="primary" variant="subtle" :label="`版本 ${currentVersion.versionNumber}`" />
              </div>
              <h2 class="mt-1 truncate text-lg font-semibold text-highlighted">{{ currentResume.title }}</h2>
              <p class="mt-1 text-sm text-muted">{{ selectedVersionTargetDirection }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UButton
                type="button"
                size="sm"
                color="neutral"
                variant="outline"
                icon="i-lucide-pencil"
                class="whitespace-nowrap"
                @click="startEditCurrentResume"
              >
                编辑
              </UButton>
              <UButton
                type="button"
                size="sm"
                color="error"
                variant="outline"
                icon="i-lucide-trash-2"
                class="whitespace-nowrap"
                @click="openDeleteResumeConfirm(currentResume.id)"
              >
                删除
              </UButton>
            </div>
          </div>

          <div class="mt-5 rounded-lg border border-default bg-elevated/30 p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-highlighted">版本记录</h3>
                <p class="mt-1 text-xs text-muted">当前保存了 {{ currentResumeVersions.length }} 个版本快照</p>
              </div>
              <UButton
                type="button"
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="isVersionPanelExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="whitespace-nowrap"
                :aria-expanded="isVersionPanelExpanded"
                @click="isVersionPanelExpanded = !isVersionPanelExpanded"
              >
                {{ isVersionPanelExpanded ? '收起' : '展开' }}
              </UButton>
            </div>

            <Transition name="version-panel">
              <div v-if="isVersionPanelExpanded" class="version-panel mt-4 space-y-5">
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="version in currentResumeVersions"
                    :key="version.id"
                    type="button"
                    size="sm"
                    color="neutral"
                    :variant="currentVersion.id === version.id ? 'solid' : 'outline'"
                    @click="resumeStore.selectVersion(version.id)"
                  >
                    版本 {{ version.versionNumber }} · {{ formatDate(version.createdAt) }}
                  </UButton>
                </div>

                <div>
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                      <h3 class="text-sm font-semibold text-highlighted">版本差异</h3>
                      <UBadge v-if="versionDiffTitle" color="neutral" variant="subtle" :label="versionDiffTitle" />
                    </div>
                    <UButton
                      v-if="canCompareWithLatest"
                      type="button"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-history"
                      class="whitespace-nowrap"
                      @click="openLatestVersionDiff"
                    >
                      与最新版比较
                    </UButton>
                  </div>

                  <div
                    v-if="!versionDiffTitle"
                    class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
                  >
                    初始版本，没有上一个版本可对比。
                  </div>

                  <div
                    v-else-if="versionDiffItems.length === 0"
                    class="rounded-md border border-default bg-default px-4 py-6 text-center text-sm text-muted"
                  >
                    两个版本之间没有有效文本变化。
                  </div>

                  <VersionDiffList v-else :items="versionDiffItems" />
                </div>
              </div>
            </Transition>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <div class="rounded-md border border-default px-4 py-3">
              <p class="text-xs text-muted">姓名</p>
              <p class="mt-1 text-sm font-medium text-highlighted">{{ currentVersion.content.name }}</p>
            </div>
            <div class="rounded-md border border-default px-4 py-3">
              <p class="text-xs text-muted">城市</p>
              <p class="mt-1 text-sm font-medium text-highlighted">{{ currentVersion.content.address || '未填写' }}</p>
            </div>
          </div>

          <div class="mt-5 space-y-5">
            <div>
              <h3 class="text-sm font-semibold text-highlighted">专业技能</h3>
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-muted">{{ currentVersion.content.skills }}</p>
            </div>

            <div v-if="currentVersion.content.comment">
              <h3 class="text-sm font-semibold text-highlighted">自我评价</h3>
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-muted">{{ currentVersion.content.comment }}</p>
            </div>

            <div>
              <div class="mb-3 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-highlighted">项目经历</h3>
                <UBadge color="neutral" variant="subtle" :label="`${currentVersion.content.projects.length} 个`" />
              </div>

              <div
                v-if="currentVersion.content.projects.length === 0"
                class="rounded-md border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
              >
                暂未添加项目经历
              </div>

              <div v-else class="space-y-3">
                <article
                  v-for="(project, index) in currentVersion.content.projects"
                  :key="`${project.name}-${index}`"
                  class="rounded-md border border-default p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-highlighted">{{ project.name }}</p>
                      <p v-if="project.role" class="mt-1 text-xs text-muted">{{ project.role }}</p>
                    </div>
                    <UBadge color="neutral" variant="subtle" :label="`项目 ${index + 1}`" />
                  </div>
                  <p v-if="project.techStack" class="mt-2 text-xs text-muted">{{ project.techStack }}</p>
                  <p class="mt-3 whitespace-pre-line text-sm leading-6 text-muted">{{ project.description }}</p>
                  <div class="mt-3 grid gap-3 border-t border-default pt-3">
                    <div>
                      <p class="text-xs font-medium text-highlighted">工作内容</p>
                      <p class="mt-1 whitespace-pre-line text-xs leading-5 text-muted">{{ project.content }}</p>
                    </div>
                    <div v-if="project.outcomes">
                      <p class="text-xs font-medium text-highlighted">项目成果</p>
                      <p class="mt-1 whitespace-pre-line text-xs leading-5 text-primary">{{ project.outcomes }}</p>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ResumeEdit
      v-else
      :mode="editorMode"
      :initial-draft="editorInitialDraft"
      :mock-draft="activeMockDraft"
      @cancel="handleEditorCancel"
      @save="handleEditorSave"
      @dirty-change="isEditorDirty = $event"
      @mock-imported="showToast('mock 数据已导入')"
      @unchanged-save="showToast('当前未发生更改', 'warning')"
    />

    <Teleport to="body">
      <Transition name="resume-diff-drawer">
        <div v-if="isLatestVersionDiffOpen" class="fixed inset-0 z-50 flex justify-end bg-black/55">
          <button
            type="button"
            class="absolute inset-0 cursor-default"
            aria-label="关闭与最新版比较"
            @click="closeLatestVersionDiff"
          />

          <section
            class="relative flex h-full w-full max-w-2xl flex-col border-l border-default bg-default shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="latest-version-diff-title"
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-default px-6 py-5">
              <div class="min-w-0">
                <h2 id="latest-version-diff-title" class="text-lg font-semibold text-highlighted">与最新版比较</h2>
                <p class="mt-1 text-sm text-muted">查看当前选中版本与当前最新版本之间的累计变化。</p>
                <UBadge
                  v-if="latestVersionDiffTitle"
                  color="neutral"
                  variant="subtle"
                  class="mt-3"
                  :label="latestVersionDiffTitle"
                />
              </div>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="关闭与最新版比较"
                @click="closeLatestVersionDiff"
              />
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div
                v-if="latestVersionDiffItems.length === 0"
                class="rounded-md border border-default bg-elevated/40 px-4 py-6 text-center text-sm text-muted"
              >
                当前选中版本与最新版之间没有有效文本变化。
              </div>
              <VersionDiffList v-else :items="latestVersionDiffItems" />
            </div>
          </section>
        </div>
      </Transition>

      <div v-if="deleteResumeId" class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
        <div class="w-full max-w-sm rounded-lg border border-default bg-default p-5 shadow-xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">确认删除简历</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                删除后会同时移除这份简历下的所有版本记录。当前数据还没有接入后端，删除后无法恢复。
              </p>
              <p v-if="deleteTargetResume" class="mt-3 truncate text-sm font-medium text-highlighted">
                {{ deleteTargetResume.title }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="closeDeleteResumeConfirm">取消</UButton>
            <UButton type="button" color="error" icon="i-lucide-trash-2" @click="confirmDeleteResume">确认删除</UButton>
          </div>
        </div>
      </div>

      <div v-if="isUnsavedConfirmOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
        <div class="w-full max-w-sm rounded-lg border border-default bg-default p-5 shadow-xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
              <UIcon name="i-lucide-circle-alert" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">有未保存内容</h2>
              <p class="mt-2 text-sm leading-6 text-muted">当前简历还没有保存。如果离开页面，这次编辑内容会丢失。</p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="cancelUnsavedLeave">取消</UButton>
            <UButton type="button" color="warning" @click="confirmUnsavedLeave">确定离开</UButton>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
