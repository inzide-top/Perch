<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { ApiRequestError } from '@/services/http'
import { resumeApi, type ResumePdfImportResponse } from '@/services/resumes'
import { getAiTaskErrorPresentation } from '@/services/ai-errors'
import { useBackgroundTaskStore, useResumePdfImportReviewStore, useSettingsStore } from '@/stores'

defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{
  importStarted: []
  apply: [result: ResumePdfImportResponse]
}>()
const settingsStore = useSettingsStore()
const backgroundTaskStore = useBackgroundTaskStore()
const reviewStore = useResumePdfImportReviewStore()
const toast = useToast()
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isRetrying = ref(false)
const preview = ref<ResumePdfImportResponse | null>(null)
const failureDialogOpen = ref(false)
let importController: AbortController | null = null
const activeImportTask = computed(() =>
  backgroundTaskStore.tasks.find(
    (task) => task.type === 'resume_pdf_import' && (task.status === 'pending' || task.status === 'processing'),
  ),
)
const isImporting = computed(() => isUploading.value || Boolean(activeImportTask.value))
const hasReviewResult = computed(() => Boolean(reviewStore.result))
const failedImportTask = computed(() =>
  [...backgroundTaskStore.tasks]
    .filter((task) => task.type === 'resume_pdf_import' && task.status === 'failed' && task.resumePdfImport?.error)
    .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
    .at(0),
)
const failurePresentation = computed(() => getAiTaskErrorPresentation(failedImportTask.value?.resumePdfImport?.error))

const fieldLabels: Record<string, string> = {
  title: '简历名称',
  targetDirection: '目标岗位',
  name: '姓名',
  address: '期望城市',
  educationLevel: '学历',
  school: '学校',
  major: '专业',
  graduationYear: '毕业年份',
  currentStatus: '当前状态',
  jobSearchIdentity: '求职身份',
  portfolioLinks: '作品链接',
  languages: '语言能力',
  workExperiences: '工作经历',
  comment: '个人说明',
  skills: '专业技能',
  projects: '项目经历',
}

function openFilePicker() {
  if (!settingsStore.llm.baseUrl || !settingsStore.llm.modelName || !settingsStore.llm.apiKey) {
    toast.add({ title: '请先配置模型', description: 'PDF 结构化需要使用当前模型连接。', color: 'warning' })
    return
  }
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast.add({ title: '文件格式不支持', description: '请选择 PDF 文件。', color: 'error' })
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.add({ title: 'PDF 过大', description: '单份 PDF 不能超过 8MB。', color: 'error' })
    return
  }

  importController?.abort()
  importController = new AbortController()
  isUploading.value = true
  emit('importStarted')
  try {
    const task = await resumeApi.importResumePdf(file, settingsStore.llm, { signal: importController.signal })
    backgroundTaskStore.register(
      { type: 'resume_pdf_import', taskId: task.id },
      { primary: task.fileName, secondary: 'PDF 简历识别' },
    )
    toast.add({
      title: 'PDF 已进入后台识别',
      description: '你可以继续填写或离开页面，完成后会通知你。',
      color: 'success',
      icon: 'i-lucide-file-clock',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    toast.add({
      title: 'PDF 识别失败',
      description: error instanceof ApiRequestError ? error.message : '暂时无法识别这份简历，请稍后重试。',
      color: 'error',
    })
  } finally {
    isUploading.value = false
    importController = null
  }
}

function applyPreview() {
  if (!preview.value) return
  emit('apply', preview.value)
  preview.value = null
  if (reviewStore.taskId) {
    backgroundTaskStore.unregister({ type: 'resume_pdf_import', taskId: reviewStore.taskId })
  }
  reviewStore.clear()
}

function openReviewResult() {
  if (reviewStore.result) preview.value = reviewStore.result
}

function openFailureResult() {
  if (failedImportTask.value) failureDialogOpen.value = true
}

function chooseAnotherPdf() {
  const task = failedImportTask.value
  if (task) backgroundTaskStore.unregister(task)
  failureDialogOpen.value = false
  openFilePicker()
}

async function retryFailedImport() {
  const task = failedImportTask.value
  if (!task || task.type !== 'resume_pdf_import' || isRetrying.value) return

  isRetrying.value = true
  try {
    const result = await resumeApi.retryResumePdfImportTask(task.taskId, settingsStore.llm)
    backgroundTaskStore.register(
      { type: 'resume_pdf_import', taskId: result.id },
      task.displayContext ?? { primary: result.fileName, secondary: 'PDF 简历识别' },
    )
    failureDialogOpen.value = false
    toast.add({
      title: '已重新提交识别',
      description: '后端仍会按有限次数自动重试，完成后会通知你。',
      color: 'success',
      icon: 'i-lucide-refresh-cw',
    })
  } catch (error) {
    toast.add({
      title: '重新识别提交失败',
      description: error instanceof ApiRequestError ? error.message : '暂时无法重新提交，请稍后再试。',
      color: 'error',
    })
  } finally {
    isRetrying.value = false
  }
}

watch(
  () => reviewStore.revision,
  () => openReviewResult(),
  { immediate: true },
)

watch(
  () => backgroundTaskStore.tasks,
  (tasks) => {
    const completed = [...tasks]
      .reverse()
      .find(
        (task) =>
          task.type === 'resume_pdf_import' &&
          task.status === 'completed' &&
          task.resumePdfImport?.result &&
          task.taskId !== reviewStore.taskId,
      )
    if (!completed || completed.type !== 'resume_pdf_import' || !completed.resumePdfImport) return
    reviewStore.open(completed.resumePdfImport)
  },
  { deep: true, immediate: true },
)

watch(
  () => failedImportTask.value?.key,
  (taskKey) => {
    failureDialogOpen.value = Boolean(taskKey)
  },
  { immediate: true },
)
</script>

<template>
  <input ref="fileInput" class="sr-only" type="file" accept="application/pdf,.pdf" @change="handleFileChange" />
  <UButton
    type="button"
    color="neutral"
    variant="outline"
    icon="i-lucide-file-up"
    class="whitespace-nowrap"
    title="PDF 文本会发送到当前配置的模型进行结构化，不会自动保存"
    :loading="isImporting"
    :disabled="disabled || isImporting"
    @click="hasReviewResult ? openReviewResult() : failedImportTask ? openFailureResult() : openFilePicker()"
  >
    {{ hasReviewResult ? '查看 PDF 识别结果' : failedImportTask ? '查看 PDF 识别失败' : 'PDF 导入' }}
  </UButton>

  <Teleport to="body">
    <div v-if="preview" class="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 px-4 py-6">
      <div class="absolute inset-0" aria-hidden="true" />
      <section
        class="app-panel relative flex max-h-[min(760px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-pdf-preview-title"
      >
        <header class="flex items-start justify-between gap-4 border-b border-default px-6 py-5">
          <div class="min-w-0">
            <h2 id="resume-pdf-preview-title" class="text-lg font-semibold text-highlighted">确认 PDF 识别结果</h2>
            <p class="mt-1 truncate text-sm text-muted">
              {{ preview.source.fileName }} · {{ preview.source.pageCount }} 页
            </p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭"
            @click="preview = null"
          />
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div class="rounded-xl border border-default bg-elevated/45 p-4">
            <div class="flex items-start gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UIcon name="i-lucide-scan-text" class="size-4" />
              </div>
              <div>
                <p class="font-medium text-highlighted">识别到 {{ preview.recognizedFields.length }} 类信息</p>
                <p class="mt-1 text-xs leading-5 text-muted">
                  识别期间你仍可填写表单；应用时会保留期间手动修改过的字段。项目经历需要逐条核对后才能进入正式简历。
                </p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <UBadge
                v-for="field in preview.recognizedFields"
                :key="field"
                color="primary"
                variant="subtle"
                :label="fieldLabels[field] ?? field"
              />
            </div>
          </div>

          <div v-if="preview.draft.projects.length" class="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-4">
            <p class="text-sm font-medium text-highlighted">{{ preview.draft.projects.length }} 段项目经历待确认</p>
            <p class="mt-1 text-xs leading-5 text-muted">应用后会显示在项目经历顶部，你可以逐条修改、确认或忽略。</p>
          </div>

          <div v-if="preview.warnings.length" class="mt-4 space-y-2">
            <p v-for="warning in preview.warnings" :key="warning" class="flex items-start gap-2 text-sm text-warning">
              <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
              <span>{{ warning }}</span>
            </p>
          </div>
        </div>

        <footer class="flex shrink-0 justify-end border-t border-default px-6 py-4">
          <UButton type="button" icon="i-lucide-check" @click="applyPreview">应用到表单</UButton>
        </footer>
      </section>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="failureDialogOpen && failedImportTask?.resumePdfImport?.error"
      class="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 px-4 py-6"
    >
      <div class="absolute inset-0" aria-hidden="true" />
      <section
        class="app-panel relative w-full max-w-lg overflow-hidden shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="resume-pdf-failure-title"
      >
        <header class="flex items-start justify-between gap-4 border-b border-default px-6 py-5">
          <div class="min-w-0">
            <h2 id="resume-pdf-failure-title" class="text-lg font-semibold text-highlighted">
              {{ failurePresentation.title }}
            </h2>
            <p class="mt-1 truncate text-sm text-muted">{{ failedImportTask.resumePdfImport.fileName }}</p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭"
            :disabled="isRetrying"
            @click="failureDialogOpen = false"
          />
        </header>

        <div class="px-6 py-5">
          <div class="flex items-start gap-3 rounded-xl border border-error/25 bg-error/8 p-4">
            <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-5 shrink-0 text-error" />
            <div class="min-w-0">
              <p class="text-sm leading-6 text-highlighted">{{ failurePresentation.description }}</p>
              <p class="mt-2 text-xs leading-5 text-muted">
                后端已经自动执行到第
                {{ failedImportTask.resumePdfImport.currentAttempt || 1 }} 次；任务最终失败后才会在这里通知你。
              </p>
            </div>
          </div>
        </div>

        <footer class="flex flex-wrap justify-end gap-2 border-t border-default px-6 py-4">
          <UButton type="button" color="neutral" variant="ghost" :disabled="isRetrying" @click="chooseAnotherPdf">
            选择其他 PDF
          </UButton>
          <UButton type="button" icon="i-lucide-refresh-cw" :loading="isRetrying" @click="retryFailedImport">
            重新识别
          </UButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
