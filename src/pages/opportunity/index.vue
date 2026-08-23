<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { getAiTaskErrorPresentation } from '@/services/ai-errors'
import { chatApi } from '@/services/chat-api'
import type { JobOpportunityStatus, OpportunityIntentionLevel } from '@/types/opportunity'
import { useOpportunityImportReviewStore, useOpportunityStore, useResumeStore, useSettingsStore } from '@/stores'
import {
  getDuplicateOpportunityConflict,
  getOpportunityInterviewHistoryConflict,
  type CreateOpportunityPayload,
  type DuplicateOpportunityConflict,
  type OpportunityInterviewHistoryConflict,
  type OpportunityListFilters,
} from '@/services/opportunities'
import { getScoreClass, type AnalysisRecommendation } from '@/shared/opportunity/analysisPresentation'
import { opportunityRegionOptions, type OpportunityRegion } from '@/shared/opportunity/geography'
import CreateOpportunityModal from './components/CreateOpportunityModal.vue'
import OpportunityFilterSelect from './components/OpportunityFilterSelect.vue'
import OpportunityListSkeleton from './components/OpportunityListSkeleton.vue'

const statusOptions: { label: string; value: JobOpportunityStatus }[] = [
  { label: '待投递', value: 'pending_apply' },
  { label: '已投递', value: 'applied' },
  { label: '笔试中', value: 'written_test' },
  { label: '面试中', value: 'interviewing' },
  { label: '已 OC', value: 'oc' },
  { label: '已 Offer', value: 'offered' },
  { label: '流程终止', value: 'closed' },
]
const statusBadgeClasses: Record<JobOpportunityStatus, string> = {
  pending_apply: 'border-[#BFBFBF]/55 bg-[#BFBFBF]/15 text-[#747474] dark:text-[#D0D0D0]',
  applied: 'border-[#5E83F5]/40 bg-[#5E83F5]/12 text-[#4169DC] dark:text-[#8FA8FF]',
  written_test: 'border-[#ffa235]/45 bg-[#ffa235]/12 text-[#C66F00] dark:text-[#FFB85C]',
  interviewing: 'border-[#8A5EED]/40 bg-[#8A5EED]/12 text-[#7042D6] dark:text-[#B69AFF]',
  oc: 'border-[#fdd845]/55 bg-[#fdd845]/14 text-[#8A7200] dark:text-[#FFE46D]',
  offered: 'border-[#22C55E]/40 bg-[#22C55E]/12 text-[#168A42] dark:text-[#67E08D]',
  closed: 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#D23434] dark:text-[#FF7B7B]',
}
const intentionOptions: Array<{ label: string; value: OpportunityIntentionLevel }> = [
  { label: 'S · 高优先级', value: 'S' },
  { label: 'A · 优先跟进', value: 'A' },
  { label: 'B · 常规关注', value: 'B' },
  { label: 'C · 低优先级', value: 'C' },
]
const recommendationOptions: Array<{ label: string; value: AnalysisRecommendation }> = [
  { label: '强匹配', value: 'strong_match' },
  { label: '值得投递', value: 'worth_trying' },
  { label: '谨慎投递', value: 'risky' },
  { label: '不建议', value: 'not_recommended' },
]

const opportunityStore = useOpportunityStore()
const opportunityImportReviewStore = useOpportunityImportReviewStore()
const resumeStore = useResumeStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { opportunities, analysisTasks, isInitialLoading, isRefreshing, loadError } = storeToRefs(opportunityStore)
const isFiltering = ref(false)

const selectedStatus = ref<JobOpportunityStatus | ''>('')
const selectedIntentionLevel = ref<OpportunityIntentionLevel | ''>('')
const routeStatusFilters = ref<JobOpportunityStatus[]>([])
const routeIntentionFilters = ref<OpportunityIntentionLevel[]>([])
let isApplyingRouteFilters = false
const selectedRecommendation = ref<AnalysisRecommendation | ''>('')
const selectedRegion = ref<OpportunityRegion | ''>('')
const isCreateModalOpen = ref(false)
const isCreatingOpportunity = ref(false)
const retryingOpportunityId = ref<string | null>(null)
const deleteOpportunityId = ref<string | null>(null)
const isDeletingOpportunity = ref(false)
const interviewHistoryConflict = ref<(OpportunityInterviewHistoryConflict & { opportunityId: string }) | null>(null)
const isArchivingInterviewsAndDeleting = ref(false)
const isSelectionMode = ref(false)
const selectedOpportunityIds = ref<string[]>([])
const isBatchDeleteConfirmOpen = ref(false)
const isBatchDeleting = ref(false)
const duplicateOpportunityConflict = ref<DuplicateOpportunityConflict | null>(null)
const isResolvingDuplicateOpportunity = ref(false)
const batchCreationOutcome = ref<{
  revision: number
  succeededIds: string[]
  failures: Array<{ id: string; error: string }>
} | null>(null)
let batchCreationRevision = 0
const detailPrefetchTimers = new Map<string, number>()
let filterDebounceTimer: number | null = null
let filterRequestSequence = 0

const listFilters = computed(() => {
  return {
    statuses:
      routeStatusFilters.value.length > 1
        ? routeStatusFilters.value
        : selectedStatus.value
          ? [selectedStatus.value]
          : [],
    intentionLevels:
      routeIntentionFilters.value.length > 1
        ? routeIntentionFilters.value
        : selectedIntentionLevel.value
          ? [selectedIntentionLevel.value]
          : [],
    recommendations: selectedRecommendation.value ? [selectedRecommendation.value] : [],
    regions: selectedRegion.value ? [selectedRegion.value] : [],
  }
})
const isListBootstrapping = ref(!opportunityStore.isOpportunityListFresh(listFilters.value))
const showListSkeleton = computed(() => isListBootstrapping.value || isInitialLoading.value || isRefreshing.value)
const hasActiveListFilters = computed(() => {
  return Object.values(listFilters.value).some((values) => values.length > 0)
})
const filteredOpportunities = computed(() => opportunities.value)
const deleteTargetOpportunity = computed(() => {
  return opportunities.value.find((opportunity) => opportunity.id === deleteOpportunityId.value) ?? null
})
const conflictTargetOpportunity = computed(() => {
  const opportunityId = interviewHistoryConflict.value?.opportunityId
  return opportunityId ? (opportunities.value.find((opportunity) => opportunity.id === opportunityId) ?? null) : null
})
const selectedOpportunityCount = computed(() => selectedOpportunityIds.value.length)

function isOpportunitySelected(opportunityId: string) {
  return selectedOpportunityIds.value.includes(opportunityId)
}

function toggleOpportunitySelection(opportunityId: string) {
  selectedOpportunityIds.value = isOpportunitySelected(opportunityId)
    ? selectedOpportunityIds.value.filter((id) => id !== opportunityId)
    : [...selectedOpportunityIds.value, opportunityId]
}

function toggleSelectionMode() {
  isSelectionMode.value = !isSelectionMode.value
  if (!isSelectionMode.value) selectedOpportunityIds.value = []
}

function toggleSelectAllVisible() {
  const visibleIds = filteredOpportunities.value.map((opportunity) => opportunity.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => isOpportunitySelected(id))
  selectedOpportunityIds.value = allSelected ? [] : visibleIds
}

function openCreateModal() {
  opportunityImportReviewStore.clear()
  batchCreationOutcome.value = null
  isCreateModalOpen.value = true
}

function closeCreateModal() {
  isCreateModalOpen.value = false
  opportunityImportReviewStore.clear()
}

watch(
  () => opportunityImportReviewStore.revision,
  () => {
    if (!opportunityImportReviewStore.payload) return
    batchCreationOutcome.value = null
    isCreateModalOpen.value = true
  },
  { immediate: true },
)

async function resolveResumeAnalysisContext() {
  if (!resumeStore.currentResume || !resumeStore.currentVersion) {
    await resumeStore.loadFromApi()
  }

  const resume = resumeStore.currentResume
  const version =
    resumeStore.currentVersion ??
    resumeStore.versions.find((candidate) => candidate.id === resume?.currentVersionId) ??
    null

  if (resume && version) return { resume, version }

  if (resumeStore.loadError) {
    toast.add({
      title: '简历信息读取失败',
      description: resumeStore.loadError,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return null
  }

  toast.add({
    title: resume ? '当前简历还没有可用版本' : '请先创建并保存一份简历',
    description: resume ? '请先在简历管理中保存一个版本，再生成 JD 分析。' : undefined,
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
  return null
}

async function persistAssistantImportCompletion(items: Array<{ itemIndex: number; opportunityId: string }>) {
  const messageId = opportunityImportReviewStore.sourceMessageId
  if (!messageId || items.length === 0) return

  opportunityImportReviewStore.markCreated(messageId, items)
  try {
    await chatApi.completeOpportunityImportItems(messageId, items)
  } catch (error) {
    toast.add({
      title: '机会已创建，但聊天卡片状态同步失败',
      description: error instanceof Error ? error.message : '重新打开对话前可稍后再试。',
      color: 'warning',
      icon: 'i-lucide-refresh-cw',
    })
  }
}

async function createOpportunity(request: { payload: CreateOpportunityPayload; sourceItemIndex: number | null }) {
  if (isCreatingOpportunity.value) return

  if (!settingsStore.llm.apiKey.trim()) {
    toast.add({ title: '请先在系统设置中填写 API Key', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }

  isCreatingOpportunity.value = true
  try {
    const resumeContext = await resolveResumeAnalysisContext()
    if (!resumeContext) return
    const { resume: currentResume, version: currentVersion } = resumeContext

    const opportunity = await opportunityStore.createOpportunity(request.payload)
    const task = await opportunityStore.startJobAnalysis(opportunity.id, {
      resumeId: currentResume.id,
      resumeVersionId: currentVersion.id,
      modelConnection: settingsStore.llm,
    })
    if (request.sourceItemIndex !== null) {
      await persistAssistantImportCompletion([{ itemIndex: request.sourceItemIndex, opportunityId: opportunity.id }])
    }
    closeCreateModal()
    await nextTick()
    opportunityStore.publishCreatedOpportunity(opportunity, task)
    toast.add({ title: 'JD 已创建，正在生成分析', color: 'success', icon: 'i-lucide-wand-sparkles' })
  } catch (error) {
    const duplicateConflict = getDuplicateOpportunityConflict(error)
    if (duplicateConflict) {
      duplicateOpportunityConflict.value = duplicateConflict
      return
    }

    toast.add({
      title: '创建 JD 分析失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    isCreatingOpportunity.value = false
  }
}

async function createOpportunities(request: {
  items: Array<{ id: string; sourceItemIndex: number | null; payload: CreateOpportunityPayload }>
  closeWhenDone: boolean
}) {
  if (isCreatingOpportunity.value || request.items.length === 0) return

  if (!settingsStore.llm.apiKey.trim()) {
    toast.add({ title: '请先在系统设置中填写 API Key', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }

  isCreatingOpportunity.value = true
  try {
    const resumeContext = await resolveResumeAnalysisContext()
    if (!resumeContext) return
    const { resume: currentResume, version: currentVersion } = resumeContext

    const activeAnalysisCount = analysisTasks.value.filter(
      (task) => task.status === 'pending' || task.status === 'processing',
    ).length
    const availableAnalysisSlots = Math.max(0, 5 - activeAnalysisCount)
    if (request.items.length > availableAnalysisSlots) {
      toast.add({
        title: '当前 JD 分析并发额度不足',
        description:
          availableAnalysisSlots > 0
            ? `当前还可启动 ${availableAnalysisSlots} 个分析任务，请移除部分岗位或等待已有任务完成。`
            : '当前已有 5 个 JD 分析任务正在执行，请稍后再批量创建。',
        color: 'warning',
        icon: 'i-lucide-circle-alert',
      })
      return
    }

    const results = await Promise.allSettled(
      request.items.map(async (item) => {
        const opportunity = await opportunityStore.createOpportunity(item.payload)
        const task = await opportunityStore.startJobAnalysis(opportunity.id, {
          resumeId: currentResume.id,
          resumeVersionId: currentVersion.id,
          modelConnection: settingsStore.llm,
        })
        return { id: item.id, sourceItemIndex: item.sourceItemIndex, opportunity, task }
      }),
    )

    const succeededIds: string[] = []
    const completedImportItems: Array<{ itemIndex: number; opportunityId: string }> = []
    const failures: Array<{ id: string; error: string }> = []
    for (const [index, result] of results.entries()) {
      const requestItem = request.items[index]
      if (!requestItem) continue

      if (result.status === 'fulfilled') {
        succeededIds.push(result.value.id)
        if (result.value.sourceItemIndex !== null) {
          completedImportItems.push({
            itemIndex: result.value.sourceItemIndex,
            opportunityId: result.value.opportunity.id,
          })
        }
        opportunityStore.publishCreatedOpportunity(result.value.opportunity, result.value.task)
      } else {
        failures.push({
          id: requestItem.id,
          error: result.reason instanceof Error ? result.reason.message : '创建失败，请稍后重试',
        })
      }
    }

    await persistAssistantImportCompletion(completedImportItems)

    if (request.closeWhenDone && failures.length === 0) {
      closeCreateModal()
      await nextTick()
    } else {
      batchCreationRevision += 1
      batchCreationOutcome.value = {
        revision: batchCreationRevision,
        succeededIds,
        failures,
      }
    }

    if (failures.length === 0) {
      toast.add({
        title: `已创建 ${succeededIds.length} 条 JD，正在生成分析`,
        color: 'success',
        icon: 'i-lucide-wand-sparkles',
      })
      return
    }

    toast.add({
      title:
        succeededIds.length > 0 ? `已创建 ${succeededIds.length} 条，${failures.length} 条失败` : '批量创建 JD 失败',
      description: failures[0]?.error ?? '请检查失败项后重试。',
      color: succeededIds.length > 0 ? 'warning' : 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    isCreatingOpportunity.value = false
  }
}

function getAnalysisStatusLabel(
  status: DuplicateOpportunityConflict['details']['existingOpportunity']['analysisStatus'],
) {
  const map = {
    pending: '等待分析',
    processing: '分析中',
    completed: '已有分析结果',
    failed: '分析失败',
  } as const

  return status ? map[status] : '尚未分析'
}

function isDuplicateAnalysisActive(
  status: DuplicateOpportunityConflict['details']['existingOpportunity']['analysisStatus'],
) {
  return status === 'pending' || status === 'processing'
}

function hasCompletedDuplicateAnalysis(
  status: DuplicateOpportunityConflict['details']['existingOpportunity']['analysisStatus'],
) {
  return status === 'completed'
}

function closeDuplicateOpportunityDialog() {
  if (isResolvingDuplicateOpportunity.value) return

  duplicateOpportunityConflict.value = null
  closeCreateModal()
}

async function openDuplicateOpportunityDetail() {
  const existingOpportunity = duplicateOpportunityConflict.value?.details.existingOpportunity
  if (!existingOpportunity || isResolvingDuplicateOpportunity.value) return

  isResolvingDuplicateOpportunity.value = true
  try {
    duplicateOpportunityConflict.value = null
    closeCreateModal()
    opportunityStore.selectOpportunity(existingOpportunity.id)
    await router.push({ name: 'opportunity-detail', params: { id: existingOpportunity.id } })
  } catch (error) {
    toast.add({
      title: '打开已有 JD 失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    isResolvingDuplicateOpportunity.value = false
  }
}

async function forceAnalyzeDuplicateOpportunity() {
  const existingOpportunity = duplicateOpportunityConflict.value?.details.existingOpportunity
  if (!existingOpportunity || isResolvingDuplicateOpportunity.value) return

  if (isDuplicateAnalysisActive(existingOpportunity.analysisStatus)) return

  isResolvingDuplicateOpportunity.value = true
  try {
    const hasStarted = await retryJobAnalysis(existingOpportunity.id)
    if (hasStarted) {
      duplicateOpportunityConflict.value = null
      closeCreateModal()
    }
  } finally {
    isResolvingDuplicateOpportunity.value = false
  }
}

function getOpportunityAnalysisTask(opportunityId: string) {
  return analysisTasks.value.find((task) => task.opportunityId === opportunityId) ?? null
}

function getAnalysisFailurePresentation(opportunityId: string) {
  return getAiTaskErrorPresentation(getOpportunityAnalysisTask(opportunityId)?.error)
}

function isAnalysisStarting(opportunityId: string) {
  return retryingOpportunityId.value === opportunityId
}

function isAnalysisActive(opportunityId: string) {
  const task = getOpportunityAnalysisTask(opportunityId)
  return isAnalysisStarting(opportunityId) || task?.status === 'pending' || task?.status === 'processing'
}

function isAnalysisCompleted(opportunityId: string) {
  return !isAnalysisStarting(opportunityId) && getOpportunityAnalysisTask(opportunityId)?.status === 'completed'
}

function getOpportunityActionItems(opportunityId: string) {
  const isActionLocked = Boolean(
    retryingOpportunityId.value || isDeletingOpportunity.value || deleteOpportunityId.value,
  )

  return [
    [
      {
        label: '重新分析',
        icon: 'i-lucide-rotate-cw',
        disabled: isAnalysisActive(opportunityId) || isActionLocked,
        onSelect: () => void retryJobAnalysis(opportunityId),
      },
    ],
    [
      {
        label: '删除 JD',
        icon: 'i-lucide-trash-2',
        color: 'error',
        disabled: isActionLocked,
        onSelect: () => openDeleteOpportunityConfirm(opportunityId),
      },
    ],
  ]
}

async function retryJobAnalysis(opportunityId: string) {
  if (retryingOpportunityId.value) return false

  if (!settingsStore.llm.apiKey.trim()) {
    toast.add({ title: '请先在系统设置中填写 API Key', color: 'error', icon: 'i-lucide-circle-alert' })
    return false
  }

  retryingOpportunityId.value = opportunityId
  try {
    const resumeContext = await resolveResumeAnalysisContext()
    if (!resumeContext) return false
    const { resume: currentResume, version: currentVersion } = resumeContext

    await opportunityStore.retryJobAnalysis(opportunityId, {
      resumeId: currentResume.id,
      resumeVersionId: currentVersion.id,
      modelConnection: settingsStore.llm,
    })
    toast.add({ title: '已重新启动 JD 分析', color: 'success', icon: 'i-lucide-rotate-cw' })
    return true
  } catch (error) {
    toast.add({
      title: '重新分析失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return false
  } finally {
    retryingOpportunityId.value = null
  }
}

function openDeleteOpportunityConfirm(opportunityId: string) {
  if (isDeletingOpportunity.value) return

  deleteOpportunityId.value = opportunityId
}

function closeDeleteOpportunityConfirm() {
  if (isDeletingOpportunity.value) return

  deleteOpportunityId.value = null
}

async function confirmDeleteOpportunity() {
  const opportunityId = deleteOpportunityId.value
  if (!opportunityId || isDeletingOpportunity.value) return

  isDeletingOpportunity.value = true
  try {
    await opportunityStore.deleteOpportunity(opportunityId)
    deleteOpportunityId.value = null
    toast.add({ title: 'JD 已删除', color: 'success', icon: 'i-lucide-trash-2' })
  } catch (error) {
    const conflict = getOpportunityInterviewHistoryConflict(error)
    if (conflict) {
      deleteOpportunityId.value = null
      interviewHistoryConflict.value = { ...conflict, opportunityId }
      return
    }
    toast.add({
      title: '删除 JD 失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    isDeletingOpportunity.value = false
  }
}

function closeInterviewHistoryConflict() {
  if (isArchivingInterviewsAndDeleting.value) return
  interviewHistoryConflict.value = null
}

function openConflictOpportunityInterviews() {
  const opportunityId = interviewHistoryConflict.value?.opportunityId
  if (!opportunityId || isArchivingInterviewsAndDeleting.value) return
  interviewHistoryConflict.value = null
  void router.push({ name: 'opportunity-detail', params: { id: opportunityId }, query: { section: 'mock-interview' } })
}

async function confirmArchiveInterviewsAndDeleteOpportunity() {
  const conflict = interviewHistoryConflict.value
  if (!conflict || conflict.details.blockingCount > 0 || isArchivingInterviewsAndDeleting.value) return

  isArchivingInterviewsAndDeleting.value = true
  try {
    const result = await opportunityStore.archiveInterviewsAndDeleteOpportunity(conflict.opportunityId)
    interviewHistoryConflict.value = null
    toast.add({
      title: '机会已删除',
      description: `已归档 ${result.archivedSessionCount} 场模拟面试，能力证据继续保留。`,
      color: 'success',
      icon: 'i-lucide-archive-check',
    })
  } catch (error) {
    const latestConflict = getOpportunityInterviewHistoryConflict(error)
    if (latestConflict) {
      interviewHistoryConflict.value = { ...latestConflict, opportunityId: conflict.opportunityId }
    }
    toast.add({
      title: '归档并删除失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    isArchivingInterviewsAndDeleting.value = false
  }
}

async function confirmBatchDeleteOpportunities() {
  if (selectedOpportunityIds.value.length === 0 || isBatchDeleting.value) return
  isBatchDeleting.value = true
  try {
    const result = await opportunityStore.batchDeleteOpportunities(selectedOpportunityIds.value)
    selectedOpportunityIds.value = result.failures.map((failure) => failure.opportunityId)
    isBatchDeleteConfirmOpen.value = false

    if (result.deletedIds.length > 0) {
      toast.add({
        title: `已删除 ${result.deletedIds.length} 条机会`,
        description: result.failures.length
          ? `${result.failures.length} 条未删除：${result.failures[0]?.reason ?? '请检查关联数据。'}`
          : undefined,
        color: result.failures.length ? 'warning' : 'success',
        icon: result.failures.length ? 'i-lucide-circle-alert' : 'i-lucide-trash-2',
      })
    } else {
      toast.add({
        title: '没有机会被删除',
        description: result.failures[0]?.reason ?? '请先处理关联的模拟面试。',
        color: 'warning',
        icon: 'i-lucide-circle-alert',
      })
    }
  } catch (error) {
    toast.add({
      title: '批量删除失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    isBatchDeleting.value = false
  }
}

function formatCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities.length ? cities.join('、') : ''
  return cities ?? ''
}

function getOpportunityStatusLabel(status: JobOpportunityStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status
}

function getBlockingInterviewStatusSummary(statuses: string[]) {
  const labels: Record<string, string> = {
    preparing: '准备中',
    active: '进行中',
    finalizing: '生成复盘中',
  }
  return [...new Set(statuses)].map((status) => labels[status] ?? status).join('、')
}

function openOpportunityDetail(opportunityId: string) {
  if (isSelectionMode.value) {
    toggleOpportunitySelection(opportunityId)
    return
  }
  if (!isAnalysisCompleted(opportunityId)) return

  opportunityStore.selectOpportunity(opportunityId)
  void router.push({ name: 'opportunity-detail', params: { id: opportunityId } })
}

function scheduleOpportunityDetailPrefetch(opportunityId: string) {
  if (!isAnalysisCompleted(opportunityId) || opportunityStore.isOpportunityDetailFresh(opportunityId)) return
  if (detailPrefetchTimers.has(opportunityId)) return

  const timer = window.setTimeout(() => {
    detailPrefetchTimers.delete(opportunityId)
    void opportunityStore.loadOpportunityDetail(opportunityId, { silent: true })
  }, 350)

  detailPrefetchTimers.set(opportunityId, timer)
}

function cancelOpportunityDetailPrefetch(opportunityId: string) {
  const timer = detailPrefetchTimers.get(opportunityId)
  if (!timer) return

  window.clearTimeout(timer)
  detailPrefetchTimers.delete(opportunityId)
}

function scheduleFilteredOpportunityLoad(filters: OpportunityListFilters) {
  filterRequestSequence += 1
  const requestSequence = filterRequestSequence
  isFiltering.value = true

  if (filterDebounceTimer !== null) window.clearTimeout(filterDebounceTimer)
  filterDebounceTimer = window.setTimeout(async () => {
    filterDebounceTimer = null
    try {
      await opportunityStore.loadOpportunities({ force: true, filters })
    } finally {
      if (requestSequence === filterRequestSequence) isFiltering.value = false
    }
  }, 220)
}

function applyOpportunityRouteFilters() {
  const readQueryList = (value: unknown) => {
    if (typeof value === 'string')
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return []
  }

  const statusValues = readQueryList(route.query.statuses ?? route.query.status).filter(
    (value): value is JobOpportunityStatus => statusOptions.some((option) => option.value === value),
  )
  const intentionValues = readQueryList(route.query.intentions ?? route.query.intention).filter(
    (value): value is OpportunityIntentionLevel => intentionOptions.some((option) => option.value === value),
  )

  isApplyingRouteFilters = true
  routeStatusFilters.value = statusValues
  routeIntentionFilters.value = intentionValues
  selectedStatus.value = statusValues.length === 1 ? statusValues[0]! : ''
  selectedIntentionLevel.value = intentionValues.length === 1 ? intentionValues[0]! : ''
  isApplyingRouteFilters = false
}

onMounted(async () => {
  applyOpportunityRouteFilters()
  try {
    await opportunityStore.loadOpportunities({ filters: listFilters.value })
  } finally {
    isListBootstrapping.value = false
  }
})

watch(
  () => [route.query.status, route.query.statuses, route.query.intention, route.query.intentions],
  () => applyOpportunityRouteFilters(),
)

watch(selectedStatus, () => {
  if (!isApplyingRouteFilters && routeStatusFilters.value.length > 1) routeStatusFilters.value = []
})

watch(selectedIntentionLevel, () => {
  if (!isApplyingRouteFilters && routeIntentionFilters.value.length > 1) routeIntentionFilters.value = []
})

onBeforeUnmount(() => {
  for (const timer of detailPrefetchTimers.values()) {
    window.clearTimeout(timer)
  }
  detailPrefetchTimers.clear()
  if (filterDebounceTimer !== null) window.clearTimeout(filterDebounceTimer)
})

watch(listFilters, (filters) => {
  scheduleFilteredOpportunityLoad(filters)
})

watch(
  () => opportunityStore.opportunityMutationRevision,
  () => scheduleFilteredOpportunityLoad(listFilters.value),
)
</script>

<template>
  <section class="w-full">
    <UCard
      v-if="!loadError && !isInitialLoading && opportunities.length === 0 && !hasActiveListFilters"
      class="app-empty-state flex min-h-[calc(100vh-8rem)] items-center justify-center"
    >
      <div class="w-full max-w-lg px-6 py-14 text-center">
        <div
          class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent-strong)]"
        >
          <UIcon name="i-lucide-briefcase-business" class="size-6 text-muted" />
        </div>
        <p class="mt-4 text-sm font-medium text-highlighted">还没有机会记录</p>
        <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          创建一条 JD 后，系统会先生成机会记录，并进入分析流程。后续 AI 会基于岗位要求和你的简历版本生成结构化分析结果。
        </p>
        <UButton class="mt-5 whitespace-nowrap" icon="i-lucide-plus" @click="openCreateModal"> 创建第一条 JD </UButton>
        <UButton
          class="mt-5 ml-2 whitespace-nowrap"
          color="neutral"
          variant="outline"
          icon="i-lucide-archive"
          @click="router.push({ name: 'archived-interviews' })"
        >
          已归档模拟面试
        </UButton>
      </div>
    </UCard>

    <div v-else class="space-y-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">机会管理</h1>
          <p class="mt-1 text-sm text-muted">统一维护 JD、分析状态和后续投递流程。</p>
        </div>
        <div class="flex items-center gap-3">
          <span v-if="isRefreshing" class="inline-flex items-center gap-1.5 text-xs text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            正在同步
          </span>
          <UButton
            color="neutral"
            variant="ghost"
            class="whitespace-nowrap"
            icon="i-lucide-archive"
            @click="router.push({ name: 'archived-interviews' })"
          >
            归档面试
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            class="whitespace-nowrap"
            :icon="isSelectionMode ? 'i-lucide-x' : 'i-lucide-list-checks'"
            @click="toggleSelectionMode"
          >
            {{ isSelectionMode ? '退出多选' : '多选' }}
          </UButton>
          <UButton icon="i-lucide-plus" class="whitespace-nowrap" @click="openCreateModal"> 新增 JD 分析 </UButton>
        </div>
      </div>

      <section v-if="isSelectionMode" class="app-toolbar flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div class="flex items-center gap-3 text-sm">
          <span class="font-medium text-highlighted">已选择 {{ selectedOpportunityCount }} 条</span>
          <UButton type="button" color="neutral" variant="link" size="sm" @click="toggleSelectAllVisible">
            {{
              filteredOpportunities.length > 0 && selectedOpportunityCount === filteredOpportunities.length
                ? '取消全选'
                : '全选当前列表'
            }}
          </UButton>
        </div>
        <UButton
          type="button"
          color="error"
          size="sm"
          icon="i-lucide-trash-2"
          :disabled="selectedOpportunityCount === 0"
          @click="isBatchDeleteConfirmOpen = true"
        >
          批量删除
        </UButton>
      </section>

      <section class="opportunity-filter-container app-toolbar p-4">
        <div class="opportunity-filter-grid">
          <OpportunityFilterSelect v-model="selectedStatus" label="流程状态" :options="statusOptions" />
          <OpportunityFilterSelect v-model="selectedIntentionLevel" label="意向等级" :options="intentionOptions" />
          <OpportunityFilterSelect v-model="selectedRecommendation" label="匹配结论" :options="recommendationOptions" />
          <OpportunityFilterSelect v-model="selectedRegion" label="所在地域" :options="opportunityRegionOptions" />
        </div>
      </section>

      <div class="min-h-[20rem]" aria-live="polite">
        <div
          v-if="loadError && !isInitialLoading"
          class="app-panel-muted flex min-h-[20rem] flex-col items-center justify-center p-10 text-center"
        >
          <span class="flex size-10 items-center justify-center rounded-2xl bg-error/10 text-error">
            <UIcon name="i-lucide-circle-alert" class="size-5" aria-hidden="true" />
          </span>
          <p class="mt-4 text-sm font-medium text-highlighted">机会列表加载失败</p>
          <p class="mt-2 max-w-md text-sm leading-6 text-muted">{{ loadError }}</p>
          <UButton
            class="mt-5"
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            @click="opportunityStore.loadOpportunities({ force: true, filters: listFilters })"
          >
            重新加载列表
          </UButton>
        </div>

        <OpportunityListSkeleton v-else-if="showListSkeleton || isFiltering" />

        <div v-else-if="filteredOpportunities.length === 0" class="app-panel-muted p-10 text-center">
          <p class="text-sm text-muted">当前筛选条件下没有机会记录。</p>
        </div>

        <div v-else class="space-y-3">
          <article
            v-for="opportunity in filteredOpportunities"
            :key="opportunity.id"
            class="app-card flex items-center gap-4 p-4"
            :class="{
              'app-card-interactive': isAnalysisCompleted(opportunity.id),
              'ring-2 ring-primary/50': isOpportunitySelected(opportunity.id),
            }"
            :role="isSelectionMode ? 'checkbox' : isAnalysisCompleted(opportunity.id) ? 'link' : undefined"
            :tabindex="isSelectionMode || isAnalysisCompleted(opportunity.id) ? 0 : undefined"
            :aria-checked="isSelectionMode ? isOpportunitySelected(opportunity.id) : undefined"
            :aria-label="
              isAnalysisCompleted(opportunity.id)
                ? `进入 ${opportunity.company} ${opportunity.jobTitle} 分析详情`
                : `${opportunity.company} ${opportunity.jobTitle} 正在等待分析结果`
            "
            @click="openOpportunityDetail(opportunity.id)"
            @keydown.enter.prevent="openOpportunityDetail(opportunity.id)"
            @keydown.space.prevent="openOpportunityDetail(opportunity.id)"
            @mouseenter="scheduleOpportunityDetailPrefetch(opportunity.id)"
            @mouseleave="cancelOpportunityDetailPrefetch(opportunity.id)"
          >
            <button
              v-if="isSelectionMode"
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-highlighted"
              :aria-label="isOpportunitySelected(opportunity.id) ? '取消选择这条机会' : '选择这条机会'"
              :aria-pressed="isOpportunitySelected(opportunity.id)"
              @click.stop="toggleOpportunitySelection(opportunity.id)"
            >
              <UIcon
                :name="isOpportunitySelected(opportunity.id) ? 'i-lucide-square-check-big' : 'i-lucide-square'"
                class="size-5"
                :class="isOpportunitySelected(opportunity.id) ? 'text-primary' : ''"
              />
            </button>
            <div
              v-if="isAnalysisCompleted(opportunity.id)"
              class="opportunity-card-main flex min-w-0 flex-1 items-center gap-3"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-md border border-default bg-elevated text-muted"
                aria-hidden="true"
              >
                <UIcon name="i-lucide-building-2" class="size-4" />
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate text-base font-semibold text-highlighted">{{ opportunity.company }}</h2>
                  <UBadge
                    v-if="formatCityList(opportunity.address)"
                    color="neutral"
                    variant="subtle"
                    :label="formatCityList(opportunity.address)"
                  />
                  <span
                    class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
                    :class="statusBadgeClasses[opportunity.status]"
                  >
                    {{ getOpportunityStatusLabel(opportunity.status) }}
                  </span>
                </div>
                <p class="mt-1 truncate text-sm text-muted">{{ opportunity.jobTitle }}</p>
              </div>
            </div>

            <div
              v-else
              class="flex min-w-0 flex-1 items-center gap-3"
              :aria-label="`${opportunity.company} ${opportunity.jobTitle} 正在等待分析结果`"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-md border border-default bg-elevated text-muted"
                aria-hidden="true"
              >
                <UIcon name="i-lucide-building-2" class="size-4" />
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate text-base font-semibold text-highlighted">{{ opportunity.company }}</h2>
                  <UBadge
                    v-if="formatCityList(opportunity.address)"
                    color="neutral"
                    variant="subtle"
                    :label="formatCityList(opportunity.address)"
                  />
                  <span
                    class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
                    :class="statusBadgeClasses[opportunity.status]"
                  >
                    {{ getOpportunityStatusLabel(opportunity.status) }}
                  </span>
                </div>
                <p class="mt-1 truncate text-sm text-muted">{{ opportunity.jobTitle }}</p>
              </div>
            </div>

            <div class="opportunity-card-status flex w-[12.5rem] shrink-0 items-center justify-end gap-3">
              <UDropdownMenu
                v-if="!isSelectionMode"
                :items="getOpportunityActionItems(opportunity.id)"
                :content="{ align: 'end', sideOffset: 8 }"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  square
                  icon="i-lucide-ellipsis"
                  title="更多操作"
                  aria-label="更多操作"
                  :disabled="isDeletingOpportunity || retryingOpportunityId !== null"
                  @click.stop
                  @keydown.stop
                />
              </UDropdownMenu>
              <div
                v-if="opportunity.status !== 'closed' && isAnalysisCompleted(opportunity.id)"
                class="app-match-score-badge flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                :class="getScoreClass(getOpportunityAnalysisTask(opportunity.id)?.matchScore ?? 0)"
              >
                <UIcon name="i-lucide-wand-sparkles" class="app-score-icon size-3.5" />
                <span
                  class="app-score-text text-xs"
                  :class="getScoreClass(getOpportunityAnalysisTask(opportunity.id)?.matchScore ?? 0)"
                >
                  匹配度
                </span>
                <span
                  class="app-score-text font-semibold"
                  :class="getScoreClass(getOpportunityAnalysisTask(opportunity.id)?.matchScore ?? 0)"
                >
                  {{ getOpportunityAnalysisTask(opportunity.id)?.matchScore }}
                </span>
              </div>
              <div
                v-else-if="isAnalysisActive(opportunity.id)"
                class="rounded-xl border border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_82%,transparent)] px-3 py-2 text-sm text-muted"
              >
                <span class="inline-flex items-center gap-1.5">
                  <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
                  {{ isAnalysisStarting(opportunity.id) ? '正在启动分析' : '分析中' }}
                </span>
              </div>
              <div
                v-else-if="getOpportunityAnalysisTask(opportunity.id)?.status === 'failed'"
                class="flex items-center gap-2"
              >
                <span
                  class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
                  :title="getAnalysisFailurePresentation(opportunity.id).description"
                >
                  {{ getAnalysisFailurePresentation(opportunity.id).title }} · 已尝试
                  {{ getOpportunityAnalysisTask(opportunity.id)?.currentAttempt ?? 1 }}/
                  {{ getOpportunityAnalysisTask(opportunity.id)?.maxAttempts ?? 3 }} 次
                </span>
                <UButton
                  :color="getAnalysisFailurePresentation(opportunity.id).requiresModelAttention ? 'warning' : 'error'"
                  variant="soft"
                  size="sm"
                  square
                  :icon="
                    getAnalysisFailurePresentation(opportunity.id).requiresModelAttention
                      ? 'i-lucide-settings'
                      : 'i-lucide-rotate-cw'
                  "
                  :title="
                    getAnalysisFailurePresentation(opportunity.id).requiresModelAttention ? '检查模型配置' : '重新分析'
                  "
                  :aria-label="
                    getAnalysisFailurePresentation(opportunity.id).requiresModelAttention ? '检查模型配置' : '重新分析'
                  "
                  :loading="retryingOpportunityId === opportunity.id"
                  :disabled="retryingOpportunityId !== null || deleteOpportunityId !== null"
                  @click.stop="
                    getAnalysisFailurePresentation(opportunity.id).requiresModelAttention
                      ? router.push('/settings')
                      : retryJobAnalysis(opportunity.id)
                  "
                />
              </div>
              <span
                v-if="isAnalysisCompleted(opportunity.id)"
                class="inline-flex size-8 items-center justify-center rounded-md text-muted"
              >
                <UIcon name="i-lucide-chevron-right" class="size-4" />
              </span>
            </div>
          </article>
        </div>
      </div>
    </div>

    <UModal
      :open="Boolean(deleteOpportunityId)"
      :dismissible="!isDeletingOpportunity"
      :close="false"
      :ui="{
        overlay: 'app-overlay-layer bg-black/55',
        content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-sm p-5 shadow-xl',
      }"
      @update:open="(nextOpen: boolean) => !nextOpen && closeDeleteOpportunityConfirm()"
    >
      <template #content>
        <div>
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">确认删除 JD</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                删除后该机会将从日常列表和求职策略中移除；已归档模拟面试仍保留在历史归档中。
              </p>
              <p v-if="deleteTargetOpportunity" class="mt-3 truncate text-sm font-medium text-highlighted">
                {{ deleteTargetOpportunity.company }} · {{ deleteTargetOpportunity.jobTitle }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isDeletingOpportunity"
              @click="closeDeleteOpportunityConfirm"
            >
              取消
            </UButton>
            <UButton
              type="button"
              color="error"
              icon="i-lucide-trash-2"
              :loading="isDeletingOpportunity"
              :disabled="isDeletingOpportunity"
              @click="confirmDeleteOpportunity"
            >
              确认删除
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      :open="Boolean(interviewHistoryConflict)"
      :dismissible="!isArchivingInterviewsAndDeleting"
      :close="false"
      :ui="{
        overlay: 'app-overlay-layer bg-black/55',
        content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-md p-5 shadow-xl',
      }"
      @update:open="(open: boolean) => !open && closeInterviewHistoryConflict()"
    >
      <template #content>
        <div v-if="interviewHistoryConflict">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
              <UIcon name="i-lucide-archive" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">
                {{ interviewHistoryConflict.details.blockingCount ? '先处理进行中的模拟面试' : '归档面试后删除机会' }}
              </h2>
              <p v-if="conflictTargetOpportunity" class="mt-2 truncate text-sm font-medium text-highlighted">
                {{ conflictTargetOpportunity.company }} · {{ conflictTargetOpportunity.jobTitle }}
              </p>
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-default bg-elevated/55 p-4 text-sm leading-6 text-muted">
            <template v-if="interviewHistoryConflict.details.blockingCount > 0">
              <p>
                当前有 {{ interviewHistoryConflict.details.blockingCount }} 场模拟面试仍处于
                <span class="font-medium text-highlighted">{{
                  getBlockingInterviewStatusSummary(interviewHistoryConflict.details.blockingStatuses)
                }}</span
                >，运行中的任务不能直接归档或删除。
              </p>
              <p v-if="interviewHistoryConflict.details.archiveableCount" class="mt-2">
                另外 {{ interviewHistoryConflict.details.archiveableCount }} 场已结束记录可以归档。
              </p>
            </template>
            <template v-else>
              <p>
                发现
                {{ interviewHistoryConflict.details.archiveableCount }}
                场尚未归档的模拟面试。可以一键归档这些记录并继续删除机会。
              </p>
            </template>
            <p class="mt-2 text-xs leading-5 text-muted">
              归档只会隐藏记录，有效评分仍会纳入能力画像；如不希望继续参与能力证据，请前往“已归档模拟面试”彻底删除。
            </p>
          </div>

          <div class="mt-6 flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="isArchivingInterviewsAndDeleting"
              @click="closeInterviewHistoryConflict"
            >
              取消
            </UButton>
            <UButton
              v-if="interviewHistoryConflict.details.blockingCount > 0"
              color="primary"
              icon="i-lucide-arrow-right"
              @click="openConflictOpportunityInterviews"
            >
              去处理面试
            </UButton>
            <UButton
              v-else
              color="error"
              icon="i-lucide-archive-x"
              :loading="isArchivingInterviewsAndDeleting"
              @click="confirmArchiveInterviewsAndDeleteOpportunity"
            >
              归档并删除机会
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      :open="isBatchDeleteConfirmOpen"
      :dismissible="!isBatchDeleting"
      :close="false"
      :ui="{
        overlay: 'app-overlay-layer bg-black/55',
        content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-md p-5 shadow-xl',
      }"
      @update:open="(open: boolean) => !open && !isBatchDeleting && (isBatchDeleteConfirmOpen = false)"
    >
      <template #content>
        <div>
          <h2 class="text-base font-semibold text-highlighted">批量删除 {{ selectedOpportunityCount }} 条机会？</h2>
          <p class="mt-2 text-sm leading-6 text-muted">
            存在未归档模拟面试的机会会被保留，其余机会将从日常列表和求职策略中移除。
          </p>
          <div class="mt-6 flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="isBatchDeleting"
              @click="isBatchDeleteConfirmOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="isBatchDeleting"
              @click="confirmBatchDeleteOpportunities"
            >
              确认删除
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      :open="Boolean(duplicateOpportunityConflict)"
      :dismissible="!isResolvingDuplicateOpportunity"
      :close="false"
      :ui="{
        overlay: 'app-overlay-layer bg-black/55',
        content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-md p-5 shadow-xl',
      }"
      @update:open="(nextOpen: boolean) => !nextOpen && closeDuplicateOpportunityDialog()"
    >
      <template #content>
        <div v-if="duplicateOpportunityConflict">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
              <UIcon name="i-lucide-copy" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 id="duplicate-opportunity-dialog-title" class="text-base font-semibold text-highlighted">
                检测到历史已有相同 JD
              </h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                系统已忽略空格、换行、标点、全半角和英文大小写差异，因此不会创建重复机会记录。
              </p>
              <div class="mt-3 rounded-xl border border-default bg-elevated/70 px-3 py-2.5">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ duplicateOpportunityConflict.details.existingOpportunity.company }} ·
                  {{ duplicateOpportunityConflict.details.existingOpportunity.jobTitle }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  {{ getAnalysisStatusLabel(duplicateOpportunityConflict.details.existingOpportunity.analysisStatus) }}
                </p>
              </div>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isResolvingDuplicateOpportunity"
              @click="closeDuplicateOpportunityDialog"
            >
              取消
            </UButton>
            <UButton
              v-if="
                hasCompletedDuplicateAnalysis(duplicateOpportunityConflict.details.existingOpportunity.analysisStatus)
              "
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-arrow-up-right"
              :loading="isResolvingDuplicateOpportunity"
              :disabled="isResolvingDuplicateOpportunity"
              @click="openDuplicateOpportunityDetail"
            >
              前往查看
            </UButton>
            <UButton
              type="button"
              icon="i-lucide-rotate-cw"
              :loading="isResolvingDuplicateOpportunity"
              :disabled="
                isResolvingDuplicateOpportunity ||
                isDuplicateAnalysisActive(duplicateOpportunityConflict.details.existingOpportunity.analysisStatus)
              "
              @click="forceAnalyzeDuplicateOpportunity"
            >
              {{
                hasCompletedDuplicateAnalysis(duplicateOpportunityConflict.details.existingOpportunity.analysisStatus)
                  ? '强制重新分析'
                  : '重新分析'
              }}
            </UButton>
          </div>
          <p
            v-if="isDuplicateAnalysisActive(duplicateOpportunityConflict.details.existingOpportunity.analysisStatus)"
            class="mt-3 text-right text-xs text-muted"
          >
            当前 JD 正在分析中，完成后才可以重新分析。
          </p>
        </div>
      </template>
    </UModal>

    <CreateOpportunityModal
      :open="isCreateModalOpen"
      :loading="isCreatingOpportunity"
      :model-connection="settingsStore.llm"
      :batch-creation-outcome="batchCreationOutcome"
      :review-payload="opportunityImportReviewStore.payload"
      :review-revision="opportunityImportReviewStore.revision"
      @close="closeCreateModal"
      @submit="createOpportunity"
      @submit-batch="createOpportunities"
    />
  </section>
</template>

<style scoped>
.opportunity-filter-container {
  container-type: inline-size;
}

.opportunity-filter-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}

@container (min-width: 36rem) {
  .opportunity-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 72rem) {
  .opportunity-filter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
