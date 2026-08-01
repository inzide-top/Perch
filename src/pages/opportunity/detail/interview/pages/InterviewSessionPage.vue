<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { useInterviewStore, useOpportunityStore, useSettingsStore } from '@/stores'
import { getAiTaskErrorPresentation } from '@/services/ai-errors'
import { getInterviewPollDelay, isSameModelIdentity } from '@/services/interview-runtime'
import type {
  AssistanceLevel,
  InterviewAnswer,
  InterviewInteraction,
  InterviewQuestion,
  InterviewQuestionFeedback,
  SkipReason,
} from '@/types/interview'
import AnswerReviewDrawer from '../components/AnswerReviewDrawer.vue'
import InterviewComposer from '../components/InterviewComposer.vue'
import InterviewOverallPanel from '../components/InterviewOverallPanel.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const interviewStore = useInterviewStore()
const opportunityStore = useOpportunityStore()
const settingsStore = useSettingsStore()
const { opportunities } = storeToRefs(opportunityStore)

const draft = ref('')
const isHintConfirmOpen = ref(false)
const pendingHintLevel = ref<'level_1' | 'level_2' | null>(null)
const isEndConfirmOpen = ref(false)
const selectedAnswerId = ref<string | null>(null)
const selectedQuestionId = ref<string | null>(null)
const isReviewDrawerOpen = ref(false)
const isMobileScoreOpen = ref(false)
const highlightedTurnId = ref<string | null>(null)
const feedbackQuestionId = ref<string | null>(null)
const feedbackValue = ref<'like' | 'dislike'>('like')
const feedbackReason = ref('')
const isSavingFeedback = ref(false)
const isHeaderCollapsed = ref(false)
const headerRef = ref<HTMLElement | null>(null)
const expandedHeaderHeight = ref<number | null>(null)
const transcriptRef = ref<HTMLElement | null>(null)
const isTranscriptPinnedToBottom = ref(true)
const planLoadingNow = ref(Date.now())
let headerCollapseTimer: number | null = null
let sessionPollTimer: number | null = null
let planLoadingTimer: number | null = null
let reviewHighlightTimer: number | null = null
let isPageMounted = false

const opportunityId = computed(() => String(route.params.id ?? ''))
const sessionId = computed(() => String(route.params.sessionId ?? ''))
const session = computed(() => interviewStore.session(sessionId.value))
const opportunity = computed(() => opportunities.value.find((item) => item.id === opportunityId.value) ?? null)
const pendingAnswer = computed(() => interviewStore.pendingAnswerForSession(sessionId.value))
const currentQuestion = computed(() => {
  const currentSession = session.value
  return currentSession?.questions.find((item) => item.id === currentSession.currentQuestionId) ?? null
})
const isLoading = computed(() => interviewStore.isSessionLoading(sessionId.value))
const error = computed(() => interviewStore.errorsByScope[`session:${sessionId.value}`])
const isAiOutputting = computed(() => {
  if (pendingAnswer.value) return true

  const phase = session.value?.phase
  return (
    phase === 'building_plan' ||
    phase === 'generating_first_question' ||
    phase === 'validating_answer' ||
    phase === 'clarifying_question' ||
    phase === 'evaluating_answer' ||
    phase === 'generating_question' ||
    phase === 'generating_review'
  )
})
const canOperateQuestion = computed(() => {
  return (
    session.value?.status === 'active' &&
    session.value.phase === 'awaiting_answer' &&
    !pendingAnswer.value &&
    !isSkippingQuestion.value &&
    isModelReady.value &&
    isSessionModelConsistent.value
  )
})
const isSubmissionPhase = computed(() => {
  if (pendingAnswer.value) return true

  const phase = session.value?.phase
  return phase === 'validating_answer' || phase === 'evaluating_answer'
})
const canCancelPendingAnswer = computed(() => Boolean(pendingAnswer.value))
const isCancellingPendingAnswer = computed(() => interviewStore.isAnswerCancellationPending(sessionId.value))
const isSkippingQuestion = computed(() => interviewStore.isQuestionSkipping(sessionId.value))
const isAnswerProcessingFailed = computed(() => session.value?.phase === 'answer_processing_failed')
const shouldShowAnswerProcessingPlaceholder = computed(() =>
  Boolean(
    !session.value?.streamingText &&
    (isAnswerProcessingFailed.value ||
      pendingAnswer.value ||
      session.value?.phase === 'validating_answer' ||
      session.value?.phase === 'evaluating_answer'),
  ),
)
const shouldShowQuestionGenerationPlaceholder = computed(() =>
  Boolean(
    !session.value?.streamingKind &&
    !session.value?.streamingText &&
    (isSkippingQuestion.value || session.value?.phase === 'generating_question'),
  ),
)
const completionNotice = computed(() => {
  const currentSession = session.value
  if (!currentSession || currentSession.streamingText || shouldShowAnswerProcessingPlaceholder.value) return null
  if (currentSession.status === 'finalizing') {
    return {
      content: '本轮问题已完成，正在生成本轮评估…',
      createdAt: currentSession.lastActivityAt,
    }
  }
  if (currentSession.status === 'completed') {
    return {
      content: '模拟面试已结束，可在右侧查看本轮评估。',
      createdAt: currentSession.completedAt ?? currentSession.lastActivityAt,
    }
  }

  return null
})
const isPlanPreparationLoading = computed(() => {
  const currentSession = session.value

  return (
    currentSession?.status === 'preparing' ||
    currentSession?.phase === 'building_plan' ||
    currentSession?.phase === 'generating_first_question'
  )
})
const planLoadingElapsedSeconds = computed(() => {
  const startTime = session.value?.startedAt ? new Date(session.value.startedAt).getTime() : planLoadingNow.value
  if (!Number.isFinite(startTime)) return 0

  return Math.max(0, Math.floor((planLoadingNow.value - startTime) / 1000))
})
const planLoadingCopy = computed(() => {
  const elapsedSeconds = planLoadingElapsedSeconds.value
  if (elapsedSeconds < 8) {
    return {
      title: '正在读取面试上下文',
      detail: '整合 JD、简历、匹配结论和本轮配置。',
    }
  }
  if (elapsedSeconds < 22) {
    return {
      title: '正在标定岗位难度',
      detail: '把通用难度规则转换为当前岗位专属的基础、标准和进阶标准。',
    }
  }
  if (elapsedSeconds < 45) {
    return {
      title: '正在规划主题与首题',
      detail: '筛选基础能力主题、生成评估点，并准备第一道问题和两级提示。',
    }
  }

  return {
    title: '模型响应较慢，仍在生成',
    detail: '你可以停留在当前页面，面试蓝图完成后会自动刷新。',
  }
})
const isModelReady = computed(() => {
  const { baseUrl, modelName, apiKey } = settingsStore.llm
  return Boolean(baseUrl.trim() && modelName.trim() && apiKey.trim())
})
const isSessionModelConsistent = computed(() => {
  const currentSession = session.value
  return !currentSession || isSameModelIdentity(currentSession.model, settingsStore.llm)
})
const taskFailurePresentation = computed(() => getAiTaskErrorPresentation(session.value?.taskError))
const isSessionModelMismatchActionable = computed(
  () => session.value?.status === 'active' && !isSessionModelConsistent.value,
)
const canSwitchSessionModel = computed(() => {
  const phase = session.value?.phase
  return session.value?.status === 'active' && (phase === 'awaiting_answer' || phase === 'answer_processing_failed')
})
const canRetryCurrentTask = computed(
  () => isModelReady.value && isSessionModelConsistent.value && !interviewStore.isGenerating(sessionId.value),
)
const retryDisabledReason = computed(() => {
  if (!isModelReady.value) return '请先配置可用模型'
  if (!isSessionModelConsistent.value) return '请先确认将本轮面试切换到当前模型'
  if (interviewStore.isGenerating(sessionId.value)) return '正在重新执行当前任务'
  return '重试当前任务'
})
const selectedAnswer = computed(() => session.value?.answers.find((item) => item.id === selectedAnswerId.value) ?? null)
const selectedQuestion = computed(
  () => session.value?.questions.find((item) => item.id === selectedQuestionId.value) ?? null,
)
const isSelectedAnswerReviewing = computed(() =>
  selectedAnswerId.value ? interviewStore.isAnswerReviewing(selectedAnswerId.value) : false,
)
const activeSession = computed(
  () =>
    session.value?.status === 'active' ||
    session.value?.status === 'preparing' ||
    session.value?.status === 'finalizing',
)
const headerStyle = computed(() => {
  if (isHeaderCollapsed.value) return { height: '3.5rem' }
  if (expandedHeaderHeight.value === null) return undefined

  return { height: `${expandedHeaderHeight.value}px` }
})

function getDraftKey(questionId: string) {
  return `perch:interview-draft:${sessionId.value}:${questionId}`
}

function getQuestionAnswer(questionId: string) {
  return session.value?.answers.find((item) => item.questionId === questionId) ?? null
}

function getQuestionPendingAnswer(questionId: string) {
  return interviewStore.pendingAnswerForTurn(questionId)
}

function getQuestionInteractions(questionId: string) {
  return session.value?.interactions.filter((item) => item.questionId === questionId) ?? []
}

function getInteractionLabel(interaction: InterviewInteraction) {
  if (interaction.role === 'candidate') {
    return interaction.type === 'clarification_request' ? '你的澄清' : '你的消息'
  }

  return interaction.type === 'clarification_response' ? '问题澄清' : '面试引导'
}

function getQuestionSkip(questionId: string) {
  return session.value?.skips.find((item) => item.questionId === questionId) ?? null
}

function openReviewReference(turnId: string) {
  highlightedTurnId.value = turnId
  if (reviewHighlightTimer !== null) window.clearTimeout(reviewHighlightTimer)
  reviewHighlightTimer = window.setTimeout(() => {
    highlightedTurnId.value = null
    reviewHighlightTimer = null
  }, 2_400)

  void nextTick(() => {
    const target =
      document.getElementById(`interview-answer-${turnId}`) ?? document.getElementById(`interview-question-${turnId}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function getTypeLabel() {
  return session.value?.config.type === 'project' ? '项目面' : '基础面'
}

function getDifficultyLabel() {
  const difficulty = session.value?.config.difficulty
  if (difficulty === 'advanced') return '进阶难度'
  if (difficulty === 'basic') return '基础难度'
  if (difficulty === 'adaptive') return '自适应难度'
  return '标准难度'
}

function getScaleLabel() {
  const scale = session.value?.config.scale
  if (scale === 'quick') return '快速训练'
  if (scale === 'deep') return '深度训练'
  return '标准训练'
}

function getPhaseLabel() {
  if (pendingAnswer.value?.status === 'cancelling') return '正在中止回答处理'
  if (pendingAnswer.value) return '正在分析你的回答'
  if (isPlanPreparationLoading.value) return planLoadingCopy.value.title
  if (isSessionModelMismatchActionable.value) return '当前模型与本轮面试不一致'

  const map = {
    building_plan: '正在准备面试蓝图',
    generating_first_question: '正在生成第一个问题',
    validating_answer: '正在确认你的回答',
    clarifying_question: '正在澄清问题',
    evaluating_answer: '正在评估回答',
    generating_question: '正在生成下一题',
    generating_review: '正在生成本轮复盘',
    question_generation_failed: '下一题生成失败',
    answer_processing_failed: '回答评估失败',
    review_generation_failed: '复盘生成失败',
    model_configuration_required: '需要配置模型',
    preparation_failed: '面试准备失败',
    awaiting_answer: '等待你的回答',
    review_ready: '',
  } as const

  return session.value ? map[session.value.phase] : '正在加载'
}

async function switchToCurrentModel() {
  const switched = await interviewStore.switchSessionModel(sessionId.value)
  if (!switched) return
  toast.add({ title: `本轮面试已切换至 ${settingsStore.llm.modelName}`, color: 'success' })
}

function getStatusLabel() {
  const map = {
    preparing: '准备中',
    preparation_failed: '准备失败',
    active: '进行中',
    finalizing: '生成复盘中',
    completed: '已完成',
    ended_early: '提前结束',
    cancelled: '已取消',
  } as const

  return session.value ? map[session.value.status] : ''
}

function getStatusColor() {
  const status = session.value?.status
  if (status === 'completed') return 'success'
  if (status === 'ended_early') return 'warning'
  if (status === 'active' || status === 'preparing' || status === 'finalizing') return 'primary'
  return 'neutral'
}

function getAssistanceLabel(level: AssistanceLevel) {
  if (level === 'level_2') return '使用二级提示'
  if (level === 'level_1') return '使用一级提示'
  return ''
}

function getSkipLabel(reason: SkipReason) {
  const map = {
    unknown: '不会回答',
    too_hard: '难度太高',
    unclear: '问题不清楚',
    irrelevant: '与岗位无关',
    declined: '暂不想回答',
    unspecified: '未说明原因',
  } as const

  return map[reason]
}

function getFeedbackReasons(value: 'like' | 'dislike') {
  return value === 'like'
    ? ['真实贴近面试', '提问方向有价值', '追问足够深入', '难度合适', '表达清楚']
    : ['与岗位无关', '问题重复', '难度不合适', '表达不清楚', '事实不准确']
}

function getFeedbackPopoverId(questionId: string, value: 'like' | 'dislike') {
  return value === 'like' ? questionId : `${questionId}:dislike`
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function goBack() {
  void router.push({ name: 'opportunity-interviews', params: { id: opportunityId.value } })
}

function syncExpandedHeaderHeight() {
  const header = headerRef.value
  if (!header || isHeaderCollapsed.value) return

  const previousHeight = header.style.height
  header.style.height = 'auto'
  expandedHeaderHeight.value = header.offsetHeight
  header.style.height = previousHeight
}

function setHeaderCollapsed(value: boolean) {
  if (headerCollapseTimer !== null) {
    window.clearTimeout(headerCollapseTimer)
    headerCollapseTimer = null
  }

  if (value) syncExpandedHeaderHeight()
  isHeaderCollapsed.value = value
}

function scrollTranscriptToBottom(options: { force?: boolean; behavior?: 'auto' | 'smooth' } = {}) {
  const transcript = transcriptRef.value
  if (!transcript || (!options.force && !isTranscriptPinnedToBottom.value)) return

  transcript.scrollTo({ top: transcript.scrollHeight, behavior: options.behavior ?? 'auto' })
  isTranscriptPinnedToBottom.value = true
}

function handleTranscriptScroll() {
  const transcript = transcriptRef.value
  if (!transcript) return

  const distanceToBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
  isTranscriptPinnedToBottom.value = distanceToBottom <= 48
}

function returnToLatestMessage() {
  scrollTranscriptToBottom({ force: true, behavior: 'smooth' })
}

function clearSessionPoll() {
  if (sessionPollTimer === null) return
  window.clearTimeout(sessionPollTimer)
  sessionPollTimer = null
}

function clearPlanLoadingTimer() {
  if (planLoadingTimer === null) return
  window.clearInterval(planLoadingTimer)
  planLoadingTimer = null
}

function shouldPollSession() {
  const currentSession = session.value
  if (!currentSession || isCancellingPendingAnswer.value) return false

  return (
    currentSession.status === 'preparing' ||
    currentSession.status === 'finalizing' ||
    currentSession.phase === 'building_plan' ||
    currentSession.phase === 'generating_first_question' ||
    currentSession.phase === 'validating_answer' ||
    currentSession.phase === 'evaluating_answer' ||
    currentSession.phase === 'generating_question' ||
    currentSession.phase === 'generating_review'
  )
}

function scheduleSessionPoll() {
  if (typeof window === 'undefined') return
  clearSessionPoll()
  if (!isPageMounted || !sessionId.value || !shouldPollSession()) return

  const visibilityState = typeof document === 'undefined' ? 'unsupported' : document.visibilityState

  sessionPollTimer = window.setTimeout(() => {
    sessionPollTimer = null
    if (!isPageMounted || !shouldPollSession()) return

    void interviewStore.pollSessionStatus(sessionId.value).finally(scheduleSessionPoll)
  }, getInterviewPollDelay(visibilityState))
}

function handleVisibilityChange() {
  if (!isPageMounted) return
  clearSessionPoll()
  if (!shouldPollSession()) return

  if (document.visibilityState === 'visible') {
    void interviewStore.pollSessionStatus(sessionId.value).finally(scheduleSessionPoll)
    return
  }
  scheduleSessionPoll()
}

function syncPlanLoadingTimer() {
  if (typeof window === 'undefined') return
  if (!isPlanPreparationLoading.value) {
    clearPlanLoadingTimer()
    return
  }
  if (planLoadingTimer !== null) return

  planLoadingNow.value = Date.now()
  planLoadingTimer = window.setInterval(() => {
    planLoadingNow.value = Date.now()
  }, 1000)
}

function scheduleHeaderCollapse() {
  if (typeof window === 'undefined') return
  if (headerCollapseTimer !== null) window.clearTimeout(headerCollapseTimer)
  headerCollapseTimer = window.setTimeout(() => {
    void setHeaderCollapsed(true)
    headerCollapseTimer = null
  }, 3000)
}

async function handleSubmit() {
  const current = currentQuestion.value
  if (!current || !canOperateQuestion.value || !draft.value.trim()) return

  const answerContent = draft.value.trim()
  isTranscriptPinnedToBottom.value = true
  localStorage.removeItem(getDraftKey(current.id))
  draft.value = ''
  void nextTick(() => scrollTranscriptToBottom({ force: true, behavior: 'smooth' }))

  const result = await interviewStore.submitAnswer(sessionId.value, answerContent)
  if (result.type === 'accepted') {
    localStorage.removeItem(getDraftKey(current.id))
    return
  }

  if (result.type !== 'aborted') draft.value = answerContent
}

function handleCancelSubmit() {
  const restoredContent = interviewStore.cancelPendingAnswer(sessionId.value)
  if (!restoredContent) return

  draft.value = restoredContent
  const questionId = currentQuestion.value?.id
  if (questionId && typeof localStorage !== 'undefined') localStorage.setItem(getDraftKey(questionId), restoredContent)
}

function requestHint(level: 'level_1' | 'level_2') {
  if (!session.value || !canOperateQuestion.value) return
  if (level === 'level_1' && !session.value.hintImpactAcknowledged) {
    pendingHintLevel.value = level
    isHintConfirmOpen.value = true
    return
  }

  void interviewStore.revealHint(sessionId.value, level)
}

async function confirmHint() {
  const level = pendingHintLevel.value
  if (!level || !session.value) return

  await interviewStore.acknowledgeHintImpact(sessionId.value)
  await interviewStore.revealHint(sessionId.value, level)
  pendingHintLevel.value = null
  isHintConfirmOpen.value = false
}

function cancelHintConfirmation() {
  isHintConfirmOpen.value = false
  pendingHintLevel.value = null
}

async function handleSkip(reason: SkipReason) {
  if (!canOperateQuestion.value) return
  const current = currentQuestion.value
  const skipped = await interviewStore.skipQuestion(sessionId.value, reason)
  if (!skipped) return
  if (current) localStorage.removeItem(getDraftKey(current.id))
  draft.value = ''
}

async function retryTask() {
  if (!isModelReady.value) {
    toast.add({
      title: '请先配置可用模型',
      description: '当前任务需要模型配置，完成设置后再回来重试。',
      color: 'warning',
      icon: 'i-lucide-settings',
    })
    return
  }
  if (!isSessionModelConsistent.value) {
    toast.add({
      title: '请先确认切换本轮模型',
      description: '本轮面试仍绑定原模型，确认切换后才可以重试失败任务。',
      color: 'warning',
      icon: 'i-lucide-git-compare-arrows',
    })
    return
  }
  if (interviewStore.isGenerating(sessionId.value)) return

  await interviewStore.retryCurrentTask(sessionId.value)
}

async function confirmEndSession() {
  isEndConfirmOpen.value = false
  await interviewStore.endSession(sessionId.value)
}

function openAnswerReview(answer: InterviewAnswer, question: InterviewQuestion) {
  selectedAnswerId.value = answer.id
  selectedQuestionId.value = question.id
  isReviewDrawerOpen.value = true
  if (answer.deepReviewStatus === 'completed' || answer.deepReviewStatus === 'processing') {
    void interviewStore.loadAnswerReview(sessionId.value, answer.id)
  }
}

async function generateAnswerReview() {
  if (!selectedAnswer.value) return
  const answerSequence =
    (session.value?.answers.findIndex((answer) => answer.id === selectedAnswer.value?.id) ?? -1) + 1
  const result = await interviewStore.generateAnswerReview(sessionId.value, selectedAnswer.value.id, {
    primary: opportunity.value
      ? `${opportunity.value.company} · ${opportunity.value.jobTitle}`
      : `${getTypeLabel()}模拟面试`,
    secondary: `${getTypeLabel()} · 第 ${Math.max(answerSequence, 1)} 次回答`,
  })
  if (result.status === 'capacity_exceeded') {
    toast.add({
      title: '深度点评任务已达上限',
      description: result.message,
      color: 'warning',
      icon: 'i-lucide-circle-alert',
    })
  }
}

function openFeedback(question: InterviewQuestion, value: 'like' | 'dislike') {
  if (question.feedback && !question.feedback.locked && question.feedback.value === value) {
    void interviewStore.submitQuestionFeedback(sessionId.value, question.id, null)
    return
  }

  feedbackQuestionId.value = getFeedbackPopoverId(question.id, value)
  feedbackValue.value = value
  feedbackReason.value = question.feedback?.reason ?? ''
}

function updateFeedbackPopover(questionId: string, value: 'like' | 'dislike', isOpen: boolean) {
  feedbackQuestionId.value = isOpen ? getFeedbackPopoverId(questionId, value) : null
}

async function saveFeedback(question: InterviewQuestion) {
  if (isSavingFeedback.value) return

  isSavingFeedback.value = true
  try {
    const feedback: InterviewQuestionFeedback = {
      value: feedbackValue.value,
      reason: feedbackReason.value.trim(),
      submittedAt: new Date().toISOString(),
      locked: Boolean(feedbackReason.value.trim()),
    }
    await interviewStore.submitQuestionFeedback(sessionId.value, question.id, feedback)
    feedbackQuestionId.value = null
    toast.add({ title: '问题反馈已保存', color: 'success', icon: 'i-lucide-circle-check' })
  } finally {
    isSavingFeedback.value = false
  }
}

function loadDraft(questionId: string | null) {
  if (!questionId || typeof localStorage === 'undefined') {
    draft.value = ''
    return
  }

  const currentSession = session.value
  const pendingSubmission = interviewStore.pendingAnswerForTurn(questionId)
  const acceptedAnswer = currentSession?.answers.find((answer) => answer.questionId === questionId)
  const answerIsOwnedByServer =
    Boolean(acceptedAnswer?.clientSubmissionId) &&
    (currentSession?.phase === 'validating_answer' ||
      currentSession?.phase === 'evaluating_answer' ||
      currentSession?.phase === 'answer_processing_failed')
  if (pendingSubmission || answerIsOwnedByServer) {
    localStorage.removeItem(getDraftKey(questionId))
    draft.value = ''
    return
  }

  draft.value = localStorage.getItem(getDraftKey(questionId)) ?? ''
}

watch(
  () =>
    [
      currentQuestion.value?.id ?? null,
      session.value?.phase ?? null,
      currentQuestion.value ? (getQuestionAnswer(currentQuestion.value.id)?.clientSubmissionId ?? null) : null,
    ] as const,
  ([questionId]) => loadDraft(questionId),
  { immediate: true },
)
watch(draft, (value) => {
  const questionId = currentQuestion.value?.id
  if (!questionId || typeof localStorage === 'undefined') return
  const key = getDraftKey(questionId)
  if (!value.trim()) {
    localStorage.removeItem(key)
    return
  }
  localStorage.setItem(key, value)
})

watch(
  () => [
    session.value?.questions.length,
    session.value?.answers.length,
    pendingAnswer.value?.status,
    pendingAnswer.value?.content,
    session.value?.interactions.length,
    session.value?.skips.length,
    session.value?.streamingText,
    currentQuestion.value?.revealedHintLevel,
  ],
  () => {
    void nextTick(() => scrollTranscriptToBottom())
  },
  { flush: 'post' },
)

watch(
  () => [
    sessionId.value,
    session.value?.status,
    session.value?.phase,
    session.value?.currentQuestionId,
    pendingAnswer.value?.status,
    isCancellingPendingAnswer.value,
  ],
  () => scheduleSessionPoll(),
  { flush: 'post' },
)

watch(
  () => isPlanPreparationLoading.value,
  () => syncPlanLoadingTimer(),
  { immediate: true },
)

watch(
  () => [
    opportunity.value?.company,
    opportunity.value?.jobTitle,
    session.value?.status,
    session.value?.phase,
    session.value?.config.scale,
    session.value?.config.difficulty,
    session.value?.config.referenceHistoricalWeaknesses,
  ],
  () => void nextTick(syncExpandedHeaderHeight),
  { flush: 'post' },
)

onMounted(() => {
  isPageMounted = true
  void Promise.all([
    interviewStore.loadSession(sessionId.value, { force: true }),
    opportunityStore.loadOpportunityDetail(opportunityId.value),
  ]).then(async () => {
    const recovery = await interviewStore.resumeInterruptedAnswer(sessionId.value)
    if (recovery?.type !== 'restore_draft') return

    draft.value = recovery.content
    const questionId = currentQuestion.value?.id
    if (questionId && typeof localStorage !== 'undefined')
      localStorage.setItem(getDraftKey(questionId), recovery.content)
  })
  scheduleHeaderCollapse()
  void nextTick(() => {
    syncExpandedHeaderHeight()
    scrollTranscriptToBottom({ force: true })
  })
  window.addEventListener('resize', syncExpandedHeaderHeight)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  isPageMounted = false
  if (headerCollapseTimer !== null) window.clearTimeout(headerCollapseTimer)
  clearSessionPoll()
  clearPlanLoadingTimer()
  if (reviewHighlightTimer !== null) window.clearTimeout(reviewHighlightTimer)
  window.removeEventListener('resize', syncExpandedHeaderHeight)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  interviewStore.cancelSessionLoad(sessionId.value)
})
</script>

<template>
  <section class="min-h-[calc(100vh-4rem)] bg-[var(--app-bg)] px-4 py-5 lg:px-6">
    <div class="mx-auto max-w-[1440px]">
      <header
        ref="headerRef"
        class="app-panel interview-session-header mb-5 flex flex-wrap justify-between gap-4 px-5 py-4"
        :class="isHeaderCollapsed ? 'is-collapsed items-center' : 'items-start'"
        :style="headerStyle"
      >
        <Transition name="interview-header-content" mode="out-in" @after-enter="syncExpandedHeaderHeight">
          <div v-if="!isHeaderCollapsed" key="expanded" class="min-w-0">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-arrow-left"
              class="-ml-2"
              @click="goBack"
              >返回模拟面试</UButton
            >
            <p class="mt-1 text-xs font-medium text-muted">
              {{ opportunity?.company ?? '当前机会' }} · {{ opportunity?.address?.join('、') || '未填写 Base' }}
            </p>
            <div class="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold tracking-tight text-highlighted">
                {{ opportunity?.jobTitle ?? '模拟面试' }}
              </h1>
              <span class="interview-session-type">{{ getTypeLabel() }}</span>
              <UBadge v-if="session" :color="getStatusColor()" variant="subtle" :label="getStatusLabel()" />
            </div>
            <div v-if="session" class="interview-session-config mt-1">
              <span><UIcon name="i-lucide-timer" class="size-3.5" />{{ getScaleLabel() }}</span>
              <span><UIcon name="i-lucide-gauge" class="size-3.5" />{{ getDifficultyLabel() }}</span>
              <span v-if="session.config.referenceHistoricalWeaknesses" class="is-history-aware"
                ><UIcon name="i-lucide-history" class="size-3.5" />已参考历史薄弱项</span
              >
            </div>
            <div v-if="getPhaseLabel()" class="interview-session-phase mt-2">
              <UIcon
                :name="isAiOutputting ? 'i-lucide-loader-circle' : 'i-lucide-message-circle'"
                class="size-3.5"
                :class="{ 'animate-spin': isAiOutputting }"
              />
              <span>{{ getPhaseLabel() }}</span>
            </div>
          </div>
          <div v-else key="collapsed" class="flex min-w-0 items-center gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-arrow-left"
              aria-label="返回模拟面试"
              @click="goBack"
            />
            <span class="truncate text-sm font-medium text-highlighted"
              >{{ opportunity?.company ?? '当前机会' }} · {{ opportunity?.jobTitle ?? getTypeLabel() }}</span
            >
            <span class="interview-session-type">{{ getTypeLabel() }}</span>
            <UBadge v-if="session" :color="getStatusColor()" variant="subtle" :label="getStatusLabel()" />
          </div>
        </Transition>
        <div class="flex items-center gap-2" :class="{ 'self-end': !isHeaderCollapsed }">
          <UButton
            type="button"
            class="xl:hidden"
            color="neutral"
            variant="outline"
            icon="i-lucide-chart-no-axes-combined"
            @click="isMobileScoreOpen = true"
            >总体表现</UButton
          >
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :icon="isHeaderCollapsed ? 'i-lucide-panel-top-open' : 'i-lucide-panel-top-close'"
            :aria-label="isHeaderCollapsed ? '展开机会信息' : '收起机会信息'"
            :title="isHeaderCollapsed ? '展开机会信息' : '收起机会信息'"
            @click="setHeaderCollapsed(!isHeaderCollapsed)"
          />
          <UButton
            v-if="activeSession"
            type="button"
            color="error"
            variant="ghost"
            icon="i-lucide-circle-stop"
            :disabled="session?.status === 'finalizing'"
            @click="isEndConfirmOpen = true"
            ><span v-if="!isHeaderCollapsed">结束本轮</span></UButton
          >
        </div>
      </header>

      <section v-if="isLoading && !session" class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="app-panel min-h-[42rem] animate-pulse p-5"><div class="h-20 w-2/3 rounded-2xl bg-elevated" /></div>
        <div class="app-panel min-h-[26rem] animate-pulse p-5"><div class="h-full rounded-2xl bg-elevated" /></div>
      </section>

      <section v-else-if="!session" class="app-empty-state p-10 text-center">
        <p class="text-sm text-error">{{ error ?? '没有找到这条模拟面试记录。' }}</p>
        <UButton type="button" class="mt-4" color="neutral" variant="outline" icon="i-lucide-arrow-left" @click="goBack"
          >返回模拟面试</UButton
        >
      </section>

      <template v-else>
        <section v-if="!isModelReady && activeSession" class="app-empty-state mb-5 border-warning/30 p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                <UIcon name="i-lucide-key-round" class="size-4" />
              </div>
              <div>
                <p class="text-sm font-medium text-highlighted">当前面试需要可用模型配置</p>
                <p class="mt-1 text-xs leading-5 text-muted">
                  你仍可查看已有内容；继续回答、提示、跳过和生成点评会在配置模型后恢复。
                </p>
              </div>
            </div>
            <UButton
              type="button"
              color="warning"
              variant="outline"
              icon="i-lucide-settings"
              @click="router.push({ name: 'settings' })"
              >前往设置</UButton
            >
          </div>
        </section>

        <section class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main class="app-panel relative flex min-w-0 flex-col overflow-hidden lg:h-[calc(100vh-10.75rem)]">
            <div class="border-b border-default px-5 py-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="text-base font-semibold text-highlighted">问答记录</h2>
                <span class="text-xs text-muted"
                  >已消耗
                  {{
                    session.answers.length +
                    session.skips.filter((item) => item.reason !== 'unclear' && item.reason !== 'irrelevant').length
                  }}
                  / {{ session.budget.totalQuestionBudget }} 个问题额度</span
                >
              </div>
            </div>

            <div class="relative min-h-0 flex-1">
              <div
                ref="transcriptRef"
                class="interview-transcript h-full overflow-y-auto px-5 py-5"
                aria-live="polite"
                @scroll.passive="handleTranscriptScroll"
              >
                <div class="interview-transcript-content">
                  <template v-for="question in session.questions" :key="question.id">
                    <article :id="`interview-question-${question.id}`" class="interview-message interview-message-ai">
                      <div class="interview-message-avatar"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                      <div class="interview-message-body">
                        <div class="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                          <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <span class="text-xs font-medium text-highlighted">PERCH Interviewer</span>
                            <UBadge size="sm" color="neutral" variant="subtle" :label="`第 ${question.sequence} 题`" />
                            <UBadge
                              v-if="question.relation === 'follow_up'"
                              size="sm"
                              color="primary"
                              variant="subtle"
                              label="追问"
                            />
                          </div>
                          <time class="shrink-0 text-[11px] font-normal text-muted" :datetime="question.createdAt">{{
                            formatTime(question.createdAt)
                          }}</time>
                        </div>
                        <div class="interview-message-bubble">
                          <p class="whitespace-pre-line text-sm leading-7 text-highlighted">{{ question.content }}</p>
                          <ol
                            v-if="question.subQuestions.length"
                            class="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted"
                          >
                            <li v-for="item in question.subQuestions" :key="item">{{ item }}</li>
                          </ol>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-1">
                          <UPopover
                            :open="feedbackQuestionId === question.id"
                            :portal="true"
                            :ui="{ content: 'z-[100]' }"
                            @update:open="updateFeedbackPopover(question.id, 'like', $event)"
                          >
                            <button
                              type="button"
                              class="interview-message-action"
                              :class="{ 'is-active': question.feedback?.value === 'like' }"
                              :disabled="question.feedback?.locked === true"
                              :aria-label="question.feedback?.locked ? '已提交问题反馈' : '认为这个问题有价值'"
                              :title="question.feedback?.locked ? '已提交详细反馈，不支持修改' : '认可这个问题'"
                              @click="openFeedback(question, 'like')"
                            >
                              <UIcon name="i-lucide-thumbs-up" class="size-4" />
                            </button>
                            <template #content>
                              <div class="w-72 p-3">
                                <p class="text-sm font-medium text-highlighted">你觉得这个问题哪里好？</p>
                                <div class="mt-3 flex flex-wrap gap-1.5">
                                  <button
                                    v-for="reason in getFeedbackReasons('like')"
                                    :key="reason"
                                    type="button"
                                    class="interview-feedback-reason"
                                    :class="{ 'is-selected': feedbackReason === reason }"
                                    @click="feedbackReason = feedbackReason === reason ? '' : reason"
                                  >
                                    {{ reason }}
                                  </button>
                                </div>
                                <UInput
                                  v-model="feedbackReason"
                                  class="mt-3 w-full"
                                  placeholder="也可以补充你的感受（可选）"
                                />
                                <div class="mt-3 flex justify-end gap-2">
                                  <UButton
                                    type="button"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    @click="feedbackQuestionId = null"
                                    >取消</UButton
                                  >
                                  <UButton
                                    type="button"
                                    size="sm"
                                    :loading="isSavingFeedback"
                                    :disabled="isSavingFeedback"
                                    @click="saveFeedback(question)"
                                    >提交反馈</UButton
                                  >
                                </div>
                              </div>
                            </template>
                          </UPopover>

                          <UPopover
                            :open="feedbackQuestionId === getFeedbackPopoverId(question.id, 'dislike')"
                            :portal="true"
                            :ui="{ content: 'z-[100]' }"
                            @update:open="updateFeedbackPopover(question.id, 'dislike', $event)"
                          >
                            <button
                              type="button"
                              class="interview-message-action"
                              :class="{ 'is-active is-negative': question.feedback?.value === 'dislike' }"
                              :disabled="question.feedback?.locked === true"
                              :aria-label="question.feedback?.locked ? '已提交问题反馈' : '认为这个问题需要改进'"
                              :title="question.feedback?.locked ? '已提交详细反馈，不支持修改' : '这个问题需要改进'"
                              @click="openFeedback(question, 'dislike')"
                            >
                              <UIcon name="i-lucide-thumbs-down" class="size-4" />
                            </button>
                            <template #content>
                              <div class="w-72 p-3">
                                <p class="text-sm font-medium text-highlighted">这个问题哪里不合适？</p>
                                <div class="mt-3 flex flex-wrap gap-1.5">
                                  <button
                                    v-for="reason in getFeedbackReasons('dislike')"
                                    :key="reason"
                                    type="button"
                                    class="interview-feedback-reason"
                                    :class="{ 'is-selected': feedbackReason === reason }"
                                    @click="feedbackReason = feedbackReason === reason ? '' : reason"
                                  >
                                    {{ reason }}
                                  </button>
                                </div>
                                <UInput
                                  v-model="feedbackReason"
                                  class="mt-3 w-full"
                                  placeholder="也可以补充你的感受（可选）"
                                />
                                <div class="mt-3 flex justify-end gap-2">
                                  <div class="flex gap-2">
                                    <UButton
                                      type="button"
                                      color="neutral"
                                      variant="ghost"
                                      size="sm"
                                      @click="feedbackQuestionId = null"
                                      >取消</UButton
                                    ><UButton
                                      type="button"
                                      color="error"
                                      size="sm"
                                      :loading="isSavingFeedback"
                                      :disabled="isSavingFeedback"
                                      @click="saveFeedback(question)"
                                      >提交反馈</UButton
                                    >
                                  </div>
                                </div>
                              </div>
                            </template>
                          </UPopover>
                          <span v-if="question.feedback?.locked" class="ml-1 text-[11px] text-muted"
                            >已提交详细反馈，不支持修改</span
                          >
                        </div>
                      </div>
                    </article>

                    <template v-for="interaction in getQuestionInteractions(question.id)" :key="interaction.id">
                      <article v-if="interaction.role === 'candidate'" class="interview-message interview-message-user">
                        <div class="interview-message-body">
                          <div class="mb-2 flex items-center justify-end gap-2 text-xs text-muted">
                            <time :datetime="interaction.submittedAt ?? interaction.createdAt">{{
                              formatTime(interaction.submittedAt ?? interaction.createdAt)
                            }}</time>
                            <span class="font-medium">{{ getInteractionLabel(interaction) }}</span>
                          </div>
                          <div class="interview-message-bubble">
                            <p class="whitespace-pre-line text-sm leading-7 text-highlighted">
                              {{ interaction.content }}
                            </p>
                          </div>
                        </div>
                        <div class="interview-message-avatar"><UIcon name="i-lucide-user-round" class="size-4" /></div>
                      </article>

                      <article v-else class="interview-message interview-message-ai">
                        <div class="interview-message-avatar">
                          <UIcon name="i-lucide-message-circle-question" class="size-4" />
                        </div>
                        <div class="interview-message-body">
                          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span class="font-medium">{{ getInteractionLabel(interaction) }}</span>
                            <time class="shrink-0 font-normal" :datetime="interaction.createdAt">{{
                              formatTime(interaction.createdAt)
                            }}</time>
                          </div>
                          <div class="interview-message-bubble">
                            <p class="whitespace-pre-line text-sm leading-7 text-highlighted">
                              {{ interaction.content }}
                            </p>
                          </div>
                        </div>
                      </article>
                    </template>

                    <article
                      v-if="getQuestionAnswer(question.id)"
                      :id="`interview-answer-${question.id}`"
                      class="interview-message interview-message-user"
                      :class="{ 'is-review-reference': highlightedTurnId === question.id }"
                    >
                      <div class="interview-message-body">
                        <div class="mb-2 flex items-center justify-end gap-2">
                          <span
                            v-if="getQuestionAnswer(question.id)?.assistanceLevel !== 'none'"
                            class="text-[11px] text-warning"
                            >{{ getAssistanceLabel(getQuestionAnswer(question.id)?.assistanceLevel ?? 'none') }}</span
                          ><time
                            class="text-[11px] font-normal text-muted"
                            :datetime="getQuestionAnswer(question.id)?.submittedAt"
                            >{{ formatTime(getQuestionAnswer(question.id)?.submittedAt ?? null) }}</time
                          ><span class="text-xs font-medium text-highlighted">你的回答</span>
                        </div>
                        <div class="interview-message-bubble">
                          <p class="whitespace-pre-line text-sm leading-7 text-highlighted">
                            {{ getQuestionAnswer(question.id)?.content }}
                          </p>
                        </div>
                        <div class="mt-2 flex justify-end gap-2">
                          <button
                            v-if="
                              getQuestionPendingAnswer(question.id) &&
                              getQuestionPendingAnswer(question.id)?.status !== 'cancelling'
                            "
                            type="button"
                            class="interview-message-action interview-answer-review-action"
                            @click="handleCancelSubmit"
                          >
                            <UIcon name="i-lucide-pencil" class="size-3.5" /> 编辑
                          </button>
                          <button
                            v-if="!getQuestionPendingAnswer(question.id) && getQuestionAnswer(question.id)?.evaluation"
                            type="button"
                            class="interview-message-action interview-answer-review-action"
                            :class="{
                              'is-completed': getQuestionAnswer(question.id)?.deepReviewStatus === 'completed',
                            }"
                            @click="openAnswerReview(getQuestionAnswer(question.id) as InterviewAnswer, question)"
                          >
                            <UIcon
                              :name="
                                getQuestionAnswer(question.id)?.deepReviewStatus === 'processing'
                                  ? 'i-lucide-loader-circle'
                                  : 'i-lucide-scan-search'
                              "
                              class="size-3.5"
                              :class="{
                                'animate-spin': getQuestionAnswer(question.id)?.deepReviewStatus === 'processing',
                              }"
                            />
                            深度点评
                          </button>
                        </div>
                      </div>
                      <div class="interview-message-avatar"><UIcon name="i-lucide-user-round" class="size-4" /></div>
                    </article>

                    <div
                      v-if="getQuestionSkip(question.id)"
                      class="mx-auto max-w-md rounded-xl border border-dashed border-default px-3 py-2 text-center text-xs text-muted"
                    >
                      已跳过本题 · {{ getSkipLabel(getQuestionSkip(question.id)?.reason ?? 'unspecified') }}
                    </div>
                  </template>

                  <article v-if="session.streamingText" class="interview-message interview-message-ai">
                    <div class="interview-message-avatar"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                    <div class="interview-message-body">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span class="font-medium">{{
                          session.streamingKind === 'interaction'
                            ? 'PERCH Interviewer 正在澄清问题'
                            : 'PERCH Interviewer 正在组织问题'
                        }}</span>
                        <time
                          v-if="session.streamingCreatedAt"
                          class="shrink-0 font-normal"
                          :datetime="session.streamingCreatedAt"
                          >{{ formatTime(session.streamingCreatedAt) }}</time
                        >
                      </div>
                      <div class="interview-message-bubble">
                        <p class="whitespace-pre-line text-sm leading-7 text-highlighted">
                          {{ session.streamingText }}<span class="interview-stream-cursor" />
                        </p>
                      </div>
                    </div>
                  </article>

                  <article
                    v-if="shouldShowQuestionGenerationPlaceholder"
                    class="interview-message interview-message-ai"
                  >
                    <div class="interview-message-avatar"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                    <div class="interview-message-body">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span class="font-medium">PERCH Interviewer</span>
                        <time class="shrink-0 font-normal" :datetime="session.lastActivityAt">{{
                          formatTime(session.lastActivityAt)
                        }}</time>
                      </div>
                      <div class="interview-message-bubble">
                        <div class="flex items-center gap-2 text-sm leading-7 text-muted">
                          <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary" />
                          <span>正在生成新问题…</span>
                        </div>
                      </div>
                    </div>
                  </article>

                  <article v-if="shouldShowAnswerProcessingPlaceholder" class="interview-message interview-message-ai">
                    <div class="interview-message-avatar"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                    <div class="interview-message-body">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span class="font-medium">PERCH Interviewer</span>
                        <time
                          class="shrink-0 font-normal"
                          :datetime="pendingAnswer?.submittedAt ?? session.lastActivityAt"
                          >{{ formatTime(pendingAnswer?.submittedAt ?? session.lastActivityAt) }}</time
                        >
                      </div>
                      <div class="flex items-center gap-2">
                        <div class="interview-message-bubble">
                          <div class="flex items-center gap-2 text-sm leading-7 text-muted">
                            <UIcon
                              :name="isAnswerProcessingFailed ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'"
                              class="size-4 shrink-0"
                              :class="isAnswerProcessingFailed ? 'text-warning' : 'animate-spin text-primary'"
                            />
                            <span>
                              {{
                                isAnswerProcessingFailed
                                  ? session.taskError
                                    ? taskFailurePresentation.description
                                    : '回答评估失败，可重试当前任务，不会消耗额外额度。'
                                  : '正在分析你的回答…'
                              }}
                            </span>
                          </div>
                        </div>
                        <button
                          v-if="isAnswerProcessingFailed"
                          type="button"
                          class="interview-message-action interview-retry-action shrink-0"
                          aria-label="重试回答评估"
                          :title="retryDisabledReason"
                          :disabled="!canRetryCurrentTask"
                          @click="retryTask"
                        >
                          <UIcon
                            :name="
                              interviewStore.isGenerating(session.id) ? 'i-lucide-loader-circle' : 'i-lucide-rotate-cw'
                            "
                            class="size-4"
                            :class="{ 'animate-spin': interviewStore.isGenerating(session.id) }"
                          />
                        </button>
                      </div>
                    </div>
                  </article>

                  <article v-if="completionNotice" class="interview-message interview-message-ai">
                    <div class="interview-message-avatar"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                    <div class="interview-message-body">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span class="font-medium">PERCH Interviewer</span>
                        <time class="shrink-0 font-normal" :datetime="completionNotice.createdAt">{{
                          formatTime(completionNotice.createdAt)
                        }}</time>
                      </div>
                      <div class="interview-message-bubble">
                        <p class="text-sm leading-7 text-highlighted">{{ completionNotice.content }}</p>
                      </div>
                    </div>
                  </article>

                  <div v-if="isPlanPreparationLoading" class="interview-phase-card">
                    <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
                    <div>
                      <p class="text-sm font-medium text-highlighted">{{ planLoadingCopy.title }}</p>
                      <p class="mt-1 text-xs leading-5 text-muted">{{ planLoadingCopy.detail }}</p>
                    </div>
                  </div>
                  <div v-if="error" class="interview-error-card">
                    <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-error" />
                    <div>
                      <p class="text-sm font-medium text-highlighted">当前操作没有完成</p>
                      <p class="mt-1 text-xs leading-5 text-muted">{{ error }}</p>
                    </div>
                  </div>
                  <div v-if="session.taskError && session.phase === 'preparation_failed'" class="interview-error-card">
                    <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-warning" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-highlighted">{{ taskFailurePresentation.title }}</p>
                      <p class="mt-1 text-xs leading-5 text-muted">{{ taskFailurePresentation.description }}</p>
                    </div>
                    <UButton
                      v-if="taskFailurePresentation.requiresModelAttention"
                      type="button"
                      size="sm"
                      color="warning"
                      variant="outline"
                      icon="i-lucide-settings"
                      @click="router.push({ name: 'settings' })"
                    >
                      检查模型
                    </UButton>
                  </div>
                  <div v-if="session && isSessionModelMismatchActionable" class="interview-error-card">
                    <UIcon name="i-lucide-git-compare-arrows" class="mt-0.5 size-4 shrink-0 text-warning" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-highlighted">本轮面试绑定的是 {{ session.model.modelName }}</p>
                      <p class="mt-1 text-xs leading-5 text-muted">
                        当前设置已切换为
                        {{ settingsStore.llm.modelName || '未配置模型' }}。确认后只影响后续问题，历史记录和 AgentRun
                        仍保留各自实际使用的模型。
                      </p>
                    </div>
                    <UButton
                      type="button"
                      size="sm"
                      :loading="interviewStore.isGenerating(session.id)"
                      :disabled="!isModelReady || !canSwitchSessionModel || interviewStore.isGenerating(session.id)"
                      @click="switchToCurrentModel"
                    >
                      使用当前模型继续
                    </UButton>
                  </div>
                </div>
              </div>

              <button
                v-if="!isTranscriptPinnedToBottom"
                type="button"
                class="interview-return-latest"
                aria-label="回到最新消息"
                title="回到最新消息"
                @click="returnToLatestMessage"
              >
                <UIcon name="i-lucide-arrow-down" class="size-4" />
              </button>
            </div>

            <div
              v-if="session.phase === 'question_generation_failed' || session.phase === 'review_generation_failed'"
              class="border-t border-default px-5 py-4"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-muted">{{ getPhaseLabel() }}，可以重试当前任务，不会额外消耗题目额度。</p>
                <UButton
                  type="button"
                  icon="i-lucide-rotate-cw"
                  :loading="interviewStore.isGenerating(session.id)"
                  :disabled="!canRetryCurrentTask"
                  :title="retryDisabledReason"
                  @click="retryTask"
                  >重试</UButton
                >
              </div>
            </div>

            <div
              v-if="activeSession"
              class="border-t border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_66%,transparent)] px-5 py-4"
            >
              <InterviewComposer
                v-model="draft"
                :question="currentQuestion"
                :disabled="!canOperateQuestion"
                :submitting="isSubmissionPhase || isAiOutputting"
                :cancellable="canCancelPendingAnswer"
                :cancelling="isCancellingPendingAnswer"
                :cancellation-pending="isCancellingPendingAnswer"
                :skipping="isSkippingQuestion"
                @submit="handleSubmit"
                @cancel-submit="handleCancelSubmit"
                @request-hint="requestHint"
                @skip="handleSkip"
              />
            </div>
          </main>

          <aside class="hidden xl:block xl:sticky xl:top-20">
            <InterviewOverallPanel
              :score="session.overallScore"
              :session="session"
              @open-reference="openReviewReference"
            />
          </aside>
        </section>
      </template>
    </div>

    <AnswerReviewDrawer
      :open="isReviewDrawerOpen"
      :answer="selectedAnswer"
      :question="selectedQuestion"
      :loading="isSelectedAnswerReviewing"
      @close="isReviewDrawerOpen = false"
      @generate="generateAnswerReview"
    />

    <Teleport to="body">
      <div
        v-if="isHintConfirmOpen"
        class="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 px-4"
        role="dialog"
        aria-modal="true"
      >
        <section class="app-panel w-full max-w-sm p-5 shadow-2xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <UIcon name="i-lucide-lightbulb" class="size-4" />
            </div>
            <div>
              <h2 class="text-base font-semibold text-highlighted">确认使用提示？</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                使用提示会将本题标记为辅助回答，并降低它进入能力评估时的证据权重。
              </p>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="cancelHintConfirmation">取消</UButton
            ><UButton type="button" color="warning" @click="confirmHint">继续使用</UButton>
          </div>
        </section>
      </div>
      <div
        v-if="isEndConfirmOpen"
        class="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 px-4"
        role="dialog"
        aria-modal="true"
      >
        <section class="app-panel w-full max-w-sm p-5 shadow-2xl">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
              <UIcon name="i-lucide-octagon-x" class="size-4" />
            </div>
            <div>
              <h2 class="text-base font-semibold text-highlighted">结束本轮模拟面试？</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                系统会保留已接受的回答，并基于现有证据生成部分复盘；未生成的问题不会继续使用。
              </p>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="isEndConfirmOpen = false">继续面试</UButton
            ><UButton type="button" color="error" @click="confirmEndSession">确认结束</UButton>
          </div>
        </section>
      </div>
      <div
        v-if="isMobileScoreOpen && session"
        class="fixed inset-0 z-[100] flex justify-end bg-black/35 xl:hidden"
        @click.self="isMobileScoreOpen = false"
      >
        <section class="app-drawer h-full w-full max-w-sm overflow-y-auto border-l border-default p-4 shadow-2xl">
          <div class="mb-4 flex justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="关闭总体表现"
              @click="isMobileScoreOpen = false"
            />
          </div>
          <InterviewOverallPanel
            :score="session.overallScore"
            :session="session"
            @open-reference="openReviewReference"
          />
        </section>
      </div>
    </Teleport>
  </section>
</template>
