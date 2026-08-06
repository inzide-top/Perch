<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import type {
  InterviewRoundType,
  InterviewRound,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
  OpportunityTerminationReasonCode,
} from '@/types/opportunity'
import type { ReviewDocumentSummary } from '@/types/review'
import { useOpportunityStore, useSettingsStore } from '@/stores'
import { ApiRequestError } from '@/services/http'
import { getRecommendationClass, getRecommendationLabel } from '@/shared/opportunity/analysisPresentation'
import { formatDateOnly } from '@/shared/formatDate'
import ChatSection from './components/ChatSection.vue'
import DashboardSection from './components/DashboardSection.vue'
import InfoManagementSection from './components/InfoManagementSection.vue'
import OpportunityDetailSkeleton from './components/OpportunityDetailSkeleton.vue'
import InterviewWorkspaceSection from './interview/components/InterviewWorkspaceSection.vue'
import type {
  InterviewManagementTab,
  InterviewRoundForm,
  ChatItem,
  DetailNavItem,
  DetailNavKey,
  OpportunityInfoForm,
  WrittenTestReviewForm,
} from './types'

const route = useRoute()
const router = useRouter()
const opportunityStore = useOpportunityStore()
const settingsStore = useSettingsStore()
const toast = useToast()
const { opportunities, analyses, loadError, reviewDocumentsByOpportunity } = storeToRefs(opportunityStore)

function getConfiguredReviewModelConnection() {
  const connection = settingsStore.llm
  if (!connection.baseUrl.trim() || !connection.modelName.trim() || !connection.apiKey.trim()) return undefined

  return connection
}

const baseStatusFlow: { label: string; value: JobOpportunityStatus }[] = [
  { label: '待投递', value: 'pending_apply' },
  { label: '已投递', value: 'applied' },
  { label: '面试中', value: 'interviewing' },
  { label: '已 OC', value: 'oc' },
  { label: '已 Offer', value: 'offered' },
]
const statusLabelMap: Record<JobOpportunityStatus, string> = {
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
const interviewRoundTypeOptions: { label: string; value: InterviewRoundType }[] = [
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
    description: 'JD 与面试管理',
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
const activeNavKey = ref<DetailNavKey>(route.query.section === 'mock-interview' ? 'mock-interview' : 'dashboard')
const isOpportunityInfoEditing = ref(false)
const statusMotionKey = ref(0)
const isTerminatePopoverOpen = ref(false)
const roundDatePopoverOpen = ref(false)
const roundCalendarDate = ref<unknown>()
const editingRoundId = ref<string | null>(null)
const deletingRoundId = ref<string | null>(null)
const isInterviewReviewDrawerOpen = ref(false)
const interviewManagementTab = ref<InterviewManagementTab>('schedule')
const isWrittenTestReviewDrawerOpen = ref(false)
const isRoundEditDrawerOpen = ref(false)
const editRoundDatePopoverOpen = ref(false)
const editRoundCalendarDate = ref<unknown>()
const editingRoundInitialValue = ref<InterviewRoundForm | null>(null)
const writtenTestDatePopoverOpen = ref(false)
const writtenTestCalendarDate = ref<unknown>()
const roundDrawerBodyOverflow = ref('')
const roundDrawerLockCount = ref(0)
const terminationTarget = ref<'none' | 'new' | string>('none')
const terminationNewRoundType = ref<InterviewRoundType>('technical_basic')
const terminationNewRoundTitle = ref('')
const terminationReasonNote = ref('')
const isDetailLoading = ref(false)
const isDetailBootstrapping = ref(true)
const isSavingOpportunityInfo = ref(false)
const isSavingOpportunityMeta = ref(false)
const isStatusTransitioning = ref(false)
const isTogglingWrittenTestFlow = ref(false)
const isTerminatingOpportunity = ref(false)
const isAddingInterviewRound = ref(false)
const completingInterviewRoundId = ref<string | null>(null)
const cancelingInterviewRoundId = ref<string | null>(null)
const isSavingWrittenTestReview = ref(false)
const isSavingRoundEdit = ref(false)
const retryingReviewDocumentId = ref<string | null>(null)
const deletingRoundActionId = ref<string | null>(null)
const isUnsavedPreferenceLeaveDialogOpen = ref(false)
let pendingInternalLeaveAction: (() => void) | null = null
let pendingRouteLeaveResolver: ((shouldLeave: boolean) => void) | null = null

const opportunityId = computed(() => String(route.params.id ?? ''))
const opportunity = computed(() => opportunities.value.find((item) => item.id === opportunityId.value) ?? null)
const analysis = computed(() => analyses.value.find((item) => item.opportunityId === opportunityId.value) ?? null)
const reviewDocuments = computed(() => reviewDocumentsByOpportunity.value[opportunityId.value] ?? [])
const hasLoadedOpportunityDetail = computed(() => {
  return Boolean(opportunityId.value) && opportunityStore.hasOpportunityDetail(opportunityId.value)
})
const shouldShowDetailSkeleton = computed(
  () => !hasLoadedOpportunityDetail.value && (isDetailBootstrapping.value || isDetailLoading.value),
)
const analysisModelName = computed(() => {
  const task = opportunityStore.analysisTasks.find((item) => item.opportunityId === opportunityId.value)

  return task?.status === 'completed' ? task.modelName : null
})
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
const roundForm = reactive<InterviewRoundForm>({
  type: 'technical_basic' as InterviewRoundType,
  title: '',
  date: '',
  result: 'unknown',
  note: '',
  reviewNote: '',
})
const roundEditForm = reactive<InterviewRoundForm>({
  type: 'technical_basic' as InterviewRoundType,
  title: '',
  date: '',
  result: 'unknown',
  note: '',
  reviewNote: '',
})
const writtenTestReviewForm = reactive<WrittenTestReviewForm>({
  scheduledAt: '',
  reviewNote: '',
})
const statusFlow = computed(() => {
  if (!opportunity.value?.includeWrittenTest) return baseStatusFlow

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
  const currentStatus = opportunity.value?.status
  return statusFlow.value.findIndex((status) => status.value === currentStatus)
})

function getStatusFlowIndex(status: JobOpportunityStatus | null | undefined) {
  if (!status) return -1

  const normalizedStatus = status

  return statusFlow.value.findIndex((item) => item.value === normalizedStatus)
}

const reviewAvailableStatusIndex = computed(() => {
  if (opportunity.value?.status !== 'closed') return currentStatusIndex.value

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

  return statusIndex >= 0 && reviewAvailableStatusIndex.value >= statusIndex
}

const canOpenWrittenTestReview = computed(() => {
  return Boolean(opportunity.value?.includeWrittenTest) && hasCurrentStageReached('written_test')
})
const canOpenInterviewReview = computed(() => {
  return hasCurrentStageReached('interviewing')
})
const canCreateInterviewSchedule = computed(() => opportunity.value?.status === 'interviewing')
const nextStatus = computed(() => {
  if (opportunity.value?.status === 'closed') return null
  if (currentStatusIndex.value < 0) return statusFlow.value[0]

  return statusFlow.value[currentStatusIndex.value + 1] ?? null
})
const previousStatus = computed(() => {
  if (opportunity.value?.status === 'closed' || currentStatusIndex.value <= 0) return null

  return statusFlow.value[currentStatusIndex.value - 1] ?? null
})
const hasOpportunityMetaChanged = computed(() => {
  if (!opportunity.value) return false

  return (
    infoForm.intentionLevel !== opportunity.value.intentionLevel ||
    infoForm.industry !== opportunity.value.industry ||
    infoForm.note.trim() !== opportunity.value.note
  )
})
const hasRoundEditChanged = computed(() => {
  if (!editingRoundInitialValue.value) return false

  return (
    roundEditForm.type !== editingRoundInitialValue.value.type ||
    roundEditForm.title !== editingRoundInitialValue.value.title ||
    roundEditForm.date !== editingRoundInitialValue.value.date ||
    roundEditForm.result !== editingRoundInitialValue.value.result ||
    roundEditForm.note !== editingRoundInitialValue.value.note ||
    roundEditForm.reviewNote !== editingRoundInitialValue.value.reviewNote
  )
})
const canChangeWrittenTestFlow = computed(() => {
  const status = opportunity.value?.status

  return status !== 'interviewing' && status !== 'oc' && status !== 'offered' && status !== 'closed'
})
const interviewRoundDateLabel = computed(() => {
  return formatDateOnly(roundForm.date) || '请输入日期'
})
const writtenTestDateLabel = computed(() => {
  return formatDateOnly(writtenTestReviewForm.scheduledAt) || '请输入笔试时间'
})
const interviewRounds = computed(() => opportunity.value?.interviewRounds ?? [])
const editingInterviewRound = computed(
  () => interviewRounds.value.find((round) => round.id === editingRoundId.value) ?? null,
)
const availableInterviewRoundTypeOptions = computed(() => {
  return interviewRoundTypeOptions
})
const terminationRoundOptions = computed(() => {
  return [
    ...interviewRounds.value.map((round) => ({
      label: `${round.title} · ${getInterviewRoundTypeLabel(round.type)}`,
      value: round.id,
    })),
    { label: '新增一轮并终止', value: 'new' },
    { label: '不绑定具体轮次', value: 'none' },
  ]
})

function syncInfoForm() {
  if (!opportunity.value) return

  Object.assign(infoForm, {
    company: opportunity.value.company,
    jobTitle: opportunity.value.jobTitle,
    address: normalizeCityList(opportunity.value.address),
    introduction: opportunity.value.introduction,
    description: opportunity.value.description,
    status: opportunity.value.status,
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

function shouldConfirmUnsavedPreferenceLeave() {
  return activeNavKey.value === 'info' && hasOpportunityMetaChanged.value && !isSavingOpportunityMeta.value
}

function syncDetailSectionQuery(navKey: DetailNavKey) {
  const query = { ...route.query }

  if (navKey === 'mock-interview') {
    query.section = 'mock-interview'
  } else {
    delete query.section
  }

  void router.replace({ query })
}

function navigateDetailSection(navKey: DetailNavKey) {
  if (navKey === activeNavKey.value) return

  if (!shouldConfirmUnsavedPreferenceLeave()) {
    activeNavKey.value = navKey
    syncDetailSectionQuery(navKey)
    return
  }

  pendingInternalLeaveAction = () => {
    activeNavKey.value = navKey
    syncDetailSectionQuery(navKey)
  }
  isUnsavedPreferenceLeaveDialogOpen.value = true
}

function cancelUnsavedPreferenceLeave() {
  pendingInternalLeaveAction = null
  isUnsavedPreferenceLeaveDialogOpen.value = false
  pendingRouteLeaveResolver?.(false)
  pendingRouteLeaveResolver = null
}

function confirmUnsavedPreferenceLeave() {
  const internalLeaveAction = pendingInternalLeaveAction
  const routeLeaveResolver = pendingRouteLeaveResolver

  syncInfoForm()
  pendingInternalLeaveAction = null
  pendingRouteLeaveResolver = null
  isUnsavedPreferenceLeaveDialogOpen.value = false

  internalLeaveAction?.()
  routeLeaveResolver?.(true)
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!shouldConfirmUnsavedPreferenceLeave()) return

  event.preventDefault()
  event.returnValue = ''
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

async function loadOpportunityDetail(force = false) {
  if (!opportunityId.value) return

  const shouldShowLoading = force || !opportunityStore.hasOpportunityDetail(opportunityId.value)
  if (shouldShowLoading) isDetailLoading.value = true

  try {
    await opportunityStore.loadOpportunityDetail(opportunityId.value, { force })
  } finally {
    if (shouldShowLoading) isDetailLoading.value = false
  }
}

async function loadReviewDocuments() {
  if (!opportunityId.value) return

  try {
    await opportunityStore.loadReviewDocuments(opportunityId.value)
  } catch (error) {
    showRequestError('加载复盘提取状态失败', error)
  }
}

async function saveInfo() {
  if (!opportunity.value) return

  if (isSavingOpportunityInfo.value) return

  isSavingOpportunityInfo.value = true
  try {
    await opportunityStore.updateOpportunity(opportunity.value.id, {
      company: infoForm.company,
      jobTitle: infoForm.jobTitle,
      address: infoForm.address,
      introduction: infoForm.introduction,
      description: infoForm.description,
    })
    isOpportunityInfoEditing.value = false
    toast.add({ title: 'JD 信息已保存', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('保存 JD 信息失败', error)
  } finally {
    isSavingOpportunityInfo.value = false
  }
}

async function saveOpportunityMeta() {
  if (!opportunity.value || !hasOpportunityMetaChanged.value) return

  if (isSavingOpportunityMeta.value) return

  isSavingOpportunityMeta.value = true
  try {
    await opportunityStore.updateOpportunity(opportunity.value.id, {
      intentionLevel: infoForm.intentionLevel,
      industry: infoForm.industry,
      note: infoForm.note,
    })
    toast.add({ title: '求职偏好已保存', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('保存求职偏好失败', error)
  } finally {
    isSavingOpportunityMeta.value = false
  }
}

async function changeOpportunityStatus(status: JobOpportunityStatus) {
  if (
    !opportunity.value ||
    opportunity.value.status === 'closed' ||
    status === 'closed' ||
    opportunity.value.status === status ||
    isStatusTransitioning.value ||
    isTogglingWrittenTestFlow.value ||
    isTerminatingOpportunity.value
  ) {
    return
  }

  const expectedStatus = opportunity.value.status
  isStatusTransitioning.value = true
  try {
    await opportunityStore.updateOpportunityStatus(opportunity.value.id, { status, expectedStatus })
    statusMotionKey.value += 1
    isTerminatePopoverOpen.value = false
    toast.add({ title: `已更新为${statusLabelMap[status]}`, color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      await loadOpportunityDetail(true)
      toast.add({ title: '状态已同步', description: '该机会刚刚被其他操作更新，请按最新状态继续。', color: 'warning' })
    } else {
      showRequestError('更新机会状态失败', error)
    }
  } finally {
    isStatusTransitioning.value = false
  }
}

async function advanceOpportunityStatus() {
  if (!opportunity.value || !nextStatus.value) return

  await changeOpportunityStatus(nextStatus.value.value)
}

async function closeOpportunity() {
  if (
    !opportunity.value ||
    isTerminatingOpportunity.value ||
    isStatusTransitioning.value ||
    isTogglingWrittenTestFlow.value
  ) {
    return
  }

  const relatedRoundId =
    terminationTarget.value === 'none' || terminationTarget.value === 'new' ? undefined : terminationTarget.value
  let finalRelatedRoundId = relatedRoundId

  isTerminatingOpportunity.value = true
  try {
    if (terminationTarget.value === 'new') {
      const round = await opportunityStore.addInterviewRound(opportunity.value.id, {
        type: terminationNewRoundType.value,
        title: terminationNewRoundTitle.value || getDefaultNewTerminationRoundTitle(),
        status: 'completed',
        result: 'failed',
        note: terminationReasonNote.value,
      })
      finalRelatedRoundId = round?.id
    }

    await opportunityStore.terminateOpportunity(opportunity.value.id, {
      relatedInterviewRoundId: finalRelatedRoundId,
      reasonCode: getDefaultTerminationReasonCode(),
      reasonNote: terminationReasonNote.value,
    })
    statusMotionKey.value += 1
    isTerminatePopoverOpen.value = false
    toast.add({ title: '机会流程已终止', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('终止流程失败', error)
  } finally {
    isTerminatingOpportunity.value = false
  }
}

async function goToPreviousStatus() {
  if (!previousStatus.value) return

  await changeOpportunityStatus(previousStatus.value.value)
}

async function toggleIncludeWrittenTest() {
  if (
    !opportunity.value ||
    !canChangeWrittenTestFlow.value ||
    isTogglingWrittenTestFlow.value ||
    isStatusTransitioning.value ||
    isTerminatingOpportunity.value
  ) {
    return
  }

  const nextIncludeWrittenTest = !opportunity.value.includeWrittenTest
  const previousStatus = opportunity.value.status
  isTogglingWrittenTestFlow.value = true

  try {
    const updatedOpportunity = await opportunityStore.updateOpportunity(opportunity.value.id, {
      includeWrittenTest: nextIncludeWrittenTest,
    })
    statusMotionKey.value += 1
    toast.add({
      title: nextIncludeWrittenTest ? '已开启笔试流程' : '已关闭笔试流程',
      description:
        !nextIncludeWrittenTest && updatedOpportunity.status === 'applied' && previousStatus === 'written_test'
          ? '当前状态已同步回退到已投递，笔试复盘仍会保留。'
          : undefined,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    showRequestError('更新笔试流程失败', error)
  } finally {
    isTogglingWrittenTestFlow.value = false
  }
}

async function addInterviewRound(mode: InterviewManagementTab) {
  if (!opportunity.value || !roundForm.title.trim() || isAddingInterviewRound.value) return
  if (mode === 'schedule' && !canCreateInterviewSchedule.value) return

  isAddingInterviewRound.value = true
  try {
    await opportunityStore.addInterviewRound(opportunity.value.id, {
      type: roundForm.type,
      title: roundForm.title,
      scheduledAt: roundForm.date,
      status: mode === 'schedule' ? 'planned' : 'completed',
      result: mode === 'schedule' ? 'pending' : roundForm.result,
      note: mode === 'schedule' ? roundForm.note : '',
      reviewNote: mode === 'review' ? roundForm.reviewNote : '',
      modelConnection: mode === 'review' ? getConfiguredReviewModelConnection() : undefined,
    })
    if (mode === 'review') await loadReviewDocuments()
    Object.assign(roundForm, {
      type: getDefaultRoundType(),
      title: '',
      date: '',
      result: 'unknown',
      note: '',
      reviewNote: '',
    })
    roundCalendarDate.value = undefined
    toast.add({
      title: mode === 'schedule' ? '面试安排已创建' : '面试复盘已添加',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    showRequestError(mode === 'schedule' ? '创建面试安排失败' : '添加面试复盘失败', error)
  } finally {
    isAddingInterviewRound.value = false
  }
}

async function completeInterviewRound(round: InterviewRound) {
  if (!opportunity.value || completingInterviewRoundId.value || cancelingInterviewRoundId.value) return

  completingInterviewRoundId.value = round.id
  try {
    const completedRound = await opportunityStore.completeInterviewRound(opportunity.value.id, round.id)
    if (!completedRound) return

    interviewManagementTab.value = 'review'
    openRoundEditDrawer(completedRound)
    toast.add({
      title: '面试已完成',
      description: '可以继续补充本轮复盘。',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    showRequestError('更新面试安排失败', error)
  } finally {
    completingInterviewRoundId.value = null
  }
}

async function cancelInterviewRound(round: InterviewRound) {
  if (!opportunity.value || completingInterviewRoundId.value || cancelingInterviewRoundId.value) return

  cancelingInterviewRoundId.value = round.id
  try {
    await opportunityStore.cancelInterviewRound(opportunity.value.id, round.id)
    toast.add({ title: '面试安排已取消', color: 'success', icon: 'i-lucide-calendar-x' })
  } catch (error) {
    showRequestError('取消面试安排失败', error)
  } finally {
    cancelingInterviewRoundId.value = null
  }
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

function openInterviewReviewDrawer() {
  if (!canOpenInterviewReview.value) return

  interviewManagementTab.value = canCreateInterviewSchedule.value ? 'schedule' : 'review'
  isInterviewReviewDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeInterviewReviewDrawer() {
  if (isAddingInterviewRound.value || completingInterviewRoundId.value || cancelingInterviewRoundId.value) return

  isInterviewReviewDrawerOpen.value = false
  unlockRoundDrawerScroll()
}

function openWrittenTestReviewDrawer() {
  if (!canOpenWrittenTestReview.value) return

  isWrittenTestReviewDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeWrittenTestReviewDrawer(force = false) {
  if (isSavingWrittenTestReview.value && !force) return

  isWrittenTestReviewDrawerOpen.value = false
  unlockRoundDrawerScroll()
}

async function saveWrittenTestReview() {
  if (!opportunity.value || isSavingWrittenTestReview.value) return

  isSavingWrittenTestReview.value = true
  try {
    await opportunityStore.updateWrittenTestReview(opportunity.value.id, {
      scheduledAt: writtenTestReviewForm.scheduledAt,
      reviewNote: writtenTestReviewForm.reviewNote,
      modelConnection: getConfiguredReviewModelConnection(),
    })
    await loadReviewDocuments()
    closeWrittenTestReviewDrawer(true)
    toast.add({ title: '笔试复盘已保存', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('保存笔试复盘失败', error)
  } finally {
    isSavingWrittenTestReview.value = false
  }
}

function openRoundEditDrawer(round: InterviewRound) {
  editingRoundId.value = round.id
  Object.assign(roundEditForm, {
    type: round.type,
    title: round.title,
    date: round.scheduledAt,
    result: round.result,
    note: round.note,
    reviewNote: round.reviewNote,
  })
  editingRoundInitialValue.value = { ...roundEditForm }
  editRoundCalendarDate.value = undefined
  isRoundEditDrawerOpen.value = true
  lockRoundDrawerScroll()
}

function closeRoundEditDrawer(force = false) {
  if (isSavingRoundEdit.value && !force) return

  isRoundEditDrawerOpen.value = false
  editingRoundId.value = null
  editingRoundInitialValue.value = null
  unlockRoundDrawerScroll()
}

async function saveRoundEdit() {
  if (
    !opportunity.value ||
    !editingRoundId.value ||
    !roundEditForm.title.trim() ||
    !hasRoundEditChanged.value ||
    isSavingRoundEdit.value
  ) {
    return
  }

  isSavingRoundEdit.value = true
  try {
    const currentRound = interviewRounds.value.find((round) => round.id === editingRoundId.value)
    if (!currentRound) return

    const reviewNoteChanged = roundEditForm.reviewNote !== editingRoundInitialValue.value?.reviewNote
    await opportunityStore.updateInterviewRound(opportunity.value.id, editingRoundId.value, {
      type: roundEditForm.type,
      title: roundEditForm.title,
      scheduledAt: roundEditForm.date,
      ...(currentRound.status === 'planned'
        ? { note: roundEditForm.note }
        : {
            result: roundEditForm.result,
            ...(reviewNoteChanged
              ? {
                  reviewNote: roundEditForm.reviewNote,
                  modelConnection: getConfiguredReviewModelConnection(),
                }
              : {}),
          }),
    })
    if (reviewNoteChanged) await loadReviewDocuments()
    closeRoundEditDrawer(true)
    toast.add({ title: '面试记录已保存', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('保存面试记录失败', error)
  } finally {
    isSavingRoundEdit.value = false
  }
}

async function confirmDeleteRound(roundId: string) {
  if (!opportunity.value || deletingRoundActionId.value) return

  deletingRoundActionId.value = roundId
  try {
    await opportunityStore.deleteInterviewRound(opportunity.value.id, roundId)
    await loadReviewDocuments()
    deletingRoundId.value = null
    toast.add({ title: '面试记录已删除', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (error) {
    showRequestError('删除面试记录失败', error)
  } finally {
    deletingRoundActionId.value = null
  }
}

async function retryReviewDocument(document: ReviewDocumentSummary) {
  if (!opportunity.value || retryingReviewDocumentId.value || document.status !== 'failed') return

  const modelConnection = getConfiguredReviewModelConnection()
  if (!modelConnection) {
    toast.add({ title: '请先配置模型', description: '复盘提取需要可用的模型配置。', color: 'warning' })
    return
  }

  retryingReviewDocumentId.value = document.id
  try {
    await opportunityStore.retryReviewDocument(opportunity.value.id, document.id, modelConnection)
    toast.add({ title: '已重新开始复盘提取', color: 'success', icon: 'i-lucide-refresh-cw' })
  } catch (error) {
    showRequestError('重新提取复盘失败', error)
  } finally {
    retryingReviewDocumentId.value = null
  }
}

function showRequestError(fallbackTitle: string, error: unknown) {
  toast.add({
    title: fallbackTitle,
    description: error instanceof Error ? error.message : '请稍后重试。',
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function getInterviewRoundTypeLabel(type: InterviewRoundType) {
  return interviewRoundTypeOptions.find((item) => item.value === type)?.label ?? '其他'
}

function getDefaultRoundType(): InterviewRoundType {
  return 'technical_basic'
}

function getDefaultNewTerminationRoundTitle() {
  return `第 ${interviewRounds.value.length + 1} 轮`
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

function canOpenReviewFromStatus(status: JobOpportunityStatus) {
  if (status === 'written_test') return canOpenWrittenTestReview.value
  if (status === 'interviewing') return canOpenInterviewReview.value

  return false
}

function openReviewPanelFromStatus(status: JobOpportunityStatus) {
  if (!canOpenReviewFromStatus(status)) return

  if (status === 'written_test') {
    openWrittenTestReviewDrawer()
    return
  }

  openInterviewReviewDrawer()
}

function createChat() {
  const create = () => {
    const nextId = Math.max(0, ...chatItems.value.map((chat) => chat.id)) + 1

    chatItems.value.unshift({
      id: nextId,
      title: `新对话 ${nextId}`,
      preview: '围绕当前 JD 和简历继续提问',
    })
    activeNavKey.value = `chat-${nextId}`
  }

  if (!shouldConfirmUnsavedPreferenceLeave()) {
    create()
    return
  }

  pendingInternalLeaveAction = create
  isUnsavedPreferenceLeaveDialogOpen.value = true
}

onBeforeRouteLeave(() => {
  if (!shouldConfirmUnsavedPreferenceLeave()) return true

  return new Promise<boolean>((resolve) => {
    pendingInternalLeaveAction = null
    pendingRouteLeaveResolver = resolve
    isUnsavedPreferenceLeaveDialogOpen.value = true
  })
})

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

  terminationTarget.value = interviewRounds.value[0]?.id ?? 'none'
  terminationNewRoundType.value = getDefaultRoundType()
  terminationNewRoundTitle.value = ''
  terminationReasonNote.value = ''
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  void loadOpportunityDetail().finally(() => {
    isDetailBootstrapping.value = false
  })
  void loadReviewDocuments()
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  if (isInterviewReviewDrawerOpen.value || isWrittenTestReviewDrawerOpen.value || isRoundEditDrawerOpen.value) {
    roundDrawerLockCount.value = 1
    unlockRoundDrawerScroll()
  }
})
</script>

<template>
  <OpportunityDetailSkeleton v-if="shouldShowDetailSkeleton" />

  <section v-else-if="loadError && !hasLoadedOpportunityDetail" class="app-empty-state p-10 text-center">
    <p class="text-sm text-error">{{ loadError }}</p>
    <UButton
      class="mt-4"
      color="neutral"
      variant="outline"
      icon="i-lucide-rotate-cw"
      :loading="isDetailLoading"
      :disabled="isDetailLoading"
      @click="loadOpportunityDetail"
    >
      重新加载
    </UButton>
  </section>

  <section v-else-if="opportunity" class="min-h-[calc(100vh-4rem)] bg-[var(--app-bg)]">
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
            :class="`app-recommendation-badge ${getRecommendationClass(analysis.recommendation)}`"
            :label="`${analysis.matchScore} 分 · ${getRecommendationLabel(analysis.recommendation)}`"
          />
        </div>
        <div class="flex items-center">
          <p class="mt-1 text-sm text-muted">{{ opportunity.jobTitle }}</p>
          <p v-if="analysisModelName" class="ml-auto text-xs text-muted">
            当前分析结果来自 {{ analysisModelName }} 模型
          </p>
        </div>
      </div>
    </div>

    <div class="grid min-h-[calc(100vh-6.5rem)] items-start gap-5 px-4 py-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-6">
      <aside class="app-panel app-workspace-nav min-h-[calc(100vh-6.5rem)] p-3 backdrop-blur-xl lg:sticky lg:top-20">
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
            @click="navigateDetailSection(item.key)"
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
              @click="navigateDetailSection(`chat-${chat.id}`)"
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
          v-model:is-interview-review-drawer-open="isInterviewReviewDrawerOpen"
          v-model:interview-management-tab="interviewManagementTab"
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
          :has-round-edit-changed="hasRoundEditChanged"
          :is-saving-opportunity-info="isSavingOpportunityInfo"
          :is-saving-opportunity-meta="isSavingOpportunityMeta"
          :is-status-transitioning="isStatusTransitioning"
          :is-toggling-written-test-flow="isTogglingWrittenTestFlow"
          :can-change-written-test-flow="canChangeWrittenTestFlow"
          :is-terminating-opportunity="isTerminatingOpportunity"
          :is-adding-interview-round="isAddingInterviewRound"
          :completing-interview-round-id="completingInterviewRoundId"
          :canceling-interview-round-id="cancelingInterviewRoundId"
          :is-saving-written-test-review="isSavingWrittenTestReview"
          :is-saving-round-edit="isSavingRoundEdit"
          :deleting-round-action-id="deletingRoundActionId"
          :can-open-written-test-review="canOpenWrittenTestReview"
          :can-open-interview-review="canOpenInterviewReview"
          :can-create-interview-schedule="canCreateInterviewSchedule"
          :termination-round-options="terminationRoundOptions"
          :available-interview-round-type-options="availableInterviewRoundTypeOptions"
          :interview-round-date-label="interviewRoundDateLabel"
          :written-test-date-label="writtenTestDateLabel"
          :review-documents="reviewDocuments"
          :retrying-review-document-id="retryingReviewDocumentId"
          :editing-interview-round="editingInterviewRound"
          @go-to-previous-status="goToPreviousStatus"
          @advance-opportunity-status="advanceOpportunityStatus"
          @close-opportunity="closeOpportunity"
          @toggle-include-written-test="toggleIncludeWrittenTest"
          @save-info="saveInfo"
          @save-opportunity-meta="saveOpportunityMeta"
          @open-review-panel-from-status="openReviewPanelFromStatus"
          @open-written-test-review-drawer="openWrittenTestReviewDrawer"
          @close-written-test-review-drawer="closeWrittenTestReviewDrawer"
          @save-written-test-review="saveWrittenTestReview"
          @open-interview-review-drawer="openInterviewReviewDrawer"
          @close-interview-review-drawer="closeInterviewReviewDrawer"
          @add-interview-round="addInterviewRound"
          @complete-interview-round="completeInterviewRound"
          @cancel-interview-round="cancelInterviewRound"
          @handle-round-date-select="handleRoundDateSelect"
          @open-round-edit-drawer="openRoundEditDrawer"
          @confirm-delete-round="confirmDeleteRound"
          @close-round-edit-drawer="closeRoundEditDrawer"
          @handle-edit-round-date-select="handleEditRoundDateSelect"
          @handle-written-test-date-select="handleWrittenTestDateSelect"
          @save-round-edit="saveRoundEdit"
          @retry-review-document="retryReviewDocument"
        />

        <InterviewWorkspaceSection
          v-else-if="activeNavKey === 'mock-interview'"
          :opportunity-id="opportunityId"
          :analysis="analysis"
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

  <Teleport to="body">
    <div
      v-if="isUnsavedPreferenceLeaveDialogOpen"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-preference-dialog-title"
    >
      <div class="app-panel w-full max-w-sm p-5 shadow-xl">
        <div class="flex items-start gap-3">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
            <UIcon name="i-lucide-circle-alert" class="size-4" />
          </div>
          <div class="min-w-0">
            <h2 id="unsaved-preference-dialog-title" class="text-base font-semibold text-highlighted">
              有未保存的偏好改动
            </h2>
            <p class="mt-2 text-sm leading-6 text-muted">离开后本次求职偏好与备注改动将不会保存，是否确认离开？</p>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" @click="cancelUnsavedPreferenceLeave"> 取消 </UButton>
          <UButton type="button" color="warning" @click="confirmUnsavedPreferenceLeave">确认离开</UButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 33px !important;
  min-height: 33px !important;
}
</style>
