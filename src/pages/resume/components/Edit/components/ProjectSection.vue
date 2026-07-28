<script setup lang="ts">
import { computed } from 'vue'
import type { Project, ProjectErrors, ProjectForm, ProjectRequiredField } from '../types'

const props = defineProps<{
  projects: Project[]
  projectErrors: ProjectErrors
  projectEditErrors: ProjectErrors
  expandedProjectIndexes: Set<number>
  pendingDeleteProjectIndex: number | null
  isProjectCreateOpen: boolean
  isProjectEditOpen: boolean
}>()

const projectForm = defineModel<ProjectForm>('projectForm', { required: true })
const projectEditForm = defineModel<ProjectForm>('projectEditForm', { required: true })

const emit = defineEmits<{
  openProjectCreate: []
  closeProjectCreate: []
  saveProjectCreate: []
  clearProjectError: [field: ProjectRequiredField]
  toggleProject: [index: number]
  openProjectEdit: [index: number]
  requestRemoveProject: [index: number]
  cancelRemoveProject: []
  confirmRemoveProject: []
  closeProjectEdit: []
  clearProjectEditError: [field: ProjectRequiredField]
  saveProjectEdit: []
}>()

const isProjectDrawerOpen = computed(() => props.isProjectCreateOpen || props.isProjectEditOpen)
const isCreatingProject = computed(() => props.isProjectCreateOpen)
const drawerForm = computed(() => (isCreatingProject.value ? projectForm.value : projectEditForm.value))
const drawerErrors = computed(() => (isCreatingProject.value ? props.projectErrors : props.projectEditErrors))
const drawerTitle = computed(() => (isCreatingProject.value ? '添加项目经历' : '编辑项目经历'))
const drawerDescription = computed(() =>
  isCreatingProject.value
    ? '补充完整项目经历后，它会加入当前简历的项目列表。'
    : '修改后点击保存，才会同步到已添加项目列表。',
)

function closeProjectDrawer() {
  if (isCreatingProject.value) {
    emit('closeProjectCreate')
    return
  }

  emit('closeProjectEdit')
}

function saveProjectDrawer() {
  if (isCreatingProject.value) {
    emit('saveProjectCreate')
    return
  }

  emit('saveProjectEdit')
}

function clearDrawerError(field: ProjectRequiredField) {
  if (isCreatingProject.value) {
    emit('clearProjectError', field)
    return
  }

  emit('clearProjectEditError', field)
}
</script>

<template>
  <aside>
    <div class="space-y-4 xl:sticky xl:top-6">
      <section class="app-panel p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="app-section-title">项目经历</h2>
            <p class="app-section-kicker mt-1">项目经历会成为项目面追问的重要上下文</p>
          </div>
          <UButton
            type="button"
            class="project-add-button whitespace-nowrap"
            color="primary"
            variant="solid"
            icon="i-lucide-plus"
            @click="emit('openProjectCreate')"
          >
            添加项目
          </UButton>
        </div>

        <div v-if="projects.length === 0" class="app-panel-muted mt-4 px-5 py-9 text-center">
          <UIcon name="i-lucide-folder-plus" class="mx-auto size-5 text-muted" />
          <p class="mt-3 text-sm text-muted">还没有项目经历，从第一段项目开始补充吧</p>
        </div>

        <div v-else class="mt-4 space-y-3">
          <article
            v-for="(project, index) in projects"
            :key="project.id || `${project.name}-${index}`"
            class="app-card project-summary-card p-4"
            :class="{ 'project-summary-card-expanded': expandedProjectIndexes.has(index) }"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="truncate font-medium text-highlighted">{{ project.name }}</p>
                  <UBadge color="primary" variant="subtle" :label="`项目 ${index + 1}`" />
                </div>
                <p v-if="project.role" class="mt-1 text-xs text-muted">{{ project.role }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="project-card-edit"
                  :aria-label="`编辑 ${project.name}`"
                  :title="`编辑 ${project.name}`"
                  @click="emit('openProjectEdit', index)"
                >
                  <UIcon name="i-lucide-pencil" class="size-3.5" />
                </button>
                <div class="relative">
                  <button
                    type="button"
                    class="project-card-remove"
                    :aria-label="`移除 ${project.name}`"
                    :title="`移除 ${project.name}`"
                    @click="emit('requestRemoveProject', index)"
                  >
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>

                  <div
                    v-if="pendingDeleteProjectIndex === index"
                    class="app-panel absolute right-0 top-[calc(100%+0.5rem)] z-20 w-56 p-3 text-sm shadow-xl"
                  >
                    <p class="font-medium text-highlighted">确认删除这个项目？</p>
                    <p class="mt-1 text-xs leading-5 text-muted">删除后需要重新添加，当前未接入回收站。</p>
                    <div class="mt-3 flex justify-end gap-2">
                      <UButton
                        type="button"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        @click="emit('cancelRemoveProject')"
                      >
                        取消
                      </UButton>
                      <UButton
                        type="button"
                        size="xs"
                        color="error"
                        icon="i-lucide-trash-2"
                        @click="emit('confirmRemoveProject')"
                      >
                        删除
                      </UButton>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="project-card-toggle"
                  :aria-expanded="expandedProjectIndexes.has(index)"
                  :aria-label="`${expandedProjectIndexes.has(index) ? '收起' : '展开'} ${project.name} 详情`"
                  :title="`${expandedProjectIndexes.has(index) ? '收起' : '展开'}详情`"
                  @click="emit('toggleProject', index)"
                >
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-3.5 transition-transform duration-200"
                    :class="{ 'rotate-180': expandedProjectIndexes.has(index) }"
                  />
                </button>
              </div>
            </div>
            <p v-if="project.techStack" class="mt-2 text-xs text-muted">{{ project.techStack }}</p>
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
      </section>
    </div>

    <Teleport to="body">
      <Transition name="project-edit-drawer">
        <div v-if="isProjectDrawerOpen" class="fixed inset-0 z-50 flex justify-end bg-black/55">
          <button
            type="button"
            class="absolute inset-0 cursor-default"
            aria-label="取消编辑项目"
            @click="closeProjectDrawer"
          />

          <section
            class="app-drawer relative flex h-full w-full max-w-2xl flex-col border-l border-default shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-drawer-title"
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-default px-6 py-5">
              <div class="min-w-0">
                <h2 id="project-drawer-title" class="text-lg font-semibold text-highlighted">{{ drawerTitle }}</h2>
                <p class="mt-1 text-sm text-muted">{{ drawerDescription }}</p>
              </div>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="`关闭${drawerTitle}`"
                @click="closeProjectDrawer"
              />
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                <UFormField label="项目名称" required>
                  <UInput
                    v-model="drawerForm.name"
                    class="w-full"
                    :class="{ 'form-control-error': drawerErrors.name }"
                    placeholder="Agent Seek Employment"
                    @update:model-value="clearDrawerError('name')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="drawerErrors.name ? 'text-error' : 'invisible'"
                  >
                    {{ drawerErrors.name || '占位' }}
                  </p>
                </UFormField>
                <UFormField label="角色">
                  <UInput v-model="drawerForm.role" class="w-full" placeholder="前端开发负责人" />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>
              </div>

              <div class="mt-3 space-y-3">
                <UFormField label="技术栈">
                  <UInput v-model="drawerForm.techStack" class="w-full" placeholder="Vue 3, TypeScript, Vite, Pinia" />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>

                <UFormField label="项目介绍" required>
                  <UTextarea
                    v-model="drawerForm.description"
                    class="w-full"
                    :class="{ 'form-control-error': drawerErrors.description }"
                    :rows="5"
                    placeholder="项目背景、目标和核心功能"
                    @update:model-value="clearDrawerError('description')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="drawerErrors.description ? 'text-error' : 'invisible'"
                  >
                    {{ drawerErrors.description || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="工作内容" required>
                  <UTextarea
                    v-model="drawerForm.content"
                    class="w-full"
                    :class="{ 'form-control-error': drawerErrors.content }"
                    :rows="7"
                    placeholder="负责内容、技术方案与可量化结果"
                    @update:model-value="clearDrawerError('content')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="drawerErrors.content ? 'text-error' : 'invisible'"
                  >
                    {{ drawerErrors.content || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="项目成果">
                  <UTextarea
                    v-model="drawerForm.outcomes"
                    class="w-full"
                    :rows="5"
                    placeholder="首屏加载时间降低 35%，支持 10 万日活用户"
                  />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>
              </div>
            </div>

            <footer class="flex shrink-0 justify-end gap-2 border-t border-default px-6 py-4">
              <UButton type="button" color="neutral" variant="ghost" @click="closeProjectDrawer">取消</UButton>
              <UButton type="button" icon="i-lucide-check" @click="saveProjectDrawer">
                {{ isCreatingProject ? '添加项目' : '保存项目' }}
              </UButton>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>
