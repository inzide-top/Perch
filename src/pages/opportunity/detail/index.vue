<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import type {
  AssessmentRoundType,
  InterviewRound,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
  OpportunityTerminationReasonCode,
} from '@/types/opportunity'
import { useOpportunityStore } from '@/stores'
import ChatSection from './components/ChatSection.vue'
import DashboardSection from './components/DashboardSection.vue'
import InfoManagementSection from './components/InfoManagementSection.vue'
import MockInterviewSection from './components/MockInterviewSection.vue'
import type {
  AssessmentRoundForm,
  ChatItem,
  DetailNavItem,
  DetailNavKey,
  MockInterviewMessage,
  OpportunityInfoForm,
  OverallInterviewScore,
  WrittenTestReviewForm,
} from './types'

const route = useRoute()
const router = useRouter()
const opportunityStore = useOpportunityStore()
const { opportunities, analyses } = storeToRefs(opportunityStore)

const baseStatusFlow: { label: string; value: JobOpportunityStatus }[] = [
  { label: '待投递', value: 'pending_apply' },
  { label: '已投递', value: 'applied' },
  { label: '面试中', value: 'interviewing' },
  { label: '已 OC', value: 'oc' },
  { label: '已 Offer', value: 'offered' },
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
const intentionOptions: { label: string; value: OpportunityIntentionLevel; description: string }[] = [
  { label: 'S', value: 'S', description: '非常想去' },
  { label: 'A', value: 'A', description: '重点推进' },
  { label: 'B', value: 'B', description: '正常跟进' },
  { label: 'C', value: 'C', description: '低优先级' },
]
const assessmentRoundTypeOptions: { label: string; value: AssessmentRoundType }[] = [
  { label: '基础面', value: 'technical_basic' },
  { label: '项目面', value: 'project' },
  { label: '业务面', value: 'business' },
  { label: 'HR 面', value: 'hr' },
  { label: '主管面', value: 'manager' },
  { label: '其他', value: 'other' },
]
const fixedNavItems: DetailNavItem[] = [
  {
    key: 'dashboard',
    label: '首页',
    icon: 'i-lucide-layout-dashboard',
    description: '匹配概览',
  },
  {
    key: 'info',
    label: '信息管理',
    icon: 'i-lucide-clipboard-list',
    description: 'JD 与测评记录',
  },
  {
    key: 'mock-interview',
    label: '模拟面试',
    icon: 'i-lucide-messages-square',
    description: '问答与评分',
  },
]

const chatItems = ref<ChatItem[]>([
  { id: 1, title: 'JD 追问准备', preview: '围绕 AI Workflow 和 RAG 继续追问' },
  { id: 2, title: '简历优化讨论', preview: '把智能工牌项目改写得更贴合岗位' },
])
const activeNavKey = ref<DetailNavKey>('dashboard')
const infoSavedMessage = ref('')
const isOpportunityInfoEditing = ref(false)
const statusMotionKey = ref(0)
const isTerminatePopoverOpen = ref(false)
const roundDatePopoverOpen = ref(false)
const roundCalendarDate = ref<unknown>()
const editingRoundId = ref<string | null>(null)
const deletingRoundId = ref<string | null>(null)
const isAssessmentDrawerOpen = ref(false)
const isWrittenTestReviewDrawerOpen = ref(false)
const isRoundEditDrawerOpen = ref(false)
const editRoundDatePopoverOpen = ref(false)
const editRoundCalendarDate = ref<unknown>()
const writtenTestDatePopoverOpen = ref(false)
const writtenTestCalendarDate = ref<unknown>()
const roundDrawerBodyOverflow = ref('')
const roundDrawerLockCount = ref(0)
const terminationTarget = ref<'none' | 'new' | string>('none')
const terminationNewRoundType = ref<AssessmentRoundType>('technical_basic')
const terminationNewRoundTitle = ref('')
const terminationReasonNote = ref('')

const opportunityId = computed(() => String(route.params.id ?? ''))
const opportunity = computed(() => opportunities.value.find((item) => item.id === opportunityId.value) ?? null)
const analysis = computed(() => analyses.value.find((item) => item.jobOpportunityId === opportunityId.value) ?? null)
const isChatPage = computed(() => String(activeNavKey.value).startsWith('chat-'))
const activeChat = computed(() => {
  if (!isChatPage.value) return null

  const id = Number(String(activeNavKey.value).replace('chat-', ''))
  return chatItems.value.find((chat) => chat.id === id) ?? null
})

const infoForm = reactive<OpportunityInfoForm>({
  company: '',
  jobTitle: '',
  address: [] as string[],
  introduction: '',
  description: '',
  status: 'pending_apply' as JobOpportunityStatus,
  includeWrittenTest: false,
  intentionLevel: 'B' as OpportunityIntentionLevel,
  industry: '',
  note: '',
})
const roundForm = reactive<AssessmentRoundForm>({
  type: 'technical_basic' as AssessmentRoundType,
  title: '',
  date: '',
  note: '',
})
const roundEditForm = reactive<AssessmentRoundForm>({
  type: 'technical_basic' as AssessmentRoundType,
  title: '',
  date: '',
  note: '',
})
const writtenTestReviewForm = reactive<WrittenTestReviewForm>({
  scheduledAt: '',
  reviewNote: '',
})
const statusFlow = computed(() => {
  if (!infoForm.includeWrittenTest) return baseStatusFlow

  return [
    { label: '待投递', value: 'pending_apply' },
    { label: '已投递', value: 'applied' },
    { label: '笔试中', value: 'written_test' },
    { label: '面试中', value: 'interviewing' },
    { label: '已 OC', value: 'oc' },
    { label: '已 Offer', value: 'offered' },
  ] satisfies { label: string; value: JobOpportunityStatus }[]
})
const currentStatusIndex = computed(() => {
  const currentStatus = infoForm.status === 'analyzing' ? 'pending_apply' : infoForm.status
  return statusFlow.value.findIndex((status) => status.value === currentStatus)
})

function getStatusFlowIndex(status: JobOpportunityStatus | null | undefined) {
  if (!status) return -1

  const normalizedStatus = status === 'analyzing' ? 'pending_apply' : status

  return statusFlow.value.findIndex((item) => item.value === normalizedStatus)
}

const assessmentAvailableStatusIndex = computed(() => {
  if (infoForm.status !== 'closed') return currentStatusIndex.value

  const histories = opportunity.value?.statusHistory ?? []

  for (let index = histories.length - 1; index >= 0; index -= 1) {
    const history = histories[index]
    const relatedStatus = history.toStatus === 'closed' ? history.fromStatus : history.toStatus
    const relatedStatusIndex = getStatusFlowIndex(relatedStatus)

    if (relatedStatusIndex >= 0) return relatedStatusIndex
  }

  return currentStatusIndex.value
})

function hasCurrentStageReached(status: JobOpportunityStatus) {
  const statusIndex = statusFlow.value.findIndex((item) => item.value === status)

  return statusIndex >= 0 && assessmentAvailableStatusIndex.value >= statusIndex
}

const canOpenWrittenTestReview = computed(() => {
  return infoForm.includeWrittenTest && hasCurrentStageReached('written_test')
})
const canOpenInterviewAssessment = computed(() => {
  return hasCurrentStageReached('interviewing')
})
const nextStatus = computed(() => {
  if (infoForm.status === 'closed') return null
  if (currentStatusIndex.value < 0) return statusFlow.value[0]

  return statusFlow.value[currentStatusIndex.value + 1] ?? null
})
const previousStatus = computed(() => {
  if (infoForm.status === 'closed' || currentStatusIndex.value <= 0) return null

  return statusFlow.value[currentStatusIndex.value - 1] ?? null
})
const hasOpportunityMetaChanged = computed(() => {
  if (!opportunity.value) return false

  return (
    infoForm.includeWrittenTest !== opportunity.value.includeWrittenTest ||
    infoForm.intentionLevel !== opportunity.value.intentionLevel ||
    infoForm.industry !== opportunity.value.industry ||
    infoForm.note.trim() !== opportunity.value.note
  )
})
const interviewRoundDateLabel = computed(() => {
  return roundForm.date || '请输入日期'
})
const writtenTestDateLabel = computed(() => {
  return writtenTestReviewForm.scheduledAt || '请输入笔试时间'
})
const assessmentRounds = computed(() => opportunity.value?.assessmentRounds ?? [])
const availableAssessmentRoundTypeOptions = computed(() => {
  return assessmentRoundTypeOptions
})
const terminationRoundOptions = computed(() => {
  return [
    ...assessmentRounds.value.map((round) => ({
      label: `${round.title} · ${getAssessmentRoundTypeLabel(round.type)}`,
      value: round.id,
    })),
    { label: '新增一轮并终止', value: 'new' },
    { label: '不绑定具体轮次', value: 'none' },
  ]
})

const mockInterviewMessages: MockInterviewMessage[] = [
  {
    role: 'interviewer',
    content: '这个岗位提到 AI Workflow。请你结合自己的项目，说一下你会如何拆分一个 JD 分析 Agent 的流程？',
  },
  {
    role: 'candidate',
    content:
      '我会先把简历结构化，再把 JD 结构化，最后做匹配分析。每一步都用结构化输出，这样方便调试，也方便后续模拟面试继续复用。',
    score: 82,
    feedback: '回答抓住了拆分和结构化输出，但可以继续补充工具调用失败、上下文压缩和人工确认节点。',
  },
  {
    role: 'interviewer',
    content: '如果要做知识库，你会怎么设计文档切分和召回效果评估？',
  },
]

const overallInterviewScore: OverallInterviewScore = {
  score: 78,
  summary: '当前回答能覆盖 AI Workflow 的基本拆分思路，但 RAG、召回评估、工具调用失败处理仍需要补充更工程化的细节。',
  dimensions: [
    { label: '技术准确性', score: 82 },
    { label: '业务贴合度', score: 76 },
    { label: '表达结构', score: 80 },
    { label: '深度追问承接', score: 72 },
  ],
}

function syncInfoForm() {
  if (!opportunity.value) return

  Object.assign(infoForm, {
    company: opportunity.value.company,
    jobTitle: opportunity.value.jobTitle,
    address: normalizeCityList(opportunity.value.address),
    introduction: opportunity.value.introduction,
    description: opportunity.value.description,
    status: opportunity.value.status === 'analyzing' ? 'pending_apply' : opportunity.value.status,
    includeWrittenTest: opportunity.value.includeWrittenTest ?? false,
    intentionLevel: opportunity.value.intentionLevel ?? 'B',
    industry: opportunity.value.industry ?? '',
    note: opportunity.value.note ?? '',
  })

  Object.assign(writtenTestReviewForm, {
    scheduledAt: opportunity.value.writtenTestReview?.scheduledAt ?? '',
    reviewNote: opportunity.value.writtenTestReview?.reviewNote ?? '',
  })
}

function goBack() {
  void router.push({ name: 'opportunities' })
}

function normalizeCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities
  if (typeof cities === 'string' && cities.trim()) return [cities.trim()]

  return []
}

function formatCityList(cities: string[] | string | undefined) {
  const normalizedCities = normalizeCityList(cities)

  return normalizedCities.length ? normalizedCities.join('、') : ''
}

function saveInfo() {
  if (!opportunity.value) return

  opportunityStore.updateOpportunity(opportunity.value.id, {
    company: infoForm.company,
    jobTitle: infoForm.jobTitle,
    address: infoForm.address,
    introduction: infoForm.introduction,
    description: infoForm.description,
    status: infoForm.status,
    includeWrittenTest: infoForm.includeWrittenTest,
    intentionLevel: infoForm.intentionLevel,
    industry: infoForm.industry,
    note: infoForm.note,
  })
  infoSavedMessage.value = '机会信息已保存'
  isOpportunityInfoEditing.value = false

  window.setTimeout(() => {
    infoSavedMessage.value = ''
  }, 2500)
}

function saveOpportunityMeta() {
  if (!opportunity.value || !hasOpportunityMetaChanged.value) return

  opportunityStore.updateOpportunity(opportunity.value.id, {
    includeWrittenTest: infoForm.includeWrittenTest,
    intentionLevel: infoForm.intentionLevel,
    industry: infoForm.industry,
    note: infoForm.note,
  })
  infoSavedMessage.value = '偏好信息已保存'

  window.setTimeout(() => {
    infoSavedMessage.value = ''
  }, 2500)
}

function changeOpportunityStatus(status: JobOpportunityStatus) {
  if (!opportunity.value || infoForm.status === status) return

  infoForm.status = status
  statusMotionKey.value += 1
  opportunityStore.updateOpportunity(opportunity.value.id, { status, includeWrittenTest: infoForm.includeWrittenTest })
  isTerminatePopoverOpen.value = false
}

function advanceOpportunityStatus() {
  if (!opportunity.value || !nextStatus.value) return

  changeOpportunityStatus(nextStatus.value.value)
}

function closeOpportunity() {
  if (!opportunity.value) return

  const relatedRoundId =
    terminationTarget.value === 'none' || terminationTarget.value === 'new' ? undefined : terminationTarget.value
  let finalRelatedRoundId = relatedRoundId

  if (terminationTarget.value === 'new') {
    const round = opportunityStore.addAssessmentRound(opportunity.value.id, {
      type: terminationNewRoundType.value,
      title: terminationNewRoundTitle.value || getDefaultNewTerminationRoundTitle(),
      status: 'completed',
      result: 'failed',
      note: terminationReasonNote.value,
      reviewNote: terminationReasonNote.value,
    })
    finalRelatedRoundId = round?.id
  }

  opportunityStore.terminateOpportunity(opportunity.value.id, {
    relatedAssessmentRoundId: finalRelatedRoundId,
    reasonCode: getDefaultTerminationReasonCode(),
    reasonNote: terminationReasonNote.value,
  })

  infoForm.status = 'closed'
  statusMotionKey.value += 1
  isTerminatePopoverOpen.value = false
}

function goToPreviousStatus() {
  if (!previousStatus.value) return

  changeOpportunityStatus(previousStatus.value.value)
}

function toggleIncludeWrittenTest() {
  infoForm.includeWrittenTest = !infoForm.includeWrittenTest

  if (!infoForm.includeWrittenTest && infoForm.status === 'written_test') {
    changeOpportunityStatus('applied')
  }
}

function addInterviewRound() {
  if (!opportunity.value || !roundForm.title.trim()) return

  opportunityStore.addAssessmentRound(opportunity.value.id, {
    type: roundForm.type,
    title: roundForm.title,
    scheduledAt: roundForm.date,
    note: roundForm.note,
  })
  Object.assign(roundForm, { type: getDefaultRoundType(), title: '', date: '', note: '' })
  roundCalendarDate.value = undefined
}

function handleRoundDateSelect(value: unknown) {
  if (!value) return

  roundForm.date = String(value)
  roundDatePopoverOpen.value = false
}

function handleEditRoundDateSelect(value: unknown) {
  if (!value) return

  roundEditForm.date = String(value)
  editRoundDatePopoverOpen.value = false
}

function handleWrittenTestDateSelect(value: unknown) {
  if (!value) return

  writtenTestReviewForm.scheduledAt = String(value)
  writtenTestDatePopoverOpen.value = false
}

function lockRoundDrawerScroll() {
  if (typeof document === 'undefined') return

  if (roundDrawerLockCount.value === 0) {
    roundDrawerBodyOverflow.value = document.body.style.overflow
  }
  roundDrawerLockCount.value += 1
  document.body.style.overflow = 'hidden'
}

function unlockRoundDrawerScroll() {
  if (typeof document === 'undefined') return
  if (roundDrawerLockCount.value === 0) return

  roundDrawerLockCount.value -= 1

  if (roundDrawerLockCount.value === 0) {
    document.body.style.overflow = roundDrawerBodyOverflow.value
  }
}

function openAssessmentDrawer() {
  if (!canOpenInterviewAssessment.value) return

  isAssessmentDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeAssessmentDrawer() {
  isAssessmentDrawerOpen.value = false
  unlockRoundDrawerScroll()
}

function openWrittenTestReviewDrawer() {
  if (!canOpenWrittenTestReview.value) return

  isWrittenTestReviewDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeWrittenTestReviewDrawer() {
  isWrittenTestReviewDrawerOpen.value = false
  unlockRoundDrawerScroll()
}

function saveWrittenTestReview() {
  if (!opportunity.value) return

  opportunityStore.updateWrittenTestReview(opportunity.value.id, {
    scheduledAt: writtenTestReviewForm.scheduledAt,
    reviewNote: writtenTestReviewForm.reviewNote,
  })
  closeWrittenTestReviewDrawer()
}

function openRoundEditDrawer(round: InterviewRound) {
  editingRoundId.value = round.id
  Object.assign(roundEditForm, {
    type: round.type,
    title: round.title,
    date: round.scheduledAt,
    note: round.note,
  })
  editRoundCalendarDate.value = undefined
  isRoundEditDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeRoundEditDrawer() {
  isRoundEditDrawerOpen.value = false
  editingRoundId.value = null
  unlockRoundDrawerScroll()
}

function saveRoundEdit() {
  if (!opportunity.value || !editingRoundId.value || !roundEditForm.title.trim()) return

  opportunityStore.updateAssessmentRound(opportunity.value.id, editingRoundId.value, {
    type: roundEditForm.type,
    title: roundEditForm.title,
    scheduledAt: roundEditForm.date,
    note: roundEditForm.note,
  })
  closeRoundEditDrawer()
}

function confirmDeleteRound(roundId: string) {
  if (!opportunity.value) return

  opportunityStore.deleteInterviewRound(opportunity.value.id, roundId)
  deletingRoundId.value = null
}

function getAssessmentRoundTypeLabel(type: AssessmentRoundType) {
  return assessmentRoundTypeOptions.find((item) => item.value === type)?.label ?? '其他'
}

function getDefaultRoundType(): AssessmentRoundType {
  return 'technical_basic'
}

function getDefaultNewTerminationRoundTitle() {
  return `第 ${assessmentRounds.value.length + 1} 轮`
}

function getDefaultTerminationReasonCode(): OpportunityTerminationReasonCode {
  if (infoForm.status === 'pending_apply') return 'candidate_give_up'
  if (infoForm.status === 'applied') return 'resume_rejected'
  if (infoForm.status === 'written_test') return 'written_test_failed'
  if (infoForm.status === 'interviewing') return 'interview_failed'
  if (infoForm.status === 'oc') return 'salary_unmatched'
  if (infoForm.status === 'offered') return 'offer_rejected'

  return 'other'
}

function canOpenAssessmentFromStatus(status: JobOpportunityStatus) {
  if (status === 'written_test') return canOpenWrittenTestReview.value
  if (status === 'interviewing') return canOpenInterviewAssessment.value

  return false
}

function openAssessmentPanelFromStatus(status: JobOpportunityStatus) {
  if (!canOpenAssessmentFromStatus(status)) return

  if (status === 'written_test') {
    openWrittenTestReviewDrawer()
    return
  }

  openAssessmentDrawer()
}

function createChat() {
  const nextId = Math.max(0, ...chatItems.value.map((chat) => chat.id)) + 1

  chatItems.value.unshift({
    id: nextId,
    title: `新对话 ${nextId}`,
    preview: '围绕当前 JD 和简历继续提问',
  })
  activeNavKey.value = `chat-${nextId}`
}

function getRecommendationLabel(value: string | undefined) {
  const map: Record<string, string> = {
    strong_match: '强匹配',
    worth_trying: '值得投递',
    risky: '谨慎投递',
    not_recommended: '不建议',
  }

  return value ? (map[value] ?? value) : '待分析'
}

function getRecommendationBadgeClass(value: string | undefined) {
  const map: Record<string, string> = {
    strong_match: 'is-strong-match',
    worth_trying: 'is-worth-trying',
    risky: 'is-risky',
    not_recommended: 'is-not-recommended',
  }

  return `app-recommendation-badge ${value ? (map[value] ?? 'is-not-recommended') : 'is-not-recommended'}`
}

watch(opportunity, syncInfoForm, { immediate: true })
watch(
  () => infoForm.status,
  () => {
    roundForm.type = getDefaultRoundType()
    terminationNewRoundType.value = getDefaultRoundType()
  },
)
watch(isTerminatePopoverOpen, (isOpen) => {
  if (!isOpen) return

  terminationTarget.value = assessmentRounds.value[0]?.id ?? 'none'
  terminationNewRoundType.value = getDefaultRoundType()
  terminationNewRoundTitle.value = ''
  terminationReasonNote.value = ''
})
onBeforeUnmount(() => {
  if (isAssessmentDrawerOpen.value || isWrittenTestReviewDrawerOpen.value || isRoundEditDrawerOpen.value) {
    roundDrawerLockCount.value = 1
    unlockRoundDrawerScroll()
  }
})
</script>

<template>
  <section v-if="opportunity" class="min-h-[calc(100vh-4rem)] bg-[var(--app-bg)]">
    <div
      class="mx-4 mt-4 rounded-[22px] border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_96%,transparent)] px-5 py-4 shadow-[var(--app-shadow-panel)] backdrop-blur-xl lg:mx-6 lg:px-6"
    >
      <div class="min-w-0">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="-ml-2 mb-2"
          @click="goBack"
        >
          返回机会管理
        </UButton>
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="truncate text-xl font-semibold tracking-tight text-highlighted">{{ opportunity.company }}</h1>
          <UBadge
            v-if="formatCityList(opportunity.address)"
            color="neutral"
            variant="subtle"
            :label="formatCityList(opportunity.address)"
          />
          <UBadge
            v-if="analysis"
            variant="subtle"
            :class="getRecommendationBadgeClass(analysis.recommendation)"
            :label="`${analysis.matchScore} 分 · ${getRecommendationLabel(analysis.recommendation)}`"
          />
        </div>
        <p class="mt-1 text-sm text-muted">{{ opportunity.jobTitle }}</p>
      </div>
    </div>

    <div class="grid min-h-[calc(100vh-9.5rem)] items-start gap-5 px-4 py-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-6">
      <aside class="app-panel app-workspace-nav min-h-[calc(100vh-9.5rem)] p-3 backdrop-blur-xl lg:sticky lg:top-20">
        <div class="space-y-1">
          <button
            v-for="item in fixedNavItems"
            :key="item.key"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
            :class="
              activeNavKey === item.key
                ? 'bg-primary/10 text-highlighted shadow-[inset_3px_0_0_var(--app-accent)]'
                : 'text-muted hover:bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)] hover:text-highlighted'
            "
            @click="activeNavKey = item.key"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">{{ item.label }}</span>
              <span class="block truncate text-xs opacity-75">{{ item.description }}</span>
            </span>
          </button>
        </div>

        <div class="mt-4 border-t border-default pt-4">
          <div class="mb-2 flex items-center justify-between gap-2 px-2">
            <p class="text-xs font-medium text-muted">对话目录</p>
            <button
              type="button"
              class="inline-flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-highlighted"
              aria-label="新建对话"
              title="新建对话"
              @click="createChat"
            >
              <UIcon name="i-lucide-plus" class="size-4" />
            </button>
          </div>

          <div class="space-y-1">
            <button
              v-for="chat in chatItems"
              :key="chat.id"
              type="button"
              class="w-full rounded-xl px-3 py-2 text-left transition-colors"
              :class="
                activeNavKey === `chat-${chat.id}`
                  ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-highlighted'
                  : 'text-muted hover:bg-elevated hover:text-highlighted'
              "
              @click="activeNavKey = `chat-${chat.id}`"
            >
              <span class="block truncate text-sm font-medium">{{ chat.title }}</span>
              <span class="mt-0.5 block truncate text-xs opacity-75">{{ chat.preview }}</span>
            </button>
          </div>
        </div>
      </aside>

      <main class="min-w-0">
        <DashboardSection v-if="activeNavKey === 'dashboard'" :analysis="analysis" />

        <InfoManagementSection
          v-else-if="activeNavKey === 'info'"
          v-model:info-form="infoForm"
          v-model:is-opportunity-info-editing="isOpportunityInfoEditing"
          v-model:is-terminate-popover-open="isTerminatePopoverOpen"
          v-model:termination-target="terminationTarget"
          v-model:termination-new-round-type="terminationNewRoundType"
          v-model:termination-new-round-title="terminationNewRoundTitle"
          v-model:termination-reason-note="terminationReasonNote"
          v-model:is-written-test-review-drawer-open="isWrittenTestReviewDrawerOpen"
          v-model:written-test-review-form="writtenTestReviewForm"
          v-model:written-test-date-popover-open="writtenTestDatePopoverOpen"
          v-model:written-test-calendar-date="writtenTestCalendarDate"
          v-model:is-assessment-drawer-open="isAssessmentDrawerOpen"
          v-model:round-form="roundForm"
          v-model:round-date-popover-open="roundDatePopoverOpen"
          v-model:round-calendar-date="roundCalendarDate"
          v-model:deleting-round-id="deletingRoundId"
          v-model:is-round-edit-drawer-open="isRoundEditDrawerOpen"
          v-model:round-edit-form="roundEditForm"
          v-model:edit-round-date-popover-open="editRoundDatePopoverOpen"
          v-model:edit-round-calendar-date="editRoundCalendarDate"
          :opportunity="opportunity"
          :analysis="analysis"
          :status-label-map="statusLabelMap"
          :status-flow="statusFlow"
          :current-status-index="currentStatusIndex"
          :status-motion-key="statusMotionKey"
          :previous-status="previousStatus"
          :next-status="nextStatus"
          :intention-options="intentionOptions"
          :has-opportunity-meta-changed="hasOpportunityMetaChanged"
          :info-saved-message="infoSavedMessage"
          :can-open-written-test-review="canOpenWrittenTestReview"
          :can-open-interview-assessment="canOpenInterviewAssessment"
          :termination-round-options="terminationRoundOptions"
          :available-assessment-round-type-options="availableAssessmentRoundTypeOptions"
          :interview-round-date-label="interviewRoundDateLabel"
          :written-test-date-label="writtenTestDateLabel"
          @go-to-previous-status="goToPreviousStatus"
          @advance-opportunity-status="advanceOpportunityStatus"
          @close-opportunity="closeOpportunity"
          @toggle-include-written-test="toggleIncludeWrittenTest"
          @save-info="saveInfo"
          @save-opportunity-meta="saveOpportunityMeta"
          @open-assessment-panel-from-status="openAssessmentPanelFromStatus"
          @open-written-test-review-drawer="openWrittenTestReviewDrawer"
          @close-written-test-review-drawer="closeWrittenTestReviewDrawer"
          @save-written-test-review="saveWrittenTestReview"
          @open-assessment-drawer="openAssessmentDrawer"
          @close-assessment-drawer="closeAssessmentDrawer"
          @add-interview-round="addInterviewRound"
          @handle-round-date-select="handleRoundDateSelect"
          @open-round-edit-drawer="openRoundEditDrawer"
          @confirm-delete-round="confirmDeleteRound"
          @close-round-edit-drawer="closeRoundEditDrawer"
          @handle-edit-round-date-select="handleEditRoundDateSelect"
          @handle-written-test-date-select="handleWrittenTestDateSelect"
          @save-round-edit="saveRoundEdit"
        />

        <MockInterviewSection
          v-else-if="activeNavKey === 'mock-interview'"
          :messages="mockInterviewMessages"
          :overall-score="overallInterviewScore"
        />

        <ChatSection v-else-if="isChatPage" :active-chat="activeChat" />
      </main>
    </div>
  </section>

  <section v-else class="app-empty-state p-10 text-center">
    <p class="text-sm text-muted">没有找到这条机会记录。</p>
    <UButton class="mt-4" color="neutral" variant="outline" icon="i-lucide-arrow-left" @click="goBack">
      返回机会管理
    </UButton>
  </section>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 33px !important;
  min-height: 33px !important;
}
</style>
