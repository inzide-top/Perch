<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import CityPicker from '@/components/CityPicker.vue'
import {
  opportunityApi,
  type CreateOpportunityPayload,
  type ImportedOpportunityRequiredField,
  type OpportunityBatchImportItem as OpportunityBatchImportResponseItem,
  type OpportunityImportPreview,
} from '@/services/opportunities'
import type { LlmConnectionSettings } from '@/types/settings'
import type { ChatOpportunityImportResultPart } from '@/shared/chat/schemas'
import { defaultMockJobDraft, type MockJobDraft } from '../mocks/jobDraft'

type JobFormField = 'company' | 'jobTitle' | 'description'
type ImportMode = 'url' | 'text'
type BatchItemStatus = 'processing' | 'ready' | 'failed'

type BatchImportItem = {
  id: string
  sourceItemIndex: number | null
  url: string
  status: BatchItemStatus
  preview: OpportunityImportPreview | null
  draft: MockJobDraft | null
  error: string
  creationError: string
  selected: boolean
}

type BatchCreateRequest = {
  items: Array<{ id: string; sourceItemIndex: number | null; payload: CreateOpportunityPayload }>
  closeWhenDone: boolean
}

type BatchCreationOutcome = {
  revision: number
  succeededIds: string[]
  failures: Array<{ id: string; error: string }>
}

const props = defineProps<{
  open: boolean
  loading?: boolean
  modelConnection: LlmConnectionSettings
  batchCreationOutcome?: BatchCreationOutcome | null
  reviewPayload?: ChatOpportunityImportResultPart | null
  reviewRevision?: number
}>()

const emit = defineEmits<{
  close: []
  submit: [request: { payload: CreateOpportunityPayload; sourceItemIndex: number | null }]
  submitBatch: [request: BatchCreateRequest]
}>()

const mockJobDraftStorageKey = 'agent-seek-employment:mock-job-draft:v2'
let mockSavedTimer: number | null = null

const mockSavedMessage = ref('')
const importMode = ref<ImportMode>('url')
const importUrl = ref('')
const importText = ref('')
const isImporting = ref(false)
const importError = ref('')
const importResult = ref<{
  sourceLabel: string
  missingRequiredFields: ImportedOpportunityRequiredField[]
  warning: string | null
} | null>(null)
const batchItems = ref<BatchImportItem[]>([])
const activeBatchItemId = ref('')
const reviewModeActive = ref(false)
const assistantSourceItemIndex = ref<number | null>(null)
let importAbortController: AbortController | null = null
const retryAbortControllers = new Map<string, AbortController>()
const form = reactive<MockJobDraft>({
  company: '',
  jobTitle: '',
  address: [],
  introduction: '',
  description: '',
})
const errors = reactive<Record<JobFormField, string>>({
  company: '',
  jobTitle: '',
  description: '',
})

const batchReadyItems = computed(() => batchItems.value.filter((item) => item.status === 'ready' && item.draft))
const selectedBatchItems = computed(() => batchReadyItems.value.filter((item) => item.selected))
const batchFailedCount = computed(() => batchItems.value.filter((item) => item.status === 'failed').length)
const activeBatchItem = computed(
  () => batchItems.value.find((item) => item.id === activeBatchItemId.value && item.status === 'ready') ?? null,
)
const editableForm = computed(() => activeBatchItem.value?.draft ?? form)
const isFormDisabled = computed(
  () => Boolean(props.loading || isImporting.value) || (batchItems.value.length > 0 && activeBatchItem.value === null),
)
const submitLabel = computed(() =>
  batchItems.value.length > 0 ? `创建已选 ${selectedBatchItems.value.length} 条` : '确认创建',
)
const isAssistantReview = computed(() => reviewModeActive.value && Boolean(props.reviewPayload))

const requiredFieldLabels: Record<ImportedOpportunityRequiredField, string> = {
  company: '公司名称',
  jobTitle: '岗位名称',
  description: '任职要求 / 加分项',
}

function normalizeCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities
  if (typeof cities === 'string' && cities.trim()) return [cities.trim()]

  return []
}

function resetForm() {
  importAbortController?.abort()
  importAbortController = null
  for (const controller of retryAbortControllers.values()) controller.abort()
  retryAbortControllers.clear()
  Object.assign(form, { company: '', jobTitle: '', address: [], introduction: '', description: '' })
  importMode.value = 'url'
  importUrl.value = ''
  importText.value = ''
  isImporting.value = false
  importError.value = ''
  importResult.value = null
  batchItems.value = []
  activeBatchItemId.value = ''
  reviewModeActive.value = false
  assistantSourceItemIndex.value = null
  clearAllErrors()
}

function clearAllErrors() {
  errors.company = ''
  errors.jobTitle = ''
  errors.description = ''
}

function readMockJobDraft(): MockJobDraft {
  const storedDraft = localStorage.getItem(mockJobDraftStorageKey)
  if (!storedDraft) return defaultMockJobDraft

  try {
    const parsedDraft = JSON.parse(storedDraft) as MockJobDraft & { address?: string[] | string }

    return {
      ...defaultMockJobDraft,
      ...parsedDraft,
      address: normalizeCityList(parsedDraft.address),
    }
  } catch {
    return defaultMockJobDraft
  }
}

function importMockJobDraft() {
  batchItems.value = []
  activeBatchItemId.value = ''
  Object.assign(form, readMockJobDraft())
  clearAllErrors()
}

function validateImportUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseImportUrls(value: string) {
  const urls = value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[\s，,]+/))
    .map((item) => item.trim())
    .filter(Boolean)

  if (urls.length === 0) return { urls: [], error: '请至少输入一个岗位页面网址' }
  if (urls.length > 5) return { urls, error: '一次最多导入 5 个岗位网址' }
  if (urls.some((url) => !validateImportUrl(url))) {
    return { urls, error: '每一行都需要是完整的 http 或 https 网址' }
  }
  const normalizedUrls = urls.map((url) => url.replace(/\/$/, ''))
  if (new Set(normalizedUrls).size !== normalizedUrls.length) {
    return { urls, error: '输入中存在重复的岗位网址' }
  }

  return { urls, error: '' }
}

function toDraft(preview: OpportunityImportPreview): MockJobDraft {
  return {
    company: preview.company,
    jobTitle: preview.jobTitle,
    address: [...preview.address],
    introduction: preview.introduction,
    description: preview.description,
  }
}

function createProcessingBatchItem(url: string, index: number): BatchImportItem {
  return {
    id: `${Date.now()}-${index}`,
    sourceItemIndex: null,
    url,
    status: 'processing',
    preview: null,
    draft: null,
    error: '',
    creationError: '',
    selected: false,
  }
}

function applyBatchResponse(
  item: BatchImportItem,
  response: OpportunityBatchImportResponseItem,
  options: { selectOnReady?: boolean } = {},
) {
  if (response.status === 'ready') {
    item.status = 'ready'
    item.preview = response.preview
    item.draft = toDraft(response.preview)
    item.error = ''
    item.creationError = ''
    if (options.selectOnReady !== false) item.selected = true
    return
  }

  item.status = 'failed'
  item.preview = null
  item.draft = null
  item.error = response.error
  item.creationError = ''
  item.selected = false
}

async function importFromUrl() {
  const parsedInput = parseImportUrls(importUrl.value)
  if (isImporting.value || props.loading) return
  if (parsedInput.error) {
    importError.value = parsedInput.error
    importResult.value = null
    return
  }

  importAbortController?.abort()
  const controller = new AbortController()
  importAbortController = controller
  isImporting.value = true
  importError.value = ''
  importResult.value = null
  batchItems.value = parsedInput.urls.map(createProcessingBatchItem)
  activeBatchItemId.value = ''
  clearAllErrors()

  try {
    const result = await opportunityApi.importOpportunitiesFromUrls(parsedInput.urls, { signal: controller.signal })
    if (controller.signal.aborted) return

    for (const [index, responseItem] of result.items.entries()) {
      const item = batchItems.value[index]
      if (item) applyBatchResponse(item, responseItem)
    }
    activeBatchItemId.value = batchReadyItems.value[0]?.id ?? ''
    if (batchReadyItems.value.length === 0) {
      importError.value = '未识别到可用的岗位信息，可以单独重试失败项。'
    }
  } catch (error) {
    if (controller.signal.aborted) return
    importError.value = error instanceof Error ? error.message : '网页识别失败，请稍后重试'
    for (const item of batchItems.value) {
      item.status = 'failed'
      item.error = importError.value
    }
  } finally {
    if (importAbortController === controller) {
      importAbortController = null
      isImporting.value = false
    }
  }
}

async function retryBatchItem(item: BatchImportItem) {
  if (item.status === 'processing' || props.loading) return

  retryAbortControllers.get(item.id)?.abort()
  const controller = new AbortController()
  const previousDraft = item.draft ? { ...item.draft, address: [...item.draft.address] } : null
  const wasSelected = item.selected
  retryAbortControllers.set(item.id, controller)
  item.status = 'processing'
  item.error = ''
  item.creationError = ''
  importError.value = ''

  try {
    const preview = await opportunityApi.importOpportunityFromUrl(item.url, { signal: controller.signal })
    if (controller.signal.aborted) return

    applyBatchResponse(
      item,
      { url: item.url, status: 'ready', preview },
      { selectOnReady: !previousDraft || wasSelected },
    )
    activeBatchItemId.value = item.id
    clearAllErrors()
  } catch (error) {
    if (controller.signal.aborted) return
    const message = error instanceof Error ? error.message : '网页识别失败，请稍后重试'
    if (previousDraft) {
      item.status = 'ready'
      item.draft = previousDraft
      item.selected = wasSelected
      item.error = `重新识别失败，已保留原内容：${message}`
    } else {
      item.status = 'failed'
      item.error = message
      item.selected = false
    }
  } finally {
    if (retryAbortControllers.get(item.id) === controller) retryAbortControllers.delete(item.id)
  }
}

function removeBatchItem(itemId: string) {
  retryAbortControllers.get(itemId)?.abort()
  retryAbortControllers.delete(itemId)
  batchItems.value = batchItems.value.filter((item) => item.id !== itemId)
  if (activeBatchItemId.value === itemId) {
    activeBatchItemId.value = batchReadyItems.value[0]?.id ?? ''
    clearAllErrors()
  }
  if (batchItems.value.length === 0) importError.value = ''
}

function resetBatchImport() {
  for (const controller of retryAbortControllers.values()) controller.abort()
  retryAbortControllers.clear()
  batchItems.value = []
  activeBatchItemId.value = ''
  importUrl.value = ''
  importError.value = ''
  importResult.value = null
  reviewModeActive.value = false
  Object.assign(form, { company: '', jobTitle: '', address: [], introduction: '', description: '' })
  clearAllErrors()
}

function hydrateAssistantReview(payload: ChatOpportunityImportResultPart) {
  resetForm()
  reviewModeActive.value = true
  importMode.value = payload.mode === 'urls' ? 'url' : 'text'

  if (payload.mode === 'urls') {
    importUrl.value = payload.items
      .map((item) => item.sourceUrl)
      .filter((url): url is string => Boolean(url))
      .join('\n')
    batchItems.value = payload.items.flatMap((item, index): BatchImportItem[] => {
      if (item.status === 'ready' && item.createdOpportunityId) return []
      const base = {
        id: `assistant-import-${props.reviewRevision ?? 0}-${index}`,
        sourceItemIndex: index,
        url: item.sourceUrl ?? '',
        creationError: '',
      }
      if (item.status === 'ready') {
        return [
          {
            ...base,
            status: 'ready',
            preview: item.preview,
            draft: toDraft(item.preview),
            error: '',
            selected: true,
          },
        ]
      }
      return [
        {
          ...base,
          status: 'failed',
          preview: null,
          draft: null,
          error: item.error,
          selected: false,
        },
      ]
    })
    activeBatchItemId.value = batchReadyItems.value[0]?.id ?? ''
    if (batchReadyItems.value.length === 0) {
      importError.value = '这批结果没有可创建的岗位，请返回 AI 助手修改网址后重新导入。'
    }
    return
  }

  const readyItem = payload.items.find((item) => item.status === 'ready' && !item.createdOpportunityId)
  if (readyItem?.status === 'ready') {
    assistantSourceItemIndex.value = payload.items.indexOf(readyItem)
    applyImportPreview(readyItem.preview)
    return
  }

  const failedItem = payload.items.find((item) => item.status === 'failed')
  importError.value =
    failedItem?.status === 'failed' ? failedItem.error : '没有识别到可审核的岗位信息，请重新粘贴岗位文本。'
}

function selectBatchItem(item: BatchImportItem) {
  if (item.status !== 'ready') return
  activeBatchItemId.value = item.id
  clearAllErrors()
}

function toggleBatchItemSelection(item: BatchImportItem) {
  if (item.status !== 'ready') return
  item.selected = !item.selected
  item.creationError = ''
}

function setAllBatchItemsSelected(selected: boolean) {
  for (const item of batchReadyItems.value) {
    item.selected = selected
    item.creationError = ''
  }
}

function getBatchItemTitle(item: BatchImportItem) {
  if (item.draft?.company || item.draft?.jobTitle) {
    return [item.draft.company, item.draft.jobTitle].filter(Boolean).join(' · ')
  }
  try {
    return new URL(item.url).hostname
  } catch {
    return item.url
  }
}

function hasConfiguredModelConnection() {
  return Boolean(
    props.modelConnection.baseUrl.trim() &&
    props.modelConnection.modelName.trim() &&
    props.modelConnection.apiKey.trim(),
  )
}

function applyImportPreview(preview: OpportunityImportPreview) {
  batchItems.value = []
  activeBatchItemId.value = ''
  Object.assign(form, {
    company: preview.company,
    jobTitle: preview.jobTitle,
    address: [...preview.address],
    introduction: preview.introduction,
    description: preview.description,
  })
  clearAllErrors()
  importResult.value = {
    sourceLabel: preview.source.label,
    missingRequiredFields: preview.missingRequiredFields,
    warning: preview.warning,
  }
}

async function importFromText() {
  const text = importText.value.trim()
  if (isImporting.value || props.loading) return
  if (text.length < 20) {
    importError.value = '请至少粘贴 20 个字符的岗位文本'
    importResult.value = null
    return
  }
  if (!hasConfiguredModelConnection()) {
    importError.value = '请先在系统设置中完成模型连接配置，再识别岗位文本'
    importResult.value = null
    return
  }

  importAbortController?.abort()
  const controller = new AbortController()
  importAbortController = controller
  isImporting.value = true
  importError.value = ''
  importResult.value = null

  try {
    const preview = await opportunityApi.importOpportunityFromText(text, props.modelConnection, {
      signal: controller.signal,
    })
    if (controller.signal.aborted) return

    applyImportPreview(preview)
  } catch (error) {
    if (controller.signal.aborted) return
    importError.value = error instanceof Error ? error.message : '岗位文本识别失败，请稍后重试'
  } finally {
    if (importAbortController === controller) {
      importAbortController = null
      isImporting.value = false
    }
  }
}

function setImportMode(mode: ImportMode) {
  if (isImporting.value || mode === importMode.value) return

  importMode.value = mode
  importError.value = ''
  importResult.value = null
}

function validateDraft(draft: MockJobDraft, showErrors = true) {
  const nextErrors = {
    company: draft.company.trim() ? '' : '请填写公司名称',
    jobTitle: draft.jobTitle.trim() ? '' : '请填写岗位名称',
    description: draft.description.trim() ? '' : '请填写岗位要求',
  }
  if (showErrors) Object.assign(errors, nextErrors)

  return !Object.values(nextErrors).some(Boolean)
}

function validateForm() {
  return validateDraft(editableForm.value)
}

function clearError(field: JobFormField) {
  errors[field] = ''
  if (activeBatchItem.value) activeBatchItem.value.creationError = ''
}

function setCurrentJobDraftAsMockData() {
  if (!validateForm()) return

  const draft: MockJobDraft = {
    company: editableForm.value.company.trim(),
    jobTitle: editableForm.value.jobTitle.trim(),
    address: [...editableForm.value.address],
    introduction: editableForm.value.introduction.trim(),
    description: editableForm.value.description.trim(),
  }
  localStorage.setItem(mockJobDraftStorageKey, JSON.stringify(draft))
  mockSavedMessage.value = '已设为本地 mock 数据'

  if (mockSavedTimer) window.clearTimeout(mockSavedTimer)
  mockSavedTimer = window.setTimeout(() => {
    mockSavedMessage.value = ''
    mockSavedTimer = null
  }, 2500)
}

function close() {
  if (props.loading) return

  importAbortController?.abort()
  emit('close')
}

function submit() {
  if (props.loading) return

  if (batchItems.value.length > 0) {
    if (selectedBatchItems.value.length === 0) {
      importError.value = '请至少选择一条要创建的岗位。'
      return
    }

    const invalidItem = selectedBatchItems.value.find((item) => !validateDraft(item.draft!, false))
    if (invalidItem) {
      activeBatchItemId.value = invalidItem.id
      validateDraft(invalidItem.draft!)
      importError.value = '批量结果中还有必填信息未补全，请修改当前项。'
      return
    }

    emit('submitBatch', {
      items: selectedBatchItems.value.map((item) => ({
        id: item.id,
        sourceItemIndex: item.sourceItemIndex,
        payload: {
          company: item.draft!.company.trim(),
          jobTitle: item.draft!.jobTitle.trim(),
          address: [...item.draft!.address],
          introduction: item.draft!.introduction.trim(),
          description: item.draft!.description.trim(),
        },
      })),
      // 识别失败项没有参与本次创建；所有勾选的可用项都成功时可以正常关闭工作台。
      // 真正提交后发生的重复或其他创建失败，会由 batchCreationOutcome 继续保留。
      closeWhenDone: selectedBatchItems.value.length === batchReadyItems.value.length,
    })
    return
  }

  if (!validateForm()) return

  emit('submit', {
    sourceItemIndex: assistantSourceItemIndex.value,
    payload: {
      company: editableForm.value.company.trim(),
      jobTitle: editableForm.value.jobTitle.trim(),
      address: [...editableForm.value.address],
      introduction: editableForm.value.introduction.trim(),
      description: editableForm.value.description.trim(),
    },
  })
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (!isOpen && wasOpen) resetForm()
  },
)

watch(
  () => [props.open, props.reviewRevision, props.reviewPayload] as const,
  ([isOpen, , payload]) => {
    if (!isOpen || !payload) return
    hydrateAssistantReview(payload)
  },
  { immediate: true },
)

watch(
  () => props.batchCreationOutcome,
  (outcome, previousOutcome) => {
    if (!outcome || outcome.revision === previousOutcome?.revision) return

    const succeededIds = new Set(outcome.succeededIds)
    batchItems.value = batchItems.value.filter((item) => !succeededIds.has(item.id))
    for (const failure of outcome.failures) {
      const item = batchItems.value.find((candidate) => candidate.id === failure.id)
      if (item) item.creationError = failure.error
    }

    activeBatchItemId.value = batchReadyItems.value[0]?.id ?? ''
    importError.value = outcome.failures.length ? '部分岗位创建失败，已保留在列表中，可修改后重试。' : ''
    clearAllErrors()
  },
)

watch([importUrl, importText], () => {
  importError.value = ''
  if (batchItems.value.length === 0) importResult.value = null
})

onBeforeUnmount(() => {
  importAbortController?.abort()
  for (const controller of retryAbortControllers.values()) controller.abort()
})
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!loading"
    :close="false"
    :ui="{
      overlay: 'app-overlay-layer bg-black/55',
      content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-4xl overflow-hidden shadow-xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && close()"
  >
    <template #content>
      <div>
        <header class="flex items-start justify-between gap-4 border-b border-default px-6 py-5">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              {{ isAssistantReview ? '审核岗位导入结果' : '创建 JD 分析' }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{
                isAssistantReview
                  ? '核对并补全识别结果；只有点击确认后才会创建机会并启动 JD 分析。'
                  : '先保存 JD 信息，后续会基于简历版本生成结构化分析。'
              }}
            </p>
          </div>
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="loading" @click="close" />
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-6 py-5">
          <section class="mb-5 rounded-xl border border-default bg-elevated/45 p-4">
            <div class="flex items-start gap-3">
              <div
                class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <UIcon :name="importMode === 'url' ? 'i-lucide-link-2' : 'i-lucide-clipboard-paste'" class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  {{ isAssistantReview ? 'AI 助手识别结果' : '导入岗位信息' }}
                </p>
                <p class="mt-0.5 text-xs leading-5 text-muted">
                  识别结果只会填入下方表单，由你检查并确认后才会创建机会。
                </p>
              </div>
            </div>

            <div
              v-if="batchItems.length === 0 && !isAssistantReview"
              class="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted/55 p-1"
              role="tablist"
              aria-label="岗位导入方式"
            >
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-globe-2"
                class="justify-center transition-colors"
                :class="importMode === 'url' ? 'bg-default text-highlighted shadow-xs' : 'text-muted'"
                :aria-selected="importMode === 'url'"
                role="tab"
                :disabled="loading || isImporting"
                @click="setImportMode('url')"
              >
                网址导入
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-clipboard-paste"
                class="justify-center transition-colors"
                :class="importMode === 'text' ? 'bg-default text-highlighted shadow-xs' : 'text-muted'"
                :aria-selected="importMode === 'text'"
                role="tab"
                :disabled="loading || isImporting"
                @click="setImportMode('text')"
              >
                粘贴文本
              </UButton>
            </div>

            <div
              v-if="batchItems.length === 0 && importMode === 'url' && !isAssistantReview"
              class="mt-3"
              role="tabpanel"
            >
              <UTextarea
                v-model="importUrl"
                class="w-full"
                :rows="4"
                :maxlength="10240"
                autoresize
                placeholder="每行粘贴一个岗位网址，一次最多 5 个\nhttps://example.com/jobs/frontend\nhttps://example.com/jobs/web-engineer"
                :disabled="loading || isImporting"
                :aria-invalid="Boolean(importError)"
              />
              <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs text-muted">一次最多 5 条；某条失败不影响其他结果。</span>
                <UButton
                  type="button"
                  icon="i-lucide-scan-search"
                  class="shrink-0 justify-center"
                  :loading="isImporting"
                  :disabled="loading || isImporting || !importUrl.trim()"
                  @click="importFromUrl"
                >
                  {{ isImporting ? '正在批量识别' : '识别并预览' }}
                </UButton>
              </div>
            </div>

            <div v-else-if="batchItems.length === 0 && !isAssistantReview" class="mt-3" role="tabpanel">
              <UTextarea
                v-model="importText"
                class="w-full"
                :rows="6"
                :maxlength="20000"
                autoresize
                placeholder="粘贴一份岗位原文，例如公司、岗位名称、工作职责、任职要求和加分项。第一版一份文本只对应一个岗位。"
                :disabled="loading || isImporting"
                :aria-invalid="Boolean(importError)"
              />
              <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs text-muted">{{ importText.length }} / 20000</span>
                <UButton
                  type="button"
                  icon="i-lucide-scan-text"
                  class="justify-center"
                  :loading="isImporting"
                  :disabled="loading || isImporting || importText.trim().length < 20"
                  @click="importFromText"
                >
                  {{ isImporting ? '正在识别' : '识别并填入' }}
                </UButton>
              </div>
            </div>

            <div v-else-if="batchItems.length > 0" class="mt-3 space-y-2" aria-live="polite">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-muted">
                  已识别 {{ batchReadyItems.length }} / {{ batchItems.length }} 条
                  <span v-if="batchFailedCount">· {{ batchFailedCount }} 条失败</span>
                  <span v-if="batchReadyItems.length">· 已选 {{ selectedBatchItems.length }} 条</span>
                </p>
                <div class="flex items-center gap-1">
                  <UButton
                    v-if="batchReadyItems.length"
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :disabled="loading || isImporting"
                    @click="setAllBatchItemsSelected(selectedBatchItems.length !== batchReadyItems.length)"
                  >
                    {{ selectedBatchItems.length === batchReadyItems.length ? '取消全选' : '全选可用项' }}
                  </UButton>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-rotate-ccw"
                    :disabled="loading || isImporting"
                    @click="resetBatchImport"
                  >
                    重新输入
                  </UButton>
                </div>
              </div>

              <div class="max-h-52 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="item in batchItems"
                  :key="item.id"
                  class="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors"
                  :class="
                    activeBatchItemId === item.id ? 'border-primary/55 bg-primary/8' : 'border-default bg-default/70'
                  "
                >
                  <button
                    type="button"
                    class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="item.status !== 'ready' || loading"
                    :aria-label="item.selected ? '取消选择这条岗位' : '选择这条岗位'"
                    :aria-pressed="item.selected"
                    @click="toggleBatchItemSelection(item)"
                  >
                    <UIcon :name="item.selected ? 'i-lucide-square-check-big' : 'i-lucide-square'" class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 text-left"
                    :class="item.status === 'ready' ? 'cursor-pointer' : 'cursor-default'"
                    :disabled="item.status !== 'ready'"
                    @click="selectBatchItem(item)"
                  >
                    <UIcon
                      :name="
                        item.status === 'processing'
                          ? 'i-lucide-loader-circle'
                          : item.status === 'ready'
                            ? 'i-lucide-circle-check'
                            : 'i-lucide-circle-alert'
                      "
                      class="size-4 shrink-0"
                      :class="{
                        'animate-spin text-primary': item.status === 'processing',
                        'text-success': item.status === 'ready',
                        'text-error': item.status === 'failed',
                      }"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-highlighted">{{
                        getBatchItemTitle(item)
                      }}</span>
                      <span v-if="item.status === 'failed'" class="block truncate text-xs text-error">{{
                        item.error
                      }}</span>
                      <span v-else-if="item.creationError" class="block truncate text-xs text-error">{{
                        item.creationError
                      }}</span>
                      <span v-else-if="item.error" class="block truncate text-xs text-warning">{{ item.error }}</span>
                      <span v-else class="block truncate text-xs text-muted">{{ item.url }}</span>
                    </span>
                  </button>

                  <UBadge
                    v-if="item.status !== 'failed'"
                    color="neutral"
                    variant="subtle"
                    :label="item.status === 'processing' ? '识别中' : '可编辑'"
                  />
                  <UButton
                    v-if="item.status !== 'processing'"
                    type="button"
                    color="primary"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-refresh-cw"
                    :title="item.status === 'ready' ? '重新识别当前网址' : '重试当前网址'"
                    @click="retryBatchItem(item)"
                  >
                    {{ item.status === 'ready' ? '重新识别' : '重试' }}
                  </UButton>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    icon="i-lucide-x"
                    aria-label="移除这条导入结果"
                    :disabled="loading"
                    @click="removeBatchItem(item.id)"
                  />
                </div>
              </div>

              <p v-if="activeBatchItem" class="text-xs leading-5 text-muted">
                正在编辑：{{ getBatchItemTitle(activeBatchItem) }}。切换条目时已修改内容会保留。
              </p>
            </div>

            <p v-if="importError" class="mt-2 flex items-start gap-1.5 text-xs leading-5 text-error" role="alert">
              <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-3.5 shrink-0" />
              <span>{{ importError }}</span>
            </p>

            <div
              v-else-if="importResult"
              class="mt-3 rounded-lg border border-success/25 bg-success/8 px-3 py-2.5 text-xs leading-5"
              role="status"
            >
              <p class="flex items-center gap-1.5 font-medium text-success">
                <UIcon name="i-lucide-circle-check" class="size-3.5" />
                已识别并填入，请核对下方内容
              </p>
              <p class="mt-1 truncate text-muted">来源：{{ importResult.sourceLabel }}</p>
              <p v-if="importResult.missingRequiredFields.length" class="mt-1 text-muted">
                输入内容未明确提供：{{
                  importResult.missingRequiredFields.map((field) => requiredFieldLabels[field]).join('、')
                }}，请手动补充。
              </p>
              <p v-if="importResult.warning" class="mt-1 text-warning">{{ importResult.warning }}</p>
            </div>
          </section>

          <div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <UFormField label="公司名称" required>
              <UInput
                v-model="editableForm.company"
                class="w-full"
                :class="{ 'form-control-error': errors.company }"
                placeholder="例如：小红书"
                :disabled="isFormDisabled"
                @update:model-value="clearError('company')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.company ? 'text-error' : 'invisible'"
              >
                {{ errors.company || '占位' }}
              </p>
            </UFormField>

            <UFormField label="岗位名称" required>
              <UInput
                v-model="editableForm.jobTitle"
                class="w-full"
                :class="{ 'form-control-error': errors.jobTitle }"
                placeholder="例如：前端开发工程师"
                :disabled="isFormDisabled"
                @update:model-value="clearError('jobTitle')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.jobTitle ? 'text-error' : 'invisible'"
              >
                {{ errors.jobTitle || '占位' }}
              </p>
            </UFormField>
          </div>

          <div class="space-y-3">
            <UFormField label="Base 地址">
              <CityPicker
                v-model="editableForm.address"
                :max="5"
                panel-height-class="h-52"
                :disabled="isFormDisabled"
              />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>

            <UFormField label="岗位介绍 / 工作职责">
              <UTextarea
                v-model="editableForm.introduction"
                class="w-full"
                :rows="4"
                placeholder="岗位背景、团队方向、业务介绍和入职后的主要工作"
                :disabled="isFormDisabled"
              />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>

            <UFormField label="任职要求 / 加分项" required>
              <UTextarea
                v-model="editableForm.description"
                class="w-full"
                :class="{ 'form-control-error': errors.description }"
                :rows="8"
                placeholder="候选人需要具备的经验、技能、学历要求和加分项"
                :disabled="isFormDisabled"
                @update:model-value="clearError('description')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.description ? 'text-error' : 'invisible'"
              >
                {{ errors.description || '占位' }}
              </p>
            </UFormField>
          </div>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-6 py-4">
          <div v-if="batchItems.length === 0" class="flex items-center gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-file-input"
              :disabled="loading || isImporting"
              @click="importMockJobDraft"
            >
              导入 mock 数据
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-save"
              :disabled="loading || isImporting"
              @click="setCurrentJobDraftAsMockData"
            >
              设为 mock 数据
            </UButton>
            <span v-if="mockSavedMessage" class="text-xs text-muted">{{ mockSavedMessage }}</span>
          </div>

          <div class="flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="close">取消</UButton>
            <UButton
              type="button"
              icon="i-lucide-check"
              :loading="loading"
              :disabled="loading || isImporting || (batchItems.length > 0 && selectedBatchItems.length === 0)"
              @click="submit"
              >{{ submitLabel }}</UButton
            >
          </div>
        </footer>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 32px !important;
  min-height: 32px !important;
  border-color: var(--ui-border-accented);
  border-radius: calc(var(--ui-radius) * 1.5);
}
</style>
