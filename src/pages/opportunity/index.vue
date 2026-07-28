<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import type { JobOpportunityStatus } from '@/types/opportunity'
import { useOpportunityStore } from '@/stores'
import CityPicker from '@/components/CityPicker.vue'
import { defaultMockJobDraft } from './mocks/jobDraft'
import { mockResumeIdentity } from './mocks/analysis'

type JobFormField = 'company' | 'jobTitle' | 'description'

const mockJobDraftStorageKey = 'agent-seek-employment:mock-job-draft:v2'
let mockSavedTimer: ReturnType<typeof window.setTimeout> | null = null

const statusOptions: { label: string; value: JobOpportunityStatus | 'all' }[] = [
  { label: '全部', value: 'all' },
  { label: '分析中', value: 'analyzing' },
  { label: '待投递', value: 'pending_apply' },
  { label: '已投递', value: 'applied' },
  { label: '笔试中', value: 'written_test' },
  { label: '面试中', value: 'interviewing' },
  { label: '已 OC', value: 'oc' },
  { label: '已 Offer', value: 'offered' },
  { label: '流程终止', value: 'closed' },
]

const statusLabelMap: Record<JobOpportunityStatus, string> = {
  analyzing: '分析中',
  pending_apply: '待投递',
  applied: '已投递',
  written_test: '笔试中',
  interviewing: '面试中',
  oc: '已 OC',
  offered: '已 Offer',
  closed: '流程终止',
}

const opportunityStore = useOpportunityStore()
const router = useRouter()
const { opportunities, analyses } = storeToRefs(opportunityStore)

const selectedStatus = ref<JobOpportunityStatus | 'all'>('all')
const isStatusFilterOpen = ref(false)
const isCreateModalOpen = ref(false)
const originalBodyOverflow = ref('')
const mockSavedMessage = ref('')
const statusFilterRef = ref<HTMLElement | null>(null)
const form = reactive({
  company: '',
  jobTitle: '',
  address: [] as string[],
  introduction: '',
  description: '',
})
const errors = reactive<Record<JobFormField, string>>({
  company: '',
  jobTitle: '',
  description: '',
})

const filteredOpportunities = computed(() => {
  if (selectedStatus.value === 'all') return opportunities.value

  return opportunities.value.filter((opportunity) => opportunity.status === selectedStatus.value)
})
const selectedStatusLabel = computed(() => {
  return statusOptions.find((status) => status.value === selectedStatus.value)?.label ?? '全部'
})

function lockBodyScroll() {
  if (typeof document === 'undefined') return

  originalBodyOverflow.value = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return

  document.body.style.overflow = originalBodyOverflow.value
}

function openCreateModal() {
  isCreateModalOpen.value = true
  lockBodyScroll()
}

function closeCreateModal() {
  isCreateModalOpen.value = false
  unlockBodyScroll()
}

function resetForm() {
  Object.assign(form, { company: '', jobTitle: '', address: [], introduction: '', description: '' })
  errors.company = ''
  errors.jobTitle = ''
  errors.description = ''
}

function readMockJobDraft() {
  const storedDraft = localStorage.getItem(mockJobDraftStorageKey)
  if (!storedDraft) return defaultMockJobDraft

  try {
    const parsedDraft = JSON.parse(storedDraft) as typeof defaultMockJobDraft & { address?: string[] | string }

    return {
      ...parsedDraft,
      address: normalizeCityList(parsedDraft.address),
    }
  } catch {
    return defaultMockJobDraft
  }
}

function normalizeCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities
  if (typeof cities === 'string' && cities.trim()) return [cities.trim()]

  return []
}

function writeMockJobDraft(draft: typeof defaultMockJobDraft) {
  localStorage.setItem(mockJobDraftStorageKey, JSON.stringify(draft))
}

function importMockJobDraft() {
  Object.assign(form, readMockJobDraft())
  errors.company = ''
  errors.jobTitle = ''
  errors.description = ''
}

function setCurrentJobDraftAsMockData() {
  if (!validateForm()) return

  writeMockJobDraft({
    company: form.company.trim(),
    jobTitle: form.jobTitle.trim(),
    address: [...form.address],
    introduction: form.introduction.trim(),
    description: form.description.trim(),
  })

  mockSavedMessage.value = '已设为本地 mock 数据'

  if (mockSavedTimer) window.clearTimeout(mockSavedTimer)

  mockSavedTimer = window.setTimeout(() => {
    mockSavedMessage.value = ''
    mockSavedTimer = null
  }, 2500)
}

function clearError(field: JobFormField) {
  errors[field] = ''
}

function validateForm() {
  errors.company = form.company.trim() ? '' : '请填写公司名称'
  errors.jobTitle = form.jobTitle.trim() ? '' : '请填写岗位名称'
  errors.description = form.description.trim() ? '' : '请填写岗位要求'

  return !Object.values(errors).some(Boolean)
}

function createOpportunity() {
  if (!validateForm()) return

  const opportunity = opportunityStore.createOpportunity(form)
  opportunityStore.generateMockAnalysis(opportunity.id, mockResumeIdentity.resumeId, mockResumeIdentity.resumeVersionId)
  resetForm()
  closeCreateModal()
}

function getOpportunityAnalysis(opportunityId: string) {
  return analyses.value.find((analysis) => analysis.jobOpportunityId === opportunityId) ?? null
}

function formatCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities.length ? cities.join('、') : ''
  return cities ?? ''
}

function openOpportunityDetail(opportunityId: string) {
  if (!getOpportunityAnalysis(opportunityId)) {
    opportunityStore.generateMockAnalysis(
      opportunityId,
      mockResumeIdentity.resumeId,
      mockResumeIdentity.resumeVersionId,
    )
  }

  opportunityStore.selectOpportunity(opportunityId)
  void router.push({ name: 'opportunity-detail', params: { id: opportunityId } })
}

function selectStatus(value: JobOpportunityStatus | 'all') {
  selectedStatus.value = value
  isStatusFilterOpen.value = false
}

function closeStatusFilterWhenClickOutside(event: MouseEvent) {
  if (!statusFilterRef.value || statusFilterRef.value.contains(event.target as Node)) return

  isStatusFilterOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', closeStatusFilterWhenClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeStatusFilterWhenClickOutside)
  unlockBodyScroll()

  if (mockSavedTimer) window.clearTimeout(mockSavedTimer)
})
</script>

<template>
  <section class="w-full">
    <UCard
      v-if="opportunities.length === 0"
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
        <UButton icon="i-lucide-plus" class="whitespace-nowrap" @click="openCreateModal">新增 JD 分析</UButton>
      </div>

      <section class="app-toolbar p-4">
        <div class="flex flex-wrap items-end gap-4">
          <div ref="statusFilterRef" class="relative w-full max-w-xs">
            <label class="mb-2 block text-sm font-medium text-highlighted">状态</label>
            <button
              type="button"
              class="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-default bg-[var(--app-surface)] px-3 text-left text-sm text-highlighted outline-none transition-colors hover:border-accented focus-visible:border-primary"
              :aria-expanded="isStatusFilterOpen"
              @click="isStatusFilterOpen = !isStatusFilterOpen"
            >
              <span>{{ selectedStatusLabel }}</span>
              <UIcon
                name="i-lucide-chevron-down"
                class="mr-0.5 size-4 shrink-0 text-muted transition-transform"
                :class="{ 'rotate-180': isStatusFilterOpen }"
              />
            </button>

            <div
              v-if="isStatusFilterOpen"
              class="app-panel absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden p-1 shadow-xl"
            >
              <button
                v-for="status in statusOptions"
                :key="status.value"
                type="button"
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
                :class="
                  selectedStatus === status.value
                    ? 'bg-elevated text-highlighted'
                    : 'text-muted hover:bg-elevated hover:text-highlighted'
                "
                @click="selectStatus(status.value)"
              >
                {{ status.label }}
                <UIcon v-if="selectedStatus === status.value" name="i-lucide-check" class="size-4 text-primary" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div v-if="filteredOpportunities.length === 0" class="app-panel-muted p-10 text-center">
        <p class="text-sm text-muted">当前筛选条件下没有机会记录。</p>
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="opportunity in filteredOpportunities"
          :key="opportunity.id"
          class="app-card app-card-interactive cursor-pointer p-4"
          role="button"
          tabindex="0"
          :aria-label="`进入 ${opportunity.company} ${opportunity.jobTitle} 分析详情`"
          @click="openOpportunityDetail(opportunity.id)"
          @keydown.enter.prevent="openOpportunityDetail(opportunity.id)"
        >
          <div class="flex items-center justify-between gap-4">
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

            <div class="flex shrink-0 items-center gap-3">
              <div
                v-if="getOpportunityAnalysis(opportunity.id)"
                class="app-ai-badge flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              >
                <UIcon name="i-lucide-wand-sparkles" class="size-3.5 text-[var(--app-ai-end)]" />
                <span class="app-ai-gradient-text text-xs">匹配度</span>
                <span class="app-ai-gradient-text font-semibold">
                  {{ getOpportunityAnalysis(opportunity.id)?.matchScore }}
                </span>
              </div>
              <div
                v-else
                class="rounded-xl border border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_82%,transparent)] px-3 py-2 text-sm text-muted"
              >
                {{ statusLabelMap[opportunity.status] }}
              </div>
              <span class="inline-flex size-8 items-center justify-center rounded-md text-muted">
                <UIcon name="i-lucide-chevron-right" class="size-4" />
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="isCreateModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
        <div class="app-panel w-full max-w-2xl shadow-xl">
          <header class="flex items-start justify-between gap-4 border-b border-default px-6 py-5">
            <div>
              <h2 class="text-lg font-semibold text-highlighted">创建 JD 分析</h2>
              <p class="mt-1 text-sm text-muted">先保存 JD 信息，后续会基于简历版本生成结构化分析。</p>
            </div>
            <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" @click="closeCreateModal" />
          </header>

          <div class="max-h-[70vh] overflow-y-auto px-6 py-5">
            <div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <UFormField label="公司名称" required>
                <UInput
                  v-model="form.company"
                  class="w-full"
                  :class="{ 'form-control-error': errors.company }"
                  placeholder="例如：小红书"
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
                  v-model="form.jobTitle"
                  class="w-full"
                  :class="{ 'form-control-error': errors.jobTitle }"
                  placeholder="例如：前端开发工程师"
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
                <CityPicker v-model="form.address" :max="5" panel-height-class="h-52" />
                <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
              </UFormField>

              <UFormField label="岗位介绍">
                <UTextarea
                  v-model="form.introduction"
                  class="w-full"
                  :rows="4"
                  placeholder="粘贴岗位背景、团队方向或业务介绍"
                />
                <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
              </UFormField>

              <UFormField label="岗位要求" required>
                <UTextarea
                  v-model="form.description"
                  class="w-full"
                  :class="{ 'form-control-error': errors.description }"
                  :rows="8"
                  placeholder="粘贴 JD 中的岗位职责、任职要求、加分项"
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

          <footer class="flex items-center justify-between gap-3 border-t border-default px-6 py-4">
            <div class="flex items-center gap-2">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-file-input"
                @click="importMockJobDraft"
              >
                导入 mock 数据
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-save"
                @click="setCurrentJobDraftAsMockData"
              >
                设为 mock 数据
              </UButton>
              <span v-if="mockSavedMessage" class="text-xs text-muted">{{ mockSavedMessage }}</span>
            </div>

            <div class="flex justify-end gap-2">
              <UButton type="button" color="neutral" variant="ghost" @click="closeCreateModal">取消</UButton>
              <UButton type="button" icon="i-lucide-check" @click="createOpportunity">确认创建</UButton>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 33px !important;
  min-height: 33px !important;
}
</style>
