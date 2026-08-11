<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { useChatConversation } from '@/composables/useChatConversation'
import { useChatStore } from '@/stores/chat'
import { useOpportunityStore, useSettingsStore } from '@/stores'
import { toUserVisibleChatText } from '@/shared/chat/user-visible-text'
import type { ChatConversationRecord } from '@/services/chat-api'
import {
  chatOpportunityIntentionChangePresentationSchema,
  chatOpportunityProfileBatchChangePresentationSchema,
  chatOpportunityProfileChangePresentationSchema,
  chatOpportunityStatusTransitionPresentationSchema,
  chatInterviewScheduleInputPresentationSchema,
  chatInterviewScheduleCreatePresentationSchema,
  chatMockInterviewInputPresentationSchema,
  chatMockInterviewCreatePresentationSchema,
  chatReviewInputPresentationSchema,
  chatReviewSavePresentationSchema,
  chatOpportunityTargetInputPresentationSchema,
  chatResumeTargetInputPresentationSchema,
  type ChatOpportunityIntentionChangePresentation,
  type ChatOpportunityProfileBatchChangePresentation,
  type ChatInterviewScheduleCreatePresentation,
  type ChatInterviewScheduleInputPresentation,
  type ChatMockInterviewInputPresentation,
  type ChatMockInterviewCreatePresentation,
  type ChatOpportunityProfileChangePresentation,
  type ChatOpportunityImportResultPart,
  type ChatOpportunitySearchResultPart,
  type ChatOpportunityStatusTransitionPresentation,
  type ChatReviewInputPresentation,
  type ChatReviewSavePresentation,
  type ChatOpportunityTargetInputPresentation,
  type ChatResumeTargetInputPresentation,
  type ChatMessageReference,
} from '@/shared/chat/schemas'
import ChatMarkdownContent from './ChatMarkdownContent.vue'
import OpportunitySearchResultCard from './OpportunitySearchResultCard.vue'
import OpportunitySearchResultSkeleton from './OpportunitySearchResultSkeleton.vue'
import OpportunityImportResultCard from './OpportunityImportResultCard.vue'
import OpportunityIntentionConfirmationCard, {
  type OpportunityIntentionConfirmationStatus,
} from './OpportunityIntentionConfirmationCard.vue'
import OpportunityProfileConfirmationCard from './OpportunityProfileConfirmationCard.vue'
import OpportunityProfileBatchConfirmationCard from './OpportunityProfileBatchConfirmationCard.vue'
import OpportunityStatusTransitionConfirmationCard from './OpportunityStatusTransitionConfirmationCard.vue'
import InterviewScheduleInputCard from './InterviewScheduleInputCard.vue'
import InterviewScheduleConfirmationCard from './InterviewScheduleConfirmationCard.vue'
import MockInterviewInputCard from './MockInterviewInputCard.vue'
import MockInterviewConfirmationCard from './MockInterviewConfirmationCard.vue'
import ReviewInputCard from './ReviewInputCard.vue'
import ReviewConfirmationCard from './ReviewConfirmationCard.vue'
import OpportunityTargetInputCard from './OpportunityTargetInputCard.vue'
import ResumeTargetInputCard from './ResumeTargetInputCard.vue'
import OpportunityReferencePicker from './OpportunityReferencePicker.vue'
import ChatConversationHistoryPanel, {
  type ChatConversationMutation,
  type ChatHistoryScopeFilter,
} from './ChatConversationHistoryPanel.vue'

type OpportunityIntentionActionPart = {
  type: 'opportunity_intention_action'
  toolActionId: string
  presentation: ChatOpportunityIntentionChangePresentation
  status: OpportunityIntentionConfirmationStatus
}

type OpportunityProfileActionPart = {
  type: 'opportunity_profile_action'
  toolActionId: string
  presentation: ChatOpportunityProfileChangePresentation
  status: OpportunityIntentionConfirmationStatus
}

type OpportunityProfileBatchActionPart = {
  type: 'opportunity_profile_batch_action'
  toolActionId: string
  presentation: ChatOpportunityProfileBatchChangePresentation
  status: OpportunityIntentionConfirmationStatus
}

type OpportunityStatusTransitionActionPart = {
  type: 'opportunity_status_transition_action'
  toolActionId: string
  presentation: ChatOpportunityStatusTransitionPresentation
  status: OpportunityIntentionConfirmationStatus
}

type OpportunityConfirmationActionPart =
  | OpportunityIntentionActionPart
  | OpportunityProfileActionPart
  | OpportunityProfileBatchActionPart
  | OpportunityStatusTransitionActionPart
  | InterviewScheduleConfirmationActionPart
  | MockInterviewConfirmationActionPart
  | ReviewConfirmationActionPart

type InterviewScheduleInputActionPart = {
  type: 'interview_schedule_input_action'
  requestId: string
  presentation: ChatInterviewScheduleInputPresentation
  status: 'waiting' | 'submitted'
}

type ReviewInputActionPart = {
  type: 'review_input_action'
  requestId: string
  presentation: ChatReviewInputPresentation
  status: 'waiting' | 'submitted'
}

type MockInterviewInputActionPart = {
  type: 'mock_interview_input_action'
  requestId: string
  presentation: ChatMockInterviewInputPresentation
  status: 'waiting' | 'submitted'
}

type OpportunityTargetInputActionPart = {
  type: 'opportunity_target_input_action'
  requestId: string
  presentation: ChatOpportunityTargetInputPresentation
  status: 'waiting' | 'submitted'
}

type ResumeTargetInputActionPart = {
  type: 'resume_target_input_action'
  requestId: string
  presentation: ChatResumeTargetInputPresentation
  status: 'waiting' | 'submitted'
}

type InterviewScheduleConfirmationActionPart = {
  type: 'interview_schedule_confirmation_action'
  toolActionId: string
  presentation: ChatInterviewScheduleCreatePresentation
  status: OpportunityIntentionConfirmationStatus
}

type ReviewConfirmationActionPart = {
  type: 'review_confirmation_action'
  toolActionId: string
  presentation: ChatReviewSavePresentation
  status: OpportunityIntentionConfirmationStatus
}

type MockInterviewConfirmationActionPart = {
  type: 'mock_interview_confirmation_action'
  toolActionId: string
  presentation: ChatMockInterviewCreatePresentation
  status: OpportunityIntentionConfirmationStatus
  sessionId: string | null
}

type ChatUiMessagePart =
  | { type: 'text'; text: string }
  | ChatOpportunitySearchResultPart
  | ChatOpportunityImportResultPart
  | { type: 'opportunity_search_placeholder' }
  | InterviewScheduleInputActionPart
  | MockInterviewInputActionPart
  | ReviewInputActionPart
  | OpportunityTargetInputActionPart
  | ResumeTargetInputActionPart
  | OpportunityConfirmationActionPart

type ChatUiMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: ChatUiMessagePart[]
  references: ChatMessageReference[]
  metadata: {
    createdAt: string
    streaming?: boolean
    pending?: boolean
    cancelled?: boolean
    failed?: boolean
  }
}

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const opportunityStore = useOpportunityStore()
const toast = useToast()
const { opportunities } = storeToRefs(opportunityStore)
const chat = useChatConversation()

const draft = ref('')
const draftReferences = ref<ChatMessageReference[]>([])
const optimisticReferences = ref<ChatMessageReference[]>([])
const referencePicker = ref<{ show: () => void } | null>(null)
const historyOpen = ref(false)
const showArchived = ref(false)
const historySearch = ref('')
const debouncedHistorySearch = ref('')
const historyScopeFilter = ref<ChatHistoryScopeFilter>('all')
const isBootstrapping = ref(false)
const isPreparingConversation = ref(false)
const draftOpportunityId = ref<string | null>(null)
const optimisticText = ref<string | null>(null)
const optimisticSentAt = ref<string | null>(null)
const toolSkeletonReady = ref(false)
const editingConversationId = ref<string | null>(null)
const editingConversationTitle = ref('')
const conversationMutation = ref<{ conversationId: string; type: ChatConversationMutation } | null>(null)
const deletePopoverConversationId = ref<string | null>(null)
const copiedMessageId = ref<string | null>(null)
const chatScrollContainer = ref<HTMLElement | null>(null)
const showBackToLatest = ref(false)
const minPanelWidth = 360
const maxPanelWidth = 720
const collapsePanelThreshold = minPanelWidth - 40
const reopenPanelThreshold = minPanelWidth - 12
let resizeStartX = 0
let resizeStartWidth = 0
let resizeStartOpen = false
let resizeDistance = 0
let suppressResizeHandleClick = false
const isResizing = ref(false)
let skipNextConversationOpen = false
let historySearchDebounceTimer: number | null = null
let copiedMessageTimer: number | null = null
let scrollToLatestTimer: number | null = null
let toolSkeletonTimer: number | null = null
let presentedToolCallId: string | null = null
let isScrollingToLatest = false
const refreshedMutationToolCallIds = new Set<string>()

const currentOpportunityId = computed(() => {
  const id = route.params.id
  return typeof id === 'string' && id.length > 0 ? id : null
})
const currentOpportunity = computed(() => {
  if (!currentOpportunityId.value) return null
  return opportunities.value.find((item) => item.id === currentOpportunityId.value) ?? null
})
const selectedConversation = computed(() => chatStore.selectedConversation)
const isConversationArchived = computed(() => Boolean(selectedConversation.value?.archivedAt))
const draftOpportunity = computed(() => {
  if (!draftOpportunityId.value) return null
  return opportunities.value.find((item) => item.id === draftOpportunityId.value) ?? null
})
const shouldShowDraftOpportunityBinding = computed(
  () => !selectedConversation.value && Boolean(currentOpportunity.value || draftOpportunity.value),
)
const referenceExcludedOpportunityId = computed(() => {
  if (selectedConversation.value?.scopeType === 'opportunity') return selectedConversation.value.opportunityId
  return draftOpportunityId.value
})
const isConversationMutationPending = computed(() => conversationMutation.value !== null)
const isModelConfigured = computed(() => {
  const connection = settingsStore.llm
  return Boolean(connection.baseUrl.trim() && connection.modelName.trim() && connection.apiKey.trim())
})
const isStreamActive = computed(() => chat.stream.isActive.value)
const isAwaitingToolConfirmation = computed(() => chat.stream.toolConfirmations.value.at(-1)?.status === 'waiting')
const isAwaitingToolInput = computed(() => chat.stream.toolInputRequests.value.at(-1)?.status === 'waiting')
const isSubmittingToolInput = computed(() => {
  const request = chat.stream.toolInputRequests.value.at(-1)
  if (request?.status !== 'submitted') return false

  const confirmationCreated = chat.stream.toolConfirmations.value.some(
    (confirmation) => confirmation.callId === request.callId,
  )
  if (confirmationCreated) return false

  const status = chat.stream.snapshot.value?.status
  return status !== 'completed' && status !== 'failed' && status !== 'cancelled'
})
const isBusy = computed(
  () =>
    isPreparingConversation.value ||
    chat.isSending.value ||
    isStreamActive.value ||
    isAwaitingToolInput.value ||
    isSubmittingToolInput.value ||
    isAwaitingToolConfirmation.value ||
    chat.isCancelling.value ||
    chat.isFinalizing.value,
)
const isLoadingConversation = computed(() => chat.isLoading.value)
const isSending = computed(() => chat.isSending.value)
const isCancelling = computed(() => chat.isCancelling.value)
const streamingAssistantText = computed(() => chat.streamingAssistantText.value)
const conversationError = computed(() => chat.error.value ?? chat.stream.error.value)
const latestToolActivity = computed(() => chat.stream.toolActivities.value.at(-1) ?? null)
const latestToolConfirmation = computed(() => chat.stream.toolConfirmations.value.at(-1) ?? null)
const latestToolInputRequest = computed(() => chat.stream.toolInputRequests.value.at(-1) ?? null)
const latestToolPresentation = computed(() => {
  const activity = latestToolActivity.value
  if (!activity) return null

  const completionEvent = [...chat.stream.events.value]
    .reverse()
    .find(
      (event) =>
        event.eventType === 'tool_call_completed' &&
        event.payload.callId === activity.callId &&
        event.payload.name === activity.name,
    )
  if (!completionEvent) {
    return { activity, hasPostToolDelta: false, hasRenderedPostToolText: false }
  }

  let preToolTextLength = 0
  let hasPostToolDelta = false
  for (const event of chat.stream.events.value) {
    if (event.eventType !== 'message_delta' || typeof event.payload.text !== 'string') continue
    if (event.sequence < completionEvent.sequence) preToolTextLength += event.payload.text.length
    if (event.sequence > completionEvent.sequence) hasPostToolDelta = true
  }

  return {
    activity,
    hasPostToolDelta,
    hasRenderedPostToolText: streamingAssistantText.value.length > preToolTextLength,
  }
})
const activeToolNotice = computed(() => {
  const activity = latestToolActivity.value
  if (!activity) return null

  const confirmation = latestToolConfirmation.value
  if (
    confirmation?.callId === activity.callId &&
    (confirmation.status === 'waiting' || confirmation.status === 'rejected')
  ) {
    return null
  }
  if (latestToolInputRequest.value?.callId === activity.callId && latestToolInputRequest.value.status === 'waiting') {
    return null
  }

  const toolLabel =
    activity.name === 'search_opportunities'
      ? '查找机会'
      : activity.name === 'get_opportunity_context'
        ? '读取机会信息'
        : activity.name === 'get_capability_profile'
          ? '读取能力画像'
          : activity.name === 'get_action_strategy'
            ? '读取行动策略'
            : activity.name === 'import_opportunities_from_urls'
              ? '识别岗位网页'
              : activity.name === 'import_opportunity_from_text'
                ? '识别岗位文本'
                : activity.name === 'update_opportunity_intention_level' ||
                    activity.name === 'update_opportunity_profile'
                  ? '修改机会资料'
                  : activity.name === 'batch_update_opportunity_profiles'
                    ? '批量修改机会资料'
                    : activity.name === 'transition_opportunity_status'
                      ? '修改机会阶段'
                      : activity.name === 'create_interview_schedule'
                        ? '创建面试安排'
                        : activity.name === 'create_mock_interview'
                          ? '创建模拟面试'
                          : activity.name === 'save_written_test_review'
                            ? '保存笔试复盘'
                            : activity.name === 'save_interview_review'
                              ? '保存面试复盘'
                              : '处理请求'
  if (activity.status === 'requested' || activity.status === 'running') {
    return {
      label: `正在调用工具 · ${toolLabel}`,
      icon: 'i-lucide-loader-circle',
      status: 'running' as const,
    }
  }

  if (activity.status === 'failed') {
    return {
      label: `${toolLabel}失败`,
      icon: 'i-lucide-circle-alert',
      status: 'failed' as const,
    }
  }

  const hasPostToolText = latestToolPresentation.value?.hasPostToolDelta ?? false
  if (activity.status === 'completed' && !hasPostToolText) {
    return {
      label: `${toolLabel}完成，正在整理结果`,
      icon: 'i-lucide-circle-check',
      status: 'completed' as const,
    }
  }

  return null
})
const streamStatusLabel = computed(() => {
  if (isPreparingConversation.value || chat.isSending.value) return '正在准备回答'

  if (latestToolActivity.value?.name === 'search_opportunities') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在查找机会'
    }
    if (latestToolActivity.value.status === 'failed') return '机会查询失败'
  }

  if (latestToolActivity.value?.name === 'get_opportunity_context') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在读取机会信息'
    }
    if (latestToolActivity.value.status === 'failed') return '机会信息读取失败'
  }

  if (latestToolActivity.value?.name === 'get_capability_profile') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在读取能力画像'
    }
    if (latestToolActivity.value.status === 'failed') return '能力画像读取失败'
  }

  if (latestToolActivity.value?.name === 'get_action_strategy') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在读取行动策略'
    }
    if (latestToolActivity.value.status === 'failed') return '行动策略读取失败'
  }

  if (latestToolActivity.value?.name === 'import_opportunities_from_urls') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在识别岗位网页'
    }
    if (latestToolActivity.value.status === 'failed') return '岗位网页识别失败'
  }

  if (latestToolActivity.value?.name === 'import_opportunity_from_text') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在识别岗位文本'
    }
    if (latestToolActivity.value.status === 'failed') return '岗位文本识别失败'
  }

  if (latestToolConfirmation.value?.status === 'waiting') return '等待你确认操作'
  if (latestToolInputRequest.value?.status === 'waiting') {
    if (chatResumeTargetInputPresentationSchema.safeParse(latestToolInputRequest.value.presentation).success) {
      return '等待你选择简历'
    }
    if (chatOpportunityTargetInputPresentationSchema.safeParse(latestToolInputRequest.value.presentation).success) {
      return '等待你选择目标机会'
    }
    if (latestToolInputRequest.value.toolName === 'create_mock_interview') return '等待你配置模拟面试'
    if (latestToolInputRequest.value.toolName === 'save_written_test_review') return '等待你补充笔试复盘'
    if (latestToolInputRequest.value.toolName === 'save_interview_review') return '等待你补充面试复盘'
    return '等待你补全面试安排'
  }
  if (isSubmittingToolInput.value) return '正在生成确认信息'
  if (latestToolConfirmation.value?.status === 'rejected') {
    return chat.stream.isRenderingText.value ? 'AI 正在回答' : '正在整理取消结果'
  }
  if (latestToolActivity.value?.name === 'batch_update_opportunity_profiles') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在批量修改机会资料'
    }
    if (latestToolActivity.value.status === 'failed') return '批量修改机会资料失败'
  }
  if (
    latestToolActivity.value?.name === 'update_opportunity_intention_level' ||
    latestToolActivity.value?.name === 'update_opportunity_profile'
  ) {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在修改机会资料'
    }
    if (latestToolActivity.value.status === 'failed') return '机会资料修改失败'
  }
  if (latestToolActivity.value?.name === 'transition_opportunity_status') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在修改机会阶段'
    }
    if (latestToolActivity.value.status === 'failed') return '机会阶段修改失败'
  }
  if (latestToolActivity.value?.name === 'create_interview_schedule') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在创建面试安排'
    }
    if (latestToolActivity.value.status === 'failed') return '面试安排创建失败'
  }
  if (latestToolActivity.value?.name === 'create_mock_interview') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在创建模拟面试'
    }
    if (latestToolActivity.value.status === 'failed') return '模拟面试创建失败'
  }
  if (latestToolActivity.value?.name === 'save_written_test_review') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在保存笔试复盘'
    }
    if (latestToolActivity.value.status === 'failed') return '笔试复盘保存失败'
  }
  if (latestToolActivity.value?.name === 'save_interview_review') {
    if (latestToolActivity.value.status === 'requested' || latestToolActivity.value.status === 'running') {
      return '正在保存面试复盘'
    }
    if (latestToolActivity.value.status === 'failed') return '面试复盘保存失败'
  }

  if (chat.stream.isRenderingText.value) return 'AI 正在回答'
  if (latestToolActivity.value?.name === 'search_opportunities' && latestToolActivity.value.status === 'completed') {
    return '已找到机会，正在整理回答'
  }
  if (chat.isCancelling.value) return streamingAssistantText.value ? 'AI 正在回答' : 'AI 正在工作'

  switch (chat.stream.connectionState.value) {
    case 'connecting':
      return '正在连接'
    case 'connected':
      return 'AI 正在工作'
    case 'completed':
      return '已完成'
    case 'failed':
      return '执行失败'
    case 'aborted':
      return '已停止'
    default:
      return ''
  }
})
const chatUiStatus = computed<'ready' | 'submitted' | 'streaming'>(() => {
  // 取消阶段沿用当前助手消息的 indicator，不创建一条新的“正在停止”记录。
  if (chat.isCancelling.value) return 'streaming'
  if (chat.isSending.value) return 'submitted'
  if (isStreamActive.value) return 'streaming'
  return 'ready'
})
const isChatSubmitDisabled = computed(() => {
  if (chat.isCancelling.value) return true
  if (isAwaitingToolInput.value) return true
  if (isAwaitingToolConfirmation.value) return true
  // 流式阶段按钮承担的是“停止”职责，不能再受空输入框条件限制。
  if (chatUiStatus.value === 'streaming') return false
  return !draft.value.trim() || !isModelConfigured.value || isConversationArchived.value
})
const scopeLabel = computed(() => {
  if (!selectedConversation.value) {
    return draftOpportunity.value ? `${draftOpportunity.value.company} · ${draftOpportunity.value.jobTitle}` : '新对话'
  }
  if (selectedConversation.value.scopeType === 'global') return '全局会话'

  const opportunity = opportunities.value.find((item) => item.id === selectedConversation.value?.opportunityId)
  return opportunity ? `${opportunity.company} · ${opportunity.jobTitle}` : '机会会话'
})
const historyScopeItems = computed<Array<{ label: string; value: ChatHistoryScopeFilter; disabled?: boolean }>>(() => [
  { label: '全部', value: 'all' },
  { label: '全局', value: 'global' },
  {
    label: '当前机会',
    value: 'current_opportunity',
    disabled: !currentOpportunityId.value,
  },
])
const visibleHistoryConversations = computed(() => chatStore.historyConversations)
const historyPanelTitle = computed(() => (showArchived.value ? '归档对话' : '历史对话'))
const persistedChatUiMessages = computed<ChatUiMessage[]>(() =>
  chat.messages.value.flatMap<ChatUiMessage>((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const parts = message.parts.flatMap<ChatUiMessage['parts'][number]>((part) => {
      if (part.type === 'text') {
        const text = message.role === 'assistant' ? toUserVisibleChatText(part.text) : part.text
        return text ? [{ ...part, text }] : []
      }
      if (part.type === 'opportunity_search_result') return [part]
      if (part.type === 'opportunity_import_result') return [part]
      if (part.type === 'tool_action') {
        const actionPart = toPersistedOpportunityActionPart(part.toolActionId)
        return actionPart ? [actionPart] : []
      }
      return []
    })
    const text = parts
      .filter((part): part is Extract<(typeof parts)[number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('')
    if (!text && parts.length === 0) return []

    return [
      {
        id: message.id,
        role: message.role,
        parts,
        references: message.references,
        metadata: {
          createdAt: message.createdAt,
          cancelled: message.status === 'cancelled',
          failed: message.status === 'failed',
        },
      },
    ]
  }),
)
const optimisticUiMessage = computed<ChatUiMessage | null>(() => {
  if (!optimisticText.value) return null
  const optimisticTimestamp = optimisticSentAt.value ? new Date(optimisticSentAt.value).getTime() : 0
  const hasPersistedEquivalent = chat.messages.value.some(
    (message) =>
      message.role === 'user' &&
      getChatMessageRecordText(message) === optimisticText.value &&
      new Date(message.createdAt).getTime() >= optimisticTimestamp - 5_000,
  )
  if (hasPersistedEquivalent) return null

  return {
    id: 'optimistic-user-message',
    role: 'user',
    parts: [{ type: 'text', text: optimisticText.value }],
    references: optimisticReferences.value,
    metadata: { createdAt: optimisticSentAt.value ?? new Date().toISOString() },
  }
})
const streamingMessageCreatedAt = computed(
  () => chat.activeRun.value?.startedAt ?? optimisticSentAt.value ?? new Date().toISOString(),
)
const displayedStreamingAssistantText = computed(() => toUserVisibleChatText(streamingAssistantText.value))
const shouldShowOpportunityResultSkeleton = computed(() => {
  const activity = latestToolActivity.value
  return (
    activity?.name === 'search_opportunities' &&
    activity.status === 'completed' &&
    toolSkeletonReady.value &&
    (isStreamActive.value || chat.isCancelling.value || chat.isFinalizing.value)
  )
})

function getInteractionLeadingTextLength(callId: string, boundaryType: 'input_requested' | 'confirmation_requested') {
  const boundaryEvent = chat.stream.events.value.find(
    (event) => event.eventType === boundaryType && event.payload.callId === callId,
  )
  if (!boundaryEvent) return displayedStreamingAssistantText.value.length

  return chat.stream.events.value.reduce((length, event) => {
    if (
      event.sequence >= boundaryEvent.sequence ||
      event.eventType !== 'message_delta' ||
      typeof event.payload.text !== 'string'
    ) {
      return length
    }
    return length + event.payload.text.length
  }, 0)
}

function createStreamingInputActionPart():
  | InterviewScheduleInputActionPart
  | MockInterviewInputActionPart
  | ReviewInputActionPart
  | OpportunityTargetInputActionPart
  | ResumeTargetInputActionPart
  | null {
  const request = latestToolInputRequest.value
  if (!request) return null

  if (request.toolName === 'get_capability_profile') {
    const presentation = chatResumeTargetInputPresentationSchema.safeParse(request.presentation)
    return presentation.success
      ? {
          type: 'resume_target_input_action',
          requestId: request.requestId,
          presentation: presentation.data,
          status: request.status,
        }
      : null
  }

  if (
    [
      'get_opportunity_context',
      'update_opportunity_profile',
      'batch_update_opportunity_profiles',
      'transition_opportunity_status',
      'create_interview_schedule',
      'create_mock_interview',
      'save_written_test_review',
      'save_interview_review',
    ].includes(request.toolName)
  ) {
    const presentation = chatOpportunityTargetInputPresentationSchema.safeParse(request.presentation)
    if (presentation.success) {
      return {
        type: 'opportunity_target_input_action',
        requestId: request.requestId,
        presentation: presentation.data,
        status: request.status,
      }
    }
  }

  if (request.toolName === 'create_interview_schedule') {
    const presentation = chatInterviewScheduleInputPresentationSchema.safeParse(request.presentation)
    return presentation.success
      ? {
          type: 'interview_schedule_input_action',
          requestId: request.requestId,
          presentation: presentation.data,
          status: request.status,
        }
      : null
  }

  if (request.toolName === 'create_mock_interview') {
    const presentation = chatMockInterviewInputPresentationSchema.safeParse(request.presentation)
    return presentation.success
      ? {
          type: 'mock_interview_input_action',
          requestId: request.requestId,
          presentation: presentation.data,
          status: request.status,
        }
      : null
  }

  if (request.toolName === 'save_written_test_review' || request.toolName === 'save_interview_review') {
    const presentation = chatReviewInputPresentationSchema.safeParse(request.presentation)
    return presentation.success
      ? {
          type: 'review_input_action',
          requestId: request.requestId,
          presentation: presentation.data,
          status: request.status,
        }
      : null
  }

  return null
}

function createStreamingConfirmationActionPart(): OpportunityConfirmationActionPart | null {
  const confirmation = latestToolConfirmation.value
  if (
    !confirmation ||
    ![
      'update_opportunity_intention_level',
      'update_opportunity_profile',
      'batch_update_opportunity_profiles',
      'transition_opportunity_status',
      'create_interview_schedule',
      'create_mock_interview',
      'save_written_test_review',
      'save_interview_review',
    ].includes(confirmation.toolName)
  ) {
    return null
  }

  const activity = chat.stream.toolActivities.value.find((item) => item.callId === confirmation.callId)
  const status: OpportunityIntentionConfirmationStatus =
    confirmation.status === 'waiting'
      ? 'waiting'
      : confirmation.status === 'rejected'
        ? 'rejected'
        : activity?.status === 'failed'
          ? 'failed'
          : activity?.status === 'completed'
            ? 'completed'
            : 'approving'

  if (confirmation.toolName === 'update_opportunity_intention_level') {
    const presentation = chatOpportunityIntentionChangePresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'opportunity_intention_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }

  if (confirmation.toolName === 'update_opportunity_profile') {
    const presentation = chatOpportunityProfileChangePresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'opportunity_profile_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }

  if (confirmation.toolName === 'batch_update_opportunity_profiles') {
    const presentation = chatOpportunityProfileBatchChangePresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'opportunity_profile_batch_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }

  if (confirmation.toolName === 'transition_opportunity_status') {
    const presentation = chatOpportunityStatusTransitionPresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'opportunity_status_transition_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }

  if (confirmation.toolName === 'create_interview_schedule') {
    const presentation = chatInterviewScheduleCreatePresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'interview_schedule_confirmation_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }
  if (confirmation.toolName === 'create_mock_interview') {
    const presentation = chatMockInterviewCreatePresentationSchema.safeParse(confirmation.presentation)
    const sessionId = typeof activity?.output?.sessionId === 'string' ? activity.output.sessionId : null
    return presentation.success
      ? {
          type: 'mock_interview_confirmation_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
          sessionId,
        }
      : null
  }
  if (confirmation.toolName === 'save_written_test_review' || confirmation.toolName === 'save_interview_review') {
    const presentation = chatReviewSavePresentationSchema.safeParse(confirmation.presentation)
    return presentation.success
      ? {
          type: 'review_confirmation_action',
          toolActionId: confirmation.toolActionId,
          presentation: presentation.data,
          status,
        }
      : null
  }
  return null
}

const chatUiMessages = computed<ChatUiMessage[]>(() => {
  const messages = [...persistedChatUiMessages.value]

  if (optimisticUiMessage.value) messages.push(optimisticUiMessage.value)

  const lastPersistedMessage = chat.messages.value.at(-1)
  const shouldShowStreamingMessage =
    isStreamActive.value ||
    isAwaitingToolInput.value ||
    isSubmittingToolInput.value ||
    isAwaitingToolConfirmation.value ||
    (chat.isCancelling.value && lastPersistedMessage?.role !== 'assistant') ||
    shouldShowOpportunityResultSkeleton.value ||
    (Boolean(displayedStreamingAssistantText.value) &&
      (chat.isCancelling.value || chat.stream.connectionState.value === 'aborted')) ||
    (chat.isFinalizing.value && lastPersistedMessage?.role !== 'assistant')

  if (shouldShowStreamingMessage) {
    const parts: ChatUiMessage['parts'] = []
    const confirmationPart = createStreamingConfirmationActionPart()
    const inputPart = createStreamingInputActionPart()
    const interactionPart = confirmationPart ?? inputPart
    const displayedText = displayedStreamingAssistantText.value

    if (interactionPart) {
      const callId = confirmationPart ? latestToolConfirmation.value!.callId : latestToolInputRequest.value!.callId
      const boundaryType = confirmationPart ? 'confirmation_requested' : 'input_requested'
      const leadingTextLength = Math.min(getInteractionLeadingTextLength(callId, boundaryType), displayedText.length)
      const leadingText = displayedText.slice(0, leadingTextLength)
      const trailingText = displayedText.slice(leadingTextLength)
      if (leadingText) parts.push({ type: 'text', text: leadingText })
      parts.push(interactionPart)
      if (trailingText) parts.push({ type: 'text', text: trailingText })
    } else if (displayedText) {
      parts.push({ type: 'text', text: displayedText })
    }
    if (shouldShowOpportunityResultSkeleton.value) parts.push({ type: 'opportunity_search_placeholder' })

    messages.push({
      id: 'streaming-assistant-message',
      role: 'assistant',
      parts,
      references: [],
      metadata: {
        createdAt: streamingMessageCreatedAt.value,
        streaming: isStreamActive.value && !chat.isCancelling.value,
        pending:
          isStreamActive.value ||
          isAwaitingToolInput.value ||
          isSubmittingToolInput.value ||
          isAwaitingToolConfirmation.value ||
          Boolean(chat.submittingInputRequestId.value) ||
          Boolean(chat.confirmingToolActionId.value) ||
          chat.isCancelling.value ||
          chat.isFinalizing.value,
      },
    })
  }

  return messages
})
const currentOpportunityDescription = computed(() => {
  if (!currentOpportunity.value) return ''
  return `${currentOpportunity.value.company} · ${currentOpportunity.value.jobTitle}`
})

function formatMessageTime(value: unknown) {
  if (typeof value !== 'string') return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatConversationTime(value: string | null) {
  if (!value) return '暂无消息'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(
    'zh-CN',
    isToday ? { hour: '2-digit', minute: '2-digit' } : { month: '2-digit', day: '2-digit' },
  ).format(date)
}

function selectConversation(conversationId: string) {
  if (isConversationMutationPending.value) return
  chatStore.selectConversation(conversationId)
  historyOpen.value = false
}

function setDeletePopoverOpen(conversationId: string, open: boolean) {
  deletePopoverConversationId.value = open ? conversationId : null
}

function getConversationScopeLabel(conversation: ChatConversationRecord) {
  if (conversation.scopeType === 'global') return '全局会话'
  const opportunity = opportunities.value.find((item) => item.id === conversation.opportunityId)
  return opportunity ? `${opportunity.company} · ${opportunity.jobTitle}` : '机会会话'
}

function getUiMessageText(message: Pick<ChatUiMessage, 'parts'>) {
  return message.parts
    .filter((part): part is Extract<ChatUiMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function isStreamingTextPart(message: ChatUiMessage, partIndex: number) {
  if (!message.metadata.streaming) return false
  return !message.parts.slice(partIndex + 1).some((part) => part.type === 'text' || part.type.endsWith('_action'))
}

function getPersistedToolActionStatus(action: (typeof chat.toolActions.value)[number]) {
  return action.status === 'completed'
    ? 'completed'
    : action.status === 'failed'
      ? 'failed'
      : action.status === 'cancelled' || action.userDecision === 'rejected'
        ? 'rejected'
        : action.userDecision === 'approved'
          ? 'approving'
          : 'waiting'
}

function toPersistedOpportunityIntentionActionPart(toolActionId: string): OpportunityIntentionActionPart | null {
  const action = chat.toolActions.value.find((item) => item.id === toolActionId)
  if (!action || action.toolName !== 'update_opportunity_intention_level') return null

  const presentation = chatOpportunityIntentionChangePresentationSchema.safeParse(action.input.confirmationPresentation)
  if (!presentation.success) return null

  return {
    type: 'opportunity_intention_action',
    toolActionId,
    presentation: presentation.data,
    status: getPersistedToolActionStatus(action),
  }
}

function toPersistedOpportunityActionPart(toolActionId: string): OpportunityConfirmationActionPart | null {
  const action = chat.toolActions.value.find((item) => item.id === toolActionId)
  if (!action) return null
  if (action.toolName === 'update_opportunity_intention_level') {
    return toPersistedOpportunityIntentionActionPart(toolActionId)
  }

  if (action.toolName === 'update_opportunity_profile') {
    const presentation = chatOpportunityProfileChangePresentationSchema.safeParse(action.input.confirmationPresentation)
    if (!presentation.success) return null
    return {
      type: 'opportunity_profile_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
    }
  }

  if (action.toolName === 'batch_update_opportunity_profiles') {
    const presentation = chatOpportunityProfileBatchChangePresentationSchema.safeParse(
      action.input.confirmationPresentation,
    )
    if (!presentation.success) return null
    return {
      type: 'opportunity_profile_batch_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
    }
  }

  if (action.toolName === 'transition_opportunity_status') {
    const presentation = chatOpportunityStatusTransitionPresentationSchema.safeParse(
      action.input.confirmationPresentation,
    )
    if (!presentation.success) return null
    return {
      type: 'opportunity_status_transition_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
    }
  }

  if (action.toolName === 'create_interview_schedule') {
    const presentation = chatInterviewScheduleCreatePresentationSchema.safeParse(action.input.confirmationPresentation)
    if (!presentation.success) return null
    return {
      type: 'interview_schedule_confirmation_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
    }
  }

  if (action.toolName === 'create_mock_interview') {
    const presentation = chatMockInterviewCreatePresentationSchema.safeParse(action.input.confirmationPresentation)
    if (!presentation.success) return null
    return {
      type: 'mock_interview_confirmation_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
      sessionId: typeof action.output?.sessionId === 'string' ? action.output.sessionId : null,
    }
  }

  if (action.toolName === 'save_written_test_review' || action.toolName === 'save_interview_review') {
    const presentation = chatReviewSavePresentationSchema.safeParse(action.input.confirmationPresentation)
    if (!presentation.success) return null
    return {
      type: 'review_confirmation_action',
      toolActionId,
      presentation: presentation.data,
      status: getPersistedToolActionStatus(action),
    }
  }

  return null
}

async function resolveToolConfirmation(toolActionId: string, decision: 'approved' | 'rejected') {
  if (chat.confirmingToolActionId.value) return
  try {
    await chat.confirmToolAction(toolActionId, decision, settingsStore.llm)
  } catch (error) {
    toast.add({
      title: decision === 'approved' ? '修改确认失败' : '取消操作失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

async function submitToolInput(requestId: string, value: unknown) {
  if (chat.submittingInputRequestId.value) return
  try {
    await chat.provideToolInput(requestId, value, settingsStore.llm)
  } catch (error) {
    toast.add({
      title: '补充信息提交失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

async function cancelToolInput(
  kind: 'interview_schedule' | 'mock_interview' | 'review' | 'opportunity_target' | 'resume_target',
) {
  try {
    await chat.cancel(
      kind === 'resume_target'
        ? 'resume_target_cancelled'
        : kind === 'opportunity_target'
          ? 'opportunity_target_cancelled'
          : kind === 'review'
            ? 'review_input_cancelled'
            : kind === 'mock_interview'
              ? 'mock_interview_input_cancelled'
              : 'interview_schedule_input_cancelled',
    )
  } catch (error) {
    toast.add({
      title:
        kind === 'resume_target'
          ? '取消选择简历失败'
          : kind === 'opportunity_target'
            ? '取消选择机会失败'
            : kind === 'review'
              ? '取消填写复盘失败'
              : kind === 'mock_interview'
                ? '取消创建模拟面试失败'
                : '取消创建面试安排失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

function clearToolSkeletonTimer() {
  if (toolSkeletonTimer === null) return
  window.clearTimeout(toolSkeletonTimer)
  toolSkeletonTimer = null
}

function resetToolPresentation() {
  clearToolSkeletonTimer()
  presentedToolCallId = null
  toolSkeletonReady.value = false
}

function beginToolPresentation(callId: string) {
  clearToolSkeletonTimer()
  presentedToolCallId = callId
  toolSkeletonReady.value = false
}

function scheduleToolSkeleton(delay: number) {
  if (toolSkeletonReady.value || toolSkeletonTimer !== null) return
  toolSkeletonTimer = window.setTimeout(() => {
    toolSkeletonTimer = null
    if (!presentedToolCallId) return
    toolSkeletonReady.value = true
  }, delay)
}

function getChatMessageRecordText(message: (typeof chat.messages.value)[number]) {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

async function copyChatMessage(message: ChatUiMessage) {
  const text = getUiMessageText(message)
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    copiedMessageId.value = message.id
    if (copiedMessageTimer !== null) window.clearTimeout(copiedMessageTimer)
    copiedMessageTimer = window.setTimeout(() => {
      copiedMessageId.value = null
      copiedMessageTimer = null
    }, 1_800)
  } catch {
    toast.add({ title: '复制失败，请检查浏览器权限', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function getHistoryQuery() {
  const search = debouncedHistorySearch.value.trim()
  const base = {
    limit: 20,
    archived: showArchived.value ? ('archived' as const) : ('active' as const),
    ...(search ? { search } : {}),
  }

  if (historyScopeFilter.value === 'global') return { ...base, scopeType: 'global' as const }
  if (historyScopeFilter.value === 'current_opportunity' && currentOpportunityId.value) {
    return {
      ...base,
      scopeType: 'opportunity' as const,
      opportunityId: currentOpportunityId.value,
    }
  }
  return base
}

function updateBackToLatestVisibility() {
  const container = chatScrollContainer.value
  if (!container) {
    showBackToLatest.value = false
    return
  }

  if (isScrollingToLatest) {
    showBackToLatest.value = false
    return
  }

  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  showBackToLatest.value = distanceFromBottom > 96
}

function handleChatScroll() {
  const container = chatScrollContainer.value
  if (isScrollingToLatest && container) {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom <= 4) finishScrollToLatest()
    return
  }
  updateBackToLatestVisibility()
}

function finishScrollToLatest() {
  isScrollingToLatest = false
  if (scrollToLatestTimer !== null) window.clearTimeout(scrollToLatestTimer)
  scrollToLatestTimer = null
  updateBackToLatestVisibility()
}

function scrollToLatest() {
  const container = chatScrollContainer.value
  if (!container) return

  isScrollingToLatest = true
  if (scrollToLatestTimer !== null) window.clearTimeout(scrollToLatestTimer)
  showBackToLatest.value = false
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  // scroll 事件通常会在到达底部时结束保护；定时器只负责浏览器未派发末次事件时兜底。
  scrollToLatestTimer = window.setTimeout(finishScrollToLatest, 700)
}

async function loadHistory(force = false) {
  return chatStore.loadConversations(getHistoryQuery(), force)
}

async function openSelectedConversation() {
  const conversationId = chatStore.selectedConversationId
  optimisticText.value = null
  optimisticReferences.value = []
  draftReferences.value = []
  if (!conversationId) {
    chat.clear()
    return false
  }

  // 绑定机会只属于尚未落库的新对话草稿；打开任何历史会话时都必须清掉草稿绑定。
  draftOpportunityId.value = null
  try {
    const result = await chat.open(conversationId)
    chatStore.upsertConversation(result.conversation)
    const pendingSubmission = chat.getPendingSubmission()
    if (pendingSubmission) {
      optimisticText.value = pendingSubmission.text
      optimisticReferences.value = pendingSubmission.references
      optimisticSentAt.value = pendingSubmission.submittedAt
    }

    const recovery = await chat.recoverAfterOpen()
    optimisticText.value = null
    optimisticReferences.value = []
    optimisticSentAt.value = null
    if (recovery.status === 'not_accepted') {
      draft.value = recovery.draftText
      draftReferences.value = recovery.references
    }
    return true
  } catch {
    // 错误保留在 composable 中，由当前抽屉显示重试入口。
    return false
  }
}

async function ensureConversation() {
  if (isBootstrapping.value) return
  isBootstrapping.value = true
  try {
    const conversations = await loadHistory(true)
    if (chatStore.selectedConversationId && (await openSelectedConversation())) return

    chatStore.selectConversation(null)
    const firstGlobal = conversations.find(
      (conversation) => conversation.scopeType === 'global' && !conversation.archivedAt,
    )
    const fallback = firstGlobal ?? conversations.find((conversation) => !conversation.archivedAt) ?? null
    if (fallback) {
      skipNextConversationOpen = true
      chatStore.selectConversation(fallback.id)
      await openSelectedConversation()
    } else {
      chat.clear()
    }
  } catch {
    // chatStore.error 会在模板中显示。
  } finally {
    isBootstrapping.value = false
  }
}

function createGlobalConversation() {
  if (isBusy.value || isConversationMutationPending.value) return
  resetToNewConversationDraft()
}

function resetToNewConversationDraft() {
  chatStore.selectConversation(null)
  chat.clear()
  draft.value = ''
  draftReferences.value = []
  draftOpportunityId.value = null
  optimisticText.value = null
  optimisticReferences.value = []
  optimisticSentAt.value = null
  historyOpen.value = false
}

function beginRename(conversation: ChatConversationRecord) {
  editingConversationId.value = conversation.id
  editingConversationTitle.value = conversation.title
}

function cancelRename() {
  editingConversationId.value = null
  editingConversationTitle.value = ''
}

async function saveRename(conversationId: string) {
  const title = editingConversationTitle.value.trim()
  if (!title || isConversationMutationPending.value) return

  conversationMutation.value = { conversationId, type: 'rename' }
  try {
    await chatStore.updateConversation(conversationId, { title })
    cancelRename()
    await loadHistory(true)
  } finally {
    conversationMutation.value = null
  }
}

async function toggleArchive(conversation: ChatConversationRecord) {
  if (isConversationMutationPending.value) return

  const isArchiving = !conversation.archivedAt
  const isSelectedConversation = chatStore.selectedConversationId === conversation.id
  conversationMutation.value = { conversationId: conversation.id, type: 'archive' }
  try {
    await chatStore.updateConversation(conversation.id, { archived: isArchiving })
    if (isArchiving && isSelectedConversation) resetToNewConversationDraft()
    await loadHistory(true)
  } finally {
    conversationMutation.value = null
  }
}

async function removeConversation(conversation: ChatConversationRecord) {
  if (isConversationMutationPending.value) return

  conversationMutation.value = { conversationId: conversation.id, type: 'delete' }
  try {
    await chatStore.deleteConversation(conversation.id)
    deletePopoverConversationId.value = null
    if (chatStore.selectedConversationId === null) chat.clear()
  } finally {
    conversationMutation.value = null
  }
}

function toggleDraftOpportunityBinding() {
  if (selectedConversation.value) return
  if (draftOpportunityId.value) {
    draftOpportunityId.value = null
    return
  }
  if (currentOpportunity.value) {
    draftOpportunityId.value = currentOpportunity.value.id
    draftReferences.value = draftReferences.value.filter((reference) => reference.id !== currentOpportunity.value?.id)
  }
}

function addDraftOpportunityReference(opportunity: { id: string; company: string; jobTitle: string }) {
  if (
    draftReferences.value.length >= 5 ||
    draftReferences.value.some((reference) => reference.id === opportunity.id) ||
    opportunity.id === referenceExcludedOpportunityId.value
  ) {
    return
  }

  draftReferences.value.push({
    type: 'opportunity',
    id: opportunity.id,
    label: `${opportunity.company} · ${opportunity.jobTitle}`,
  })
}

function removeDraftReference(referenceId: string) {
  draftReferences.value = draftReferences.value.filter((reference) => reference.id !== referenceId)
}

function openReferencedOpportunity(reference: ChatMessageReference) {
  if (reference.type !== 'opportunity') return
  void router.push({ name: 'opportunity-detail', params: { id: reference.id } })
}

async function sendMessage() {
  const text = draft.value.trim()
  if (!text || isBusy.value || !isModelConfigured.value || isConversationArchived.value) return

  if (!selectedConversation.value) {
    isPreparingConversation.value = true
    try {
      const opportunity = draftOpportunity.value
      const title = opportunity
        ? `${opportunity.company} · ${opportunity.jobTitle}`
        : text.length > 24
          ? `${text.slice(0, 24)}…`
          : text
      const conversation = await chat.create({
        title,
        scopeType: opportunity ? 'opportunity' : 'global',
        opportunityId: opportunity?.id ?? null,
      })
      chatStore.upsertConversation(conversation)
      skipNextConversationOpen = true
      chatStore.selectConversation(conversation.id)
      draftOpportunityId.value = null
    } catch {
      return
    } finally {
      isPreparingConversation.value = false
    }
  }

  const references = [...draftReferences.value]
  draft.value = ''
  optimisticText.value = text
  optimisticReferences.value = references
  optimisticSentAt.value = new Date().toISOString()

  try {
    await chat.send({
      text,
      references,
      modelConnection: settingsStore.llm,
      budget: { maxModelCalls: 4, maxToolCalls: 8 },
    })
    draftReferences.value = []
    optimisticText.value = null
    optimisticReferences.value = []
    optimisticSentAt.value = null
    void loadHistory(true)
  } catch {
    draft.value = text
    optimisticText.value = null
    optimisticReferences.value = []
    optimisticSentAt.value = null
    chat.discardPendingSubmission()
  }
}

async function stopGeneration() {
  try {
    await chat.cancel()
  } catch {
    // 取消失败时保留错误提示，不伪装成已停止。
  }
}

function startResize(event: PointerEvent) {
  if (window.innerWidth < 1024) return

  isResizing.value = true
  resizeStartOpen = chatStore.isOpen
  resizeDistance = 0
  resizeStartX = event.clientX
  resizeStartWidth = chatStore.isOpen ? chatStore.width : minPanelWidth
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', handleResize)
  window.addEventListener('pointerup', stopResize)
}

function handleResize(event: PointerEvent) {
  if (!isResizing.value) return

  const horizontalDelta = resizeStartX - event.clientX
  resizeDistance = Math.max(resizeDistance, Math.abs(horizontalDelta))
  if (!resizeStartOpen && horizontalDelta < 8) return

  const nextWidth = resizeStartWidth + horizontalDelta
  if (nextWidth < collapsePanelThreshold) {
    if (chatStore.isOpen) chatStore.setOpen(false)
    return
  }

  if (!chatStore.isOpen && nextWidth < reopenPanelThreshold) return
  if (!chatStore.isOpen) chatStore.setOpen(true)

  chatStore.setWidth(Math.min(maxPanelWidth, Math.max(minPanelWidth, nextWidth)))
}

function stopResize() {
  if (!isResizing.value) return

  isResizing.value = false
  suppressResizeHandleClick = resizeDistance > 4
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', handleResize)
  window.removeEventListener('pointerup', stopResize)
  window.setTimeout(() => {
    suppressResizeHandleClick = false
  }, 0)
}

function handleResizeHandleClick() {
  if (suppressResizeHandleClick || chatStore.isOpen) return
  handleDrawerOpen(true)
}

async function reloadConversation() {
  await openSelectedConversation()
}

function handleDrawerOpen(nextOpen: boolean) {
  chatStore.setOpen(nextOpen)
  if (nextOpen) void ensureConversation()
}

watch(
  () => chatStore.selectedConversationId,
  () => {
    if (skipNextConversationOpen) {
      skipNextConversationOpen = false
      return
    }
    void openSelectedConversation()
  },
)
watch(
  [latestToolPresentation, isStreamActive, () => chat.isCancelling.value, () => chat.isFinalizing.value],
  ([presentation, streamActive, cancelling, finalizing]) => {
    if (
      !presentation ||
      presentation.activity.name !== 'search_opportunities' ||
      presentation.activity.status === 'failed' ||
      (!streamActive && !cancelling && !finalizing)
    ) {
      resetToolPresentation()
      return
    }
    const activity = presentation.activity

    if (presentedToolCallId !== activity.callId) beginToolPresentation(activity.callId)
    if (toolSkeletonReady.value) return

    if (activity.status !== 'completed') {
      // 工具状态由当前助手消息内的状态行展示；不能伪造成模型已经输出的正文。
      return
    }

    // 工具完成并且最终回答已经真正开始播放后，骨架屏才表示“结果卡片即将出现”。
    if (!presentation.hasPostToolDelta || !presentation.hasRenderedPostToolText) return
    scheduleToolSkeleton(160)
  },
  { immediate: true },
)
watch(
  () => chat.stream.toolActivities.value,
  (activities) => {
    for (const activity of activities) {
      if (
        ![
          'update_opportunity_intention_level',
          'update_opportunity_profile',
          'batch_update_opportunity_profiles',
          'transition_opportunity_status',
          'create_interview_schedule',
          'create_mock_interview',
          'save_written_test_review',
          'save_interview_review',
        ].includes(activity.name) ||
        activity.status !== 'completed' ||
        refreshedMutationToolCallIds.has(activity.callId)
      )
        continue

      refreshedMutationToolCallIds.add(activity.callId)
      opportunityStore.publishOpportunityMutation()
      const opportunityId =
        typeof activity.output?.opportunityId === 'string'
          ? activity.output.opportunityId
          : selectedConversation.value?.opportunityId
      if (opportunityId) void opportunityStore.loadOpportunityDetail(opportunityId, { force: true, silent: true })
    }
  },
  { deep: true },
)
watch(
  () => chatStore.isOpen,
  (isOpen) => {
    if (isOpen && !chat.conversation.value) void ensureConversation()
  },
)
watch(currentOpportunityId, (opportunityId) => {
  if (!opportunityId && historyScopeFilter.value === 'current_opportunity') {
    historyScopeFilter.value = 'all'
  }
})
watch(historySearch, (value) => {
  if (historySearchDebounceTimer !== null) window.clearTimeout(historySearchDebounceTimer)
  historySearchDebounceTimer = window.setTimeout(() => {
    debouncedHistorySearch.value = value
    historySearchDebounceTimer = null
  }, 300)
})
watch([debouncedHistorySearch, historyScopeFilter, showArchived, currentOpportunityId], () => {
  if (chatStore.isOpen && historyOpen.value) void loadHistory(true)
})
watch(historyOpen, (isOpen) => {
  if (isOpen) void loadHistory(true)
})
watch(draft, (value, previousValue) => {
  if (
    isBusy.value ||
    isConversationArchived.value ||
    value.length !== previousValue.length + 1 ||
    !value.endsWith('@')
  ) {
    return
  }

  const characterBeforeAt = value.at(-2)
  if (characterBeforeAt && !/\s/.test(characterBeforeAt)) return

  // @ 是打开引用选择器的快捷键，不作为用户问题正文发送。
  draft.value = value.slice(0, -1)
  void nextTick(() => referencePicker.value?.show())
})
watch([() => chat.messages.value.length, chatUiStatus], () => void nextTick(updateBackToLatestVisibility))
onMounted(() => {
  if (chatStore.isOpen) void ensureConversation()
})
onBeforeUnmount(() => {
  if (historySearchDebounceTimer !== null) window.clearTimeout(historySearchDebounceTimer)
  if (copiedMessageTimer !== null) window.clearTimeout(copiedMessageTimer)
  if (scrollToLatestTimer !== null) window.clearTimeout(scrollToLatestTimer)
  clearToolSkeletonTimer()
  chat.stop()
  stopResize()
})
</script>

<template>
  <button
    type="button"
    class="chat-resize-handle fixed top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center border border-default bg-default text-muted shadow-[0_4px_18px_rgb(15_23_42/14%)] lg:flex"
    :class="{
      'chat-resize-handle--closed': !chatStore.isOpen,
      'chat-resize-handle--dragging': isResizing,
    }"
    :style="{
      right: chatStore.isOpen ? `${chatStore.width - 10}px` : '0px',
      zIndex: 'calc(var(--app-z-assistant) + 1)',
    }"
    :aria-label="chatStore.isOpen ? '调整 AI 助手宽度' : '展开 AI 助手'"
    :aria-expanded="chatStore.isOpen"
    :title="chatStore.isOpen ? '拖动调整宽度，拖到最窄处可收起' : '向左拖动或点击展开 AI 助手'"
    @pointerdown.prevent="startResize"
    @click="handleResizeHandleClick"
  >
    <span class="chat-resize-handle__grip" aria-hidden="true" />
  </button>

  <Transition name="chat-panel">
    <aside
      v-if="chatStore.isOpen"
      class="fixed inset-y-0 right-0 flex h-screen max-w-full overflow-hidden overscroll-contain border-l border-default bg-default shadow-[-14px_0_36px_rgb(15_23_42/10%)]"
      :style="{ width: `${chatStore.width}px`, zIndex: 'var(--app-z-assistant)' }"
      aria-label="全局 AI 助手"
      @wheel.stop
    >
      <section class="flex h-full min-h-0 w-full flex-col">
        <header class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UIcon name="i-lucide-sparkles" class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-highlighted">AI 助手</p>
              <p class="truncate text-xs text-muted">{{ scopeLabel }}</p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-plus"
              aria-label="新建全局对话"
              title="新建全局对话"
              :disabled="isBusy || isConversationMutationPending"
              @click="createGlobalConversation"
            />
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-history"
              aria-label="查看历史对话"
              title="查看历史对话"
              @click="historyOpen = !historyOpen"
            />
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-panel-right-close"
              aria-label="收起 AI 助手"
              title="收起 AI 助手"
              @click="handleDrawerOpen(false)"
            />
          </div>
        </header>

        <Transition name="chat-history">
          <ChatConversationHistoryPanel
            v-if="historyOpen"
            v-model:search="historySearch"
            v-model:show-archived="showArchived"
            v-model:scope-filter="historyScopeFilter"
            v-model:editing-conversation-title="editingConversationTitle"
            :panel-title="historyPanelTitle"
            :total="chatStore.historyTotal"
            :scope-items="historyScopeItems"
            :loading="chatStore.isLoadingConversations"
            :loading-more="chatStore.isLoadingMoreConversations"
            :has-more="chatStore.historyHasMore"
            :conversations="visibleHistoryConversations"
            :selected-conversation-id="chatStore.selectedConversationId"
            :mutation-pending="isConversationMutationPending"
            :editing-conversation-id="editingConversationId"
            :conversation-mutation="conversationMutation"
            :delete-popover-conversation-id="deletePopoverConversationId"
            :get-conversation-scope-label="getConversationScopeLabel"
            :format-conversation-time="formatConversationTime"
            @select="selectConversation"
            @begin-rename="beginRename"
            @save-rename="saveRename"
            @cancel-rename="cancelRename"
            @toggle-archive="toggleArchive"
            @remove="removeConversation"
            @load-more="chatStore.loadMoreConversations()"
            @set-delete-popover-open="setDeletePopoverOpen"
          />
        </Transition>

        <div v-if="shouldShowDraftOpportunityBinding" class="border-b border-default px-4 py-2.5">
          <div class="flex items-center justify-between gap-3 rounded-xl bg-primary/5 px-3 py-2">
            <p class="min-w-0 truncate text-xs text-muted">
              {{ draftOpportunity ? '已绑定' : '当前页面' }}：{{
                draftOpportunity
                  ? `${draftOpportunity.company} · ${draftOpportunity.jobTitle}`
                  : currentOpportunityDescription
              }}
            </p>
            <UButton type="button" color="primary" variant="link" size="xs" @click="toggleDraftOpportunityBinding">
              {{ draftOpportunity ? '取消绑定' : '绑定当前机会' }}
            </UButton>
          </div>
        </div>

        <div class="relative min-h-0 flex-1">
          <div
            ref="chatScrollContainer"
            class="chat-message-scroll absolute inset-0 overflow-y-auto overscroll-contain"
            @scroll.passive="handleChatScroll"
          >
            <div v-if="isBootstrapping || isLoadingConversation" class="space-y-3 px-4 py-5">
              <div class="h-16 animate-pulse rounded-2xl bg-[var(--app-surface-muted)]" />
              <div class="ml-8 h-20 animate-pulse rounded-2xl bg-[var(--app-surface-muted)]" />
            </div>

            <div v-else-if="chatStore.error || conversationError" class="px-4 py-5">
              <div class="rounded-2xl border border-error/25 bg-error/5 p-4 text-sm text-error">
                {{
                  chatStore.error ??
                  (conversationError instanceof Error ? conversationError.message : '当前对话加载失败')
                }}
                <UButton
                  class="mt-3"
                  type="button"
                  color="error"
                  variant="outline"
                  size="sm"
                  @click="reloadConversation"
                >
                  重新读取
                </UButton>
              </div>
            </div>

            <div
              v-else-if="chatUiMessages.length === 0 && !isStreamActive"
              class="flex min-h-full flex-col items-center justify-center px-8 py-12 text-center"
            >
              <span class="flex size-10 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                <UIcon name="i-lucide-sparkles" class="size-5" />
              </span>
              <p class="mt-3 text-sm font-medium text-highlighted">想先从哪件事开始？</p>
              <p class="mt-1 max-w-64 text-xs leading-5 text-muted">
                可以询问简历、机会进展、面试准备或今天的求职安排。
              </p>
            </div>

            <UChatMessages
              v-else
              :messages="chatUiMessages"
              :status="chatUiStatus"
              :should-auto-scroll="true"
              :should-scroll-to-bottom="true"
              :auto-scroll="false"
              class="px-4 pb-6 pt-5"
              :user="{
                side: 'right',
                variant: 'soft',
                color: 'primary',
                ui: {
                  root: 'max-w-[86%] self-end',
                  content: 'text-sm leading-6 text-highlighted',
                  actions: 'right-0 [@media(hover:hover)]:opacity-45 hover:!opacity-100',
                },
              }"
              :assistant="{
                side: 'left',
                variant: 'naked',
                icon: 'i-lucide-sparkles',
                ui: {
                  root: 'max-w-[92%]',
                  leading:
                    'mt-0 flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-primary/20 bg-primary/7',
                  leadingIcon: 'size-3.5 text-primary',
                  content: 'text-sm leading-6 text-highlighted',
                  actions: 'left-10 [@media(hover:hover)]:opacity-45 hover:!opacity-100',
                },
              }"
            >
              <template #header="{ message }">
                <span class="flex items-center gap-2 text-[10px] font-normal text-muted">
                  <span v-if="formatMessageTime(message.metadata?.createdAt)">
                    {{ formatMessageTime(message.metadata?.createdAt) }}
                  </span>
                  <span v-if="message.metadata?.cancelled">已停止</span>
                  <span v-if="message.metadata?.failed">执行失败</span>
                </span>
              </template>
              <template #content="{ message }">
                <div class="space-y-3">
                  <div v-if="message.references?.length" class="flex flex-wrap justify-end gap-1.5">
                    <button
                      v-for="reference in message.references"
                      :key="`${message.id}-${reference.type}-${reference.id}`"
                      type="button"
                      class="group inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/7 px-2 py-1 text-[10px] text-primary transition-colors hover:border-primary/40 hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      :title="reference.label"
                      @click="openReferencedOpportunity(reference)"
                    >
                      <UIcon name="i-lucide-link-2" class="size-3 shrink-0" />
                      <span class="truncate">{{ reference.label ?? '已引用机会' }}</span>
                      <UIcon
                        v-if="reference.type === 'opportunity'"
                        name="i-lucide-external-link"
                        class="size-2.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-100"
                      />
                    </button>
                  </div>
                  <template v-for="(part, index) in message.parts" :key="`${message.id}-${part.type}-${index}`">
                    <ChatMarkdownContent
                      v-if="part.type === 'text'"
                      :content="part.text"
                      :streaming="isStreamingTextPart(message, index)"
                    />
                    <OpportunitySearchResultCard v-else-if="part.type === 'opportunity_search_result'" :part="part" />
                    <OpportunityImportResultCard v-else-if="part.type === 'opportunity_import_result'" :part="part" />
                    <OpportunitySearchResultSkeleton v-else-if="part.type === 'opportunity_search_placeholder'" />
                    <OpportunityTargetInputCard
                      v-else-if="part.type === 'opportunity_target_input_action'"
                      :request-id="part.requestId"
                      :presentation="part.presentation"
                      :pending="chat.submittingInputRequestId.value === part.requestId || part.status === 'submitted'"
                      :cancelling="chat.isCancelling.value"
                      @submit="submitToolInput(part.requestId, $event)"
                      @cancel="cancelToolInput('opportunity_target')"
                    />
                    <ResumeTargetInputCard
                      v-else-if="part.type === 'resume_target_input_action'"
                      :request-id="part.requestId"
                      :presentation="part.presentation"
                      :pending="chat.submittingInputRequestId.value === part.requestId || part.status === 'submitted'"
                      :cancelling="chat.isCancelling.value"
                      @submit="submitToolInput(part.requestId, $event)"
                      @cancel="cancelToolInput('resume_target')"
                    />
                    <InterviewScheduleInputCard
                      v-else-if="part.type === 'interview_schedule_input_action'"
                      :presentation="part.presentation"
                      :pending="chat.submittingInputRequestId.value === part.requestId || part.status === 'submitted'"
                      :cancelling="chat.isCancelling.value"
                      @submit="submitToolInput(part.requestId, $event)"
                      @cancel="cancelToolInput('interview_schedule')"
                    />
                    <ReviewInputCard
                      v-else-if="part.type === 'review_input_action'"
                      :presentation="part.presentation"
                      :pending="chat.submittingInputRequestId.value === part.requestId || part.status === 'submitted'"
                      :cancelling="chat.isCancelling.value"
                      @submit="submitToolInput(part.requestId, $event)"
                      @cancel="cancelToolInput('review')"
                    />
                    <MockInterviewInputCard
                      v-else-if="part.type === 'mock_interview_input_action'"
                      :presentation="part.presentation"
                      :pending="chat.submittingInputRequestId.value === part.requestId || part.status === 'submitted'"
                      :cancelling="chat.isCancelling.value"
                      @submit="submitToolInput(part.requestId, $event)"
                      @cancel="cancelToolInput('mock_interview')"
                    />
                    <OpportunityIntentionConfirmationCard
                      v-else-if="part.type === 'opportunity_intention_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <OpportunityProfileConfirmationCard
                      v-else-if="part.type === 'opportunity_profile_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <OpportunityProfileBatchConfirmationCard
                      v-else-if="part.type === 'opportunity_profile_batch_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <OpportunityStatusTransitionConfirmationCard
                      v-else-if="part.type === 'opportunity_status_transition_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <InterviewScheduleConfirmationCard
                      v-else-if="part.type === 'interview_schedule_confirmation_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <ReviewConfirmationCard
                      v-else-if="part.type === 'review_confirmation_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                    <MockInterviewConfirmationCard
                      v-else-if="part.type === 'mock_interview_confirmation_action'"
                      :presentation="part.presentation"
                      :status="part.status"
                      :session-id="part.sessionId"
                      :pending-decision="
                        chat.confirmingToolActionId.value === part.toolActionId
                          ? chat.confirmingToolDecision.value
                          : null
                      "
                      @approve="resolveToolConfirmation(part.toolActionId, 'approved')"
                      @reject="resolveToolConfirmation(part.toolActionId, 'rejected')"
                    />
                  </template>
                  <Transition name="chat-tool-status">
                    <div
                      v-if="message.id === 'streaming-assistant-message' && activeToolNotice"
                      class="chat-tool-status"
                      :class="`is-${activeToolNotice.status}`"
                      role="status"
                      aria-live="polite"
                    >
                      <UIcon
                        :name="activeToolNotice.icon"
                        class="size-3.5 shrink-0"
                        :class="activeToolNotice.status === 'running' ? 'animate-spin' : ''"
                      />
                      <span>{{ activeToolNotice.label }}</span>
                      <span v-if="activeToolNotice.status === 'running'" class="chat-working-dots" aria-hidden="true"
                        ><i /><i /><i
                      /></span>
                    </div>
                  </Transition>
                </div>
              </template>
              <template #actions="{ message }">
                <UTooltip
                  v-if="!message.metadata?.pending && !message.metadata?.cancelled && !message.metadata?.failed"
                  :text="copiedMessageId === message.id ? '已复制' : '复制'"
                >
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    :icon="copiedMessageId === message.id ? 'i-lucide-copy-check' : 'i-lucide-copy'"
                    :aria-label="copiedMessageId === message.id ? '消息已复制' : '复制消息'"
                    :disabled="!getUiMessageText(message)"
                    @click="copyChatMessage(message)"
                  />
                </UTooltip>
              </template>
              <template #indicator>
                <div
                  v-if="
                    !activeToolNotice &&
                    latestToolConfirmation?.status !== 'waiting' &&
                    latestToolInputRequest?.status !== 'waiting'
                  "
                  class="chat-working-indicator"
                  role="status"
                  aria-live="polite"
                >
                  <span>{{ streamStatusLabel || '正在整理回答' }}</span>
                  <span class="chat-working-dots" aria-hidden="true"><i /><i /><i /></span>
                </div>
              </template>
            </UChatMessages>
          </div>

          <Transition name="chat-scroll-button">
            <UButton
              v-if="showBackToLatest"
              type="button"
              color="neutral"
              variant="outline"
              size="sm"
              square
              icon="i-lucide-arrow-down"
              class="absolute bottom-3 right-4 z-20 rounded-full bg-[var(--app-surface)] shadow-md"
              aria-label="回到最新消息"
              title="回到最新消息"
              @click="scrollToLatest"
            />
          </Transition>
        </div>

        <footer
          v-if="!isConversationArchived"
          class="border-t border-default bg-[color-mix(in_srgb,var(--app-surface)_96%,transparent)] px-4 py-3"
        >
          <div v-if="!isModelConfigured" class="mb-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
            请先在设置中配置模型连接。
          </div>
          <div v-if="draftReferences.length" class="mb-2 flex flex-wrap gap-1.5 px-1">
            <span
              v-for="reference in draftReferences"
              :key="`${reference.type}-${reference.id}`"
              class="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/7 py-1 pl-2 pr-1 text-[10px] text-primary"
            >
              <UIcon name="i-lucide-link-2" class="size-3 shrink-0" />
              <span class="max-w-56 truncate">{{ reference.label }}</span>
              <button
                type="button"
                class="flex size-4 shrink-0 items-center justify-center rounded-full text-primary/65 transition-colors hover:bg-primary/12 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                :aria-label="`移除引用 ${reference.label ?? ''}`"
                @click="removeDraftReference(reference.id)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </span>
          </div>
          <UChatPrompt
            v-model="draft"
            :rows="2"
            :maxrows="7"
            autoresize
            :submit-on-enter="true"
            :disabled="isBusy || !isModelConfigured"
            placeholder="输入你的求职问题…"
            variant="outline"
            class="chat-assistant-prompt"
            :ui="{
              root: 'overflow-hidden rounded-[22px] border-default bg-[var(--app-surface)] shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/45 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_8%,transparent)]',
              body: 'min-h-20 px-3.5 pb-1 pt-3 text-sm leading-6',
              footer: 'flex items-center justify-between gap-3 px-2.5 pb-2.5 pt-1',
            }"
            @submit="sendMessage"
          >
            <template #footer>
              <div class="flex min-w-0 items-center gap-1">
                <OpportunityReferencePicker
                  ref="referencePicker"
                  :selected-ids="draftReferences.map((reference) => reference.id)"
                  :excluded-opportunity-id="referenceExcludedOpportunityId"
                  :disabled="isBusy || isConversationArchived"
                  :max="5"
                  @select="addDraftOpportunityReference"
                />
                <span class="truncate text-[10px] text-muted">Enter 发送 · Shift + Enter 换行</span>
              </div>
              <UChatPromptSubmit
                :status="chatUiStatus"
                size="md"
                square
                color="primary"
                variant="solid"
                streaming-color="primary"
                streaming-variant="solid"
                submitted-color="primary"
                submitted-variant="solid"
                :loading="isSending || isCancelling || isPreparingConversation"
                :disabled="isChatSubmitDisabled"
                class="size-9 shrink-0 rounded-full shadow-sm disabled:opacity-80"
                :ui="{
                  base: 'flex size-9 items-center justify-center p-0',
                  leadingIcon: 'm-0 size-4 shrink-0',
                }"
                @stop="stopGeneration"
              />
            </template>
          </UChatPrompt>
        </footer>
      </section>
    </aside>
  </Transition>
</template>

<style scoped>
.chat-resize-handle {
  width: 1.35rem;
  height: 3.75rem;
  cursor: ew-resize;
  touch-action: none;
  border-radius: 0.7rem 0 0 0.7rem;
  transition:
    right 220ms var(--ease-out),
    width 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

.chat-resize-handle:hover,
.chat-resize-handle:focus-visible,
.chat-resize-handle--dragging {
  width: 1.55rem;
  border-color: color-mix(in srgb, var(--ui-primary) 42%, var(--app-border));
  color: var(--ui-primary);
  box-shadow: 0 5px 22px color-mix(in srgb, var(--ui-primary) 16%, transparent);
  outline: none;
}

.chat-resize-handle--closed {
  border-color: color-mix(in srgb, var(--ui-primary) 28%, var(--app-border));
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
  color: var(--ui-primary);
}

.chat-resize-handle--dragging {
  transition: none;
}

.chat-resize-handle__grip {
  width: 0.2rem;
  height: 1.45rem;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.72;
}

.chat-panel-enter-active,
.chat-panel-leave-active {
  transition:
    transform 220ms var(--ease-out),
    opacity 160ms ease;
}

.chat-panel-enter-from,
.chat-panel-leave-to {
  transform: translateX(100%);
  opacity: 0.4;
}

.chat-history-enter-active,
.chat-history-leave-active {
  transition:
    max-height 220ms var(--ease-out),
    opacity 160ms ease,
    transform 220ms var(--ease-out);
  transform-origin: top;
}

.chat-history-enter-from,
.chat-history-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
}

.chat-history-enter-to,
.chat-history-leave-from {
  max-height: 34rem;
  opacity: 1;
  transform: translateY(0);
}

.chat-working-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.75rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.chat-tool-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.5rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.chat-tool-status.is-completed {
  color: color-mix(in srgb, var(--ui-primary) 72%, var(--ui-text-muted));
}

.chat-tool-status.is-failed {
  color: var(--ui-error);
}

.chat-tool-status-enter-active,
.chat-tool-status-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms var(--ease-out);
}

.chat-tool-status-enter-from,
.chat-tool-status-leave-to {
  opacity: 0;
  transform: translateY(3px);
}

.chat-working-dots {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.chat-working-dots i {
  width: 0.2rem;
  height: 0.2rem;
  border-radius: 9999px;
  background: currentColor;
  animation: chat-working-dot 1.15s ease-in-out infinite;
}

.chat-working-dots i:nth-child(2) {
  animation-delay: 120ms;
}

.chat-working-dots i:nth-child(3) {
  animation-delay: 240ms;
}

.chat-message-scroll :deep([data-slot='root'] > article:last-of-type) {
  min-height: 0 !important;
}

.chat-scroll-button-enter-active,
.chat-scroll-button-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms var(--ease-out);
}

.chat-scroll-button-enter-from,
.chat-scroll-button-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.96);
}

.chat-assistant-prompt :deep([data-slot='body']) {
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.chat-assistant-prompt :deep(textarea) {
  border-radius: 0;
  background: transparent !important;
}

@keyframes chat-working-dot {
  0%,
  65%,
  100% {
    opacity: 0.28;
    transform: translateY(0);
  }
  32% {
    opacity: 0.9;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-resize-handle,
  .chat-panel-enter-active,
  .chat-panel-leave-active,
  .chat-history-enter-active,
  .chat-history-leave-active {
    transition-duration: 1ms;
  }
}
</style>
