<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import type { JobOpportunityStatus, OpportunityIntentionLevel } from '@/types/opportunity'
import { useOpportunityStore, useResumeStore, useSettingsStore } from '@/stores'
import {
  getDuplicateOpportunityConflict,
  type CreateOpportunityPayload,
  type DuplicateOpportunityConflict,
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
const resumeStore = useResumeStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const toast = useToast()
const { opportunities, analysisTasks, isInitialLoading, isRefreshing, loadError } = storeToRefs(opportunityStore)

const selectedStatus = ref<JobOpportunityStatus | ''>('')
const selectedIntentionLevel = ref<OpportunityIntentionLevel | ''>('')
const selectedRecommendation = ref<AnalysisRecommendation | ''>('')
const selectedRegion = ref<OpportunityRegion | ''>('')
const isCreateModalOpen = ref(false)
const isCreatingOpportunity = ref(false)
const retryingOpportunityId = ref<string | null>(null)
const openingOpportunityId = ref<string | null>(null)
const deleteOpportunityId = ref<string | null>(null)
const isDeletingOpportunity = ref(false)
const duplicateOpportunityConflict = ref<DuplicateOpportunityConflict | null>(null)
const isResolvingDuplicateOpportunity = ref(false)
const detailPrefetchTimers = new Map<string, number>()

const listFilters = computed(() => {
  return {
    statuses: selectedStatus.value ? [selectedStatus.value] : [],
    intentionLevels: selectedIntentionLevel.value ? [selectedIntentionLevel.value] : [],
    recommendations: selectedRecommendation.value ? [selectedRecommendation.value] : [],
    regions: selectedRegion.value ? [selectedRegion.value] : [],
  }
})
const hasActiveListFilters = computed(() => {
  return Object.values(listFilters.value).some((values) => values.length > 0)
})
const filteredOpportunities = computed(() => opportunities.value)
const deleteTargetOpportunity = computed(() => {
  return opportunities.value.find((opportunity) => opportunity.id === deleteOpportunityId.value) ?? null
})

function openCreateModal() {
  isCreateModalOpen.value = true
}

function closeCreateModal() {
  isCreateModalOpen.value = false
}

async function createOpportunity(payload: CreateOpportunityPayload) {
  if (isCreatingOpportunity.value) return

  const currentResume = resumeStore.currentResume
  const currentVersion = resumeStore.currentVersion
  if (!currentResume || !currentVersion) {
    toast.add({ title: '请先创建并保存一份简历', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  if (!settingsStore.llm.apiKey.trim()) {
    toast.add({ title: '请先在系统设置中填写 API Key', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }

  isCreatingOpportunity.value = true
  try {
    const opportunity = await opportunityStore.createOpportunity(payload)
    const task = await opportunityStore.startJobAnalysis(opportunity.id, {
      resumeId: currentResume.id,
      resumeVersionId: currentVersion.id,
      modelConnection: settingsStore.llm,
    })
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

function isAnalysisCompleted(opportunityId: string) {
  return getOpportunityAnalysisTask(opportunityId)?.status === 'completed'
}

function getOpportunityActionItems(opportunityId: string) {
  const task = getOpportunityAnalysisTask(opportunityId)
  const isAnalysisActive = task?.status === 'pending' || task?.status === 'processing'
  const isActionLocked = Boolean(
    retryingOpportunityId.value || isDeletingOpportunity.value || deleteOpportunityId.value,
  )

  return [
    [
      {
        label: '重新分析',
        icon: 'i-lucide-rotate-cw',
        disabled: isAnalysisActive || isActionLocked,
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

  const currentResume = resumeStore.currentResume
  const currentVersion = resumeStore.currentVersion
  if (!currentResume || !currentVersion) {
    toast.add({ title: '请先创建并保存一份简历', color: 'error', icon: 'i-lucide-circle-alert' })
    return false
  }
  if (!settingsStore.llm.apiKey.trim()) {
    toast.add({ title: '请先在系统设置中填写 API Key', color: 'error', icon: 'i-lucide-circle-alert' })
    return false
  }

  retryingOpportunityId.value = opportunityId
  try {
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

function formatCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities.length ? cities.join('、') : ''
  return cities ?? ''
}

async function openOpportunityDetail(opportunityId: string) {
  if (openingOpportunityId.value) return

  if (!isAnalysisCompleted(opportunityId)) return

  openingOpportunityId.value = opportunityId
  try {
    opportunityStore.selectOpportunity(opportunityId)
    await router.push({ name: 'opportunity-detail', params: { id: opportunityId } })
  } catch (error) {
    toast.add({
      title: '打开机会详情失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    openingOpportunityId.value = null
  }
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

onMounted(() => {
  void opportunityStore.loadOpportunities({ filters: listFilters.value })
})

onBeforeUnmount(() => {
  for (const timer of detailPrefetchTimers.values()) {
    window.clearTimeout(timer)
  }
  detailPrefetchTimers.clear()
})

watch(listFilters, (filters) => {
  void opportunityStore.loadOpportunities({ force: true, filters })
})
</script>

<template>
  <section class="w-full">
    <div v-if="loadError && !isInitialLoading" class="app-panel-muted p-10 text-center">
      <p class="text-sm text-error">{{ loadError }}</p>
      <UButton
        class="mt-4"
        color="neutral"
        variant="outline"
        @click="opportunityStore.loadOpportunities({ force: true, filters: listFilters })"
      >
        重新加载
      </UButton>
    </div>

    <UCard
      v-else-if="!isInitialLoading && opportunities.length === 0 && !hasActiveListFilters"
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
          <UButton icon="i-lucide-plus" class="whitespace-nowrap" @click="openCreateModal"> 新增 JD 分析 </UButton>
        </div>
      </div>

      <section class="app-toolbar p-4">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OpportunityFilterSelect v-model="selectedStatus" label="流程状态" :options="statusOptions" />
          <OpportunityFilterSelect v-model="selectedIntentionLevel" label="意向等级" :options="intentionOptions" />
          <OpportunityFilterSelect v-model="selectedRecommendation" label="匹配结论" :options="recommendationOptions" />
          <OpportunityFilterSelect v-model="selectedRegion" label="所在地域" :options="opportunityRegionOptions" />
        </div>
      </section>

      <OpportunityListSkeleton v-if="isInitialLoading && opportunities.length === 0" />

      <div v-else-if="filteredOpportunities.length === 0" class="app-panel-muted p-10 text-center">
        <p class="text-sm text-muted">当前筛选条件下没有机会记录。</p>
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="opportunity in filteredOpportunities"
          :key="opportunity.id"
          class="app-card p-4"
          :class="{
            'app-card-interactive cursor-pointer': isAnalysisCompleted(opportunity.id),
            'cursor-default': !isAnalysisCompleted(opportunity.id),
            'pointer-events-none opacity-70': Boolean(openingOpportunityId),
          }"
          role="button"
          tabindex="0"
          :aria-busy="openingOpportunityId === opportunity.id"
          :aria-label="
            isAnalysisCompleted(opportunity.id)
              ? `进入 ${opportunity.company} ${opportunity.jobTitle} 分析详情`
              : `${opportunity.company} ${opportunity.jobTitle} 正在等待分析结果`
          "
          @click="openOpportunityDetail(opportunity.id)"
          @keydown.enter.prevent="openOpportunityDetail(opportunity.id)"
          @mouseenter="scheduleOpportunityDetailPrefetch(opportunity.id)"
          @mouseleave="cancelOpportunityDetailPrefetch(opportunity.id)"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
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
                </div>
                <p class="mt-1 truncate text-sm text-muted">{{ opportunity.jobTitle }}</p>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-3">
              <UDropdownMenu
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
                />
              </UDropdownMenu>
              <UBadge v-if="opportunity.status === 'closed'" color="error" variant="subtle" label="流程终止" />
              <div
                v-else-if="getOpportunityAnalysisTask(opportunity.id)?.status === 'completed'"
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
                v-else-if="
                  getOpportunityAnalysisTask(opportunity.id)?.status === 'pending' ||
                  getOpportunityAnalysisTask(opportunity.id)?.status === 'processing'
                "
                class="rounded-xl border border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_82%,transparent)] px-3 py-2 text-sm text-muted"
              >
                <span class="inline-flex items-center gap-1.5">
                  <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
                  分析中 · 第 {{ getOpportunityAnalysisTask(opportunity.id)?.currentAttempt ?? 1 }}/
                  {{ getOpportunityAnalysisTask(opportunity.id)?.maxAttempts ?? 3 }} 次
                </span>
              </div>
              <div
                v-else-if="getOpportunityAnalysisTask(opportunity.id)?.status === 'failed'"
                class="flex items-center gap-2"
              >
                <span class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                  分析失败 · 已尝试 {{ getOpportunityAnalysisTask(opportunity.id)?.currentAttempt ?? 1 }}/
                  {{ getOpportunityAnalysisTask(opportunity.id)?.maxAttempts ?? 3 }} 次
                </span>
                <UButton
                  color="error"
                  variant="soft"
                  size="sm"
                  square
                  icon="i-lucide-rotate-cw"
                  title="重新分析"
                  aria-label="重新分析"
                  :loading="retryingOpportunityId === opportunity.id"
                  :disabled="retryingOpportunityId !== null || deleteOpportunityId !== null"
                  @click.stop="retryJobAnalysis(opportunity.id)"
                />
              </div>
              <span
                v-if="isAnalysisCompleted(opportunity.id)"
                class="inline-flex size-8 items-center justify-center rounded-md text-muted"
              >
                <UIcon
                  :name="openingOpportunityId === opportunity.id ? 'i-lucide-loader-circle' : 'i-lucide-chevron-right'"
                  class="size-4"
                  :class="{ 'animate-spin': openingOpportunityId === opportunity.id }"
                />
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="deleteOpportunityId" class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
        <div class="app-panel w-full max-w-sm p-5 shadow-xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-highlighted">确认删除 JD</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                删除后会同时移除该 JD 的分析结果、运行记录和求职流程记录，此操作无法恢复。
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
      </div>

      <div
        v-if="duplicateOpportunityConflict"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-opportunity-dialog-title"
      >
        <div class="app-panel w-full max-w-md p-5 shadow-xl">
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
      </div>
    </Teleport>

    <CreateOpportunityModal
      :open="isCreateModalOpen"
      :loading="isCreatingOpportunity"
      @close="closeCreateModal"
      @submit="createOpportunity"
    />
  </section>
</template>
