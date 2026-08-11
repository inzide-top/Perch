import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import {
  chatApi,
  type ChatConversationRecord,
  type ChatMessageRecord,
  type ChatTurnResult,
  type ChatToolActionRecord,
  type SendChatMessageOptions,
} from '@/services/chat-api'
import { useChatRunStream } from './useChatRunStream'
import type { LlmConnectionSettings } from '@/types/settings'
import type { ChatMessageReference } from '@/shared/chat/schemas'

type PendingChatSubmission = {
  conversationId: string
  text: string
  references: ChatMessageReference[]
  submittedAt: string
}

export type ChatConversationRecoveryResult =
  | { status: 'none' | 'resumed' | 'settled' }
  | {
      status: 'not_accepted'
      draftText: string
      references: ChatMessageReference[]
      submittedAt: string
    }

const pendingChatSubmissionStorageKey = 'agent-seek-employment:chat-pending-submissions'
const recoveryPollDelays = [0, 250, 500, 750]

function isTerminalRunStatus(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function readPendingSubmissions(): Record<string, PendingChatSubmission> {
  if (typeof sessionStorage === 'undefined') return {}

  try {
    const parsed = JSON.parse(sessionStorage.getItem(pendingChatSubmissionStorageKey) ?? '{}') as Record<
      string,
      Partial<PendingChatSubmission>
    >
    if (!parsed || typeof parsed !== 'object') return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([conversationId, submission]) => {
        if (
          submission?.conversationId !== conversationId ||
          typeof submission.text !== 'string' ||
          typeof submission.submittedAt !== 'string' ||
          !Array.isArray(submission.references)
        ) {
          return []
        }
        return [[conversationId, submission as PendingChatSubmission]]
      }),
    )
  } catch {
    sessionStorage.removeItem(pendingChatSubmissionStorageKey)
    return {}
  }
}

function readPendingSubmission(conversationId: string) {
  return readPendingSubmissions()[conversationId] ?? null
}

function persistPendingSubmission(submission: PendingChatSubmission) {
  if (typeof sessionStorage === 'undefined') return

  try {
    const submissions = readPendingSubmissions()
    submissions[submission.conversationId] = submission
    sessionStorage.setItem(pendingChatSubmissionStorageKey, JSON.stringify(submissions))
  } catch {
    // 浏览器禁用存储时仍可正常发送，只是不提供刷新窗口内的乐观消息恢复。
  }
}

function clearPendingSubmission(conversationId: string) {
  if (typeof sessionStorage === 'undefined') return

  const submissions = readPendingSubmissions()
  delete submissions[conversationId]
  sessionStorage.setItem(pendingChatSubmissionStorageKey, JSON.stringify(submissions))
}

function getMessageText(message: ChatMessageRecord) {
  return message.parts
    .filter((part): part is Extract<ChatMessageRecord['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

/**
 * 会话级状态：负责加载消息、提交用户消息，以及把一次提交绑定到对应 ChatRun。
 * 流式事件的解析和断点恢复仍由 useChatRunStream 负责。
 */
export function useChatConversation() {
  const conversation = shallowRef<ChatConversationRecord | null>(null)
  const messages = ref<ChatMessageRecord[]>([])
  const toolActions = ref<ChatToolActionRecord[]>([])
  const isLoading = ref(false)
  const isSending = ref(false)
  const isCancelling = ref(false)
  const isFinalizing = ref(false)
  const confirmingToolActionId = ref<string | null>(null)
  const confirmingToolDecision = ref<'approved' | 'rejected' | null>(null)
  const submittingInputRequestId = ref<string | null>(null)
  const error = shallowRef<unknown>(null)
  const stream = useChatRunStream()

  const activeRun = computed(() => stream.snapshot.value)
  const streamingAssistantText = computed(() => stream.streamingText.value)

  async function reloadMessages() {
    if (!conversation.value) return null
    const result = await chatApi.getConversation(conversation.value.id)
    conversation.value = result.conversation
    messages.value = result.messages
    toolActions.value = result.toolActions
    return result
  }

  async function open(conversationId: string) {
    isLoading.value = true
    error.value = null

    try {
      stream.stop()
      stream.clearState()
      const result = await chatApi.getConversation(conversationId)
      conversation.value = result.conversation
      messages.value = result.messages
      toolActions.value = result.toolActions
      return result
    } catch (nextError) {
      error.value = nextError
      throw nextError
    } finally {
      isLoading.value = false
    }
  }

  function clear() {
    stream.stop()
    stream.clearState()
    conversation.value = null
    messages.value = []
    toolActions.value = []
    error.value = null
  }

  async function create(input: { title: string; scopeType: 'global' | 'opportunity'; opportunityId?: string | null }) {
    isLoading.value = true
    error.value = null

    try {
      const created = await chatApi.createConversation(input)
      conversation.value = created
      messages.value = []
      toolActions.value = []
      stream.clearState()
      return created
    } catch (nextError) {
      error.value = nextError
      throw nextError
    } finally {
      isLoading.value = false
    }
  }

  async function send(input: SendChatMessageOptions): Promise<ChatTurnResult> {
    if (!conversation.value) throw new Error('请先打开或创建一个聊天会话')
    if (isSending.value || stream.isActive.value) throw new Error('当前会话仍有任务正在执行')

    isSending.value = true
    error.value = null

    try {
      // 上一轮由用户停止时，先确认后端已经保存半成品回答；否则 clearState 会把仅存在于前端的文字清掉。
      if (stream.connectionState.value === 'aborted' && activeRun.value) {
        const previousRun = await chatApi.getRun(activeRun.value.id)
        if (!isTerminalRunStatus(previousRun.status)) {
          throw new Error('上一条回答仍在完成停止操作，请稍后再发送')
        }
        await reloadMessages()
        stream.clearActiveRunCursor()
      }

      // 数据库消息已经同步后再清掉上一轮流状态，避免半成品回答在发送新消息时消失。
      stream.clearState()
      const pendingSubmission = {
        conversationId: conversation.value.id,
        text: input.text,
        references: input.references ?? [],
        submittedAt: new Date().toISOString(),
      }
      persistPendingSubmission(pendingSubmission)

      const result = await chatApi.sendMessage(conversation.value.id, input)
      if (!messages.value.some((message) => message.id === result.message.id)) {
        messages.value.push(result.message)
      }

      stream.connect(result.run.id, { reset: true, conversationId: conversation.value.id })
      clearPendingSubmission(conversation.value.id)
      return result
    } catch (nextError) {
      error.value = nextError
      throw nextError
    } finally {
      isSending.value = false
    }
  }

  function getPendingSubmission() {
    return conversation.value ? readPendingSubmission(conversation.value.id) : null
  }

  function discardPendingSubmission() {
    if (conversation.value) clearPendingSubmission(conversation.value.id)
  }

  async function recoverAfterOpen(): Promise<ChatConversationRecoveryResult> {
    const currentConversation = conversation.value
    if (!currentConversation) return { status: 'none' }

    if (await stream.resumeFromStorage(currentConversation.id)) {
      clearPendingSubmission(currentConversation.id)
      return { status: 'resumed' }
    }

    // 浏览器没有 Run cursor 时（例如换了标签页或 sessionStorage 被清理），
    // 数据库中的 waiting_input / waiting_confirmation ToolAction 仍是权威的恢复依据。
    const waitingToolAction = [...toolActions.value]
      .reverse()
      .find((toolAction) => toolAction.status === 'waiting_input' || toolAction.status === 'waiting_confirmation')
    if (waitingToolAction && (await stream.resumeRun(waitingToolAction.runId, currentConversation.id))) {
      clearPendingSubmission(currentConversation.id)
      return { status: 'resumed' }
    }

    const pendingSubmission = readPendingSubmission(currentConversation.id)

    for (const delay of recoveryPollDelays) {
      if (delay > 0) {
        await sleep(delay)
        await reloadMessages()
      }

      const latestUserMessage = [...messages.value]
        .reverse()
        .find((message) => message.role === 'user' && message.chatRunId)
      if (!latestUserMessage?.chatRunId) {
        if (!pendingSubmission) return { status: 'none' }
        continue
      }

      const run = await chatApi.getRun(latestUserMessage.chatRunId)
      if (run.conversationId !== currentConversation.id) continue

      const isActiveRun = !['completed', 'failed', 'cancelled'].includes(run.status)
      const pendingWasAccepted =
        pendingSubmission !== null &&
        getMessageText(latestUserMessage) === pendingSubmission.text &&
        new Date(latestUserMessage.createdAt).getTime() >= new Date(pendingSubmission.submittedAt).getTime() - 5_000

      if (!isActiveRun && !pendingWasAccepted) break

      clearPendingSubmission(currentConversation.id)
      if (!isActiveRun) return { status: 'settled' }

      await stream.resumeRun(run.id, currentConversation.id)
      return { status: 'resumed' }
    }

    if (!pendingSubmission) return { status: 'none' }

    clearPendingSubmission(currentConversation.id)
    return {
      status: 'not_accepted',
      draftText: pendingSubmission.text,
      references: pendingSubmission.references,
      submittedAt: pendingSubmission.submittedAt,
    }
  }

  async function cancel(
    reason:
      | 'user_requested'
      | 'interview_schedule_input_cancelled'
      | 'mock_interview_input_cancelled'
      | 'review_input_cancelled'
      | 'opportunity_target_cancelled'
      | 'resume_target_cancelled' = 'user_requested',
  ) {
    const run = activeRun.value
    if (!conversation.value || !run || isTerminalRunStatus(run.status) || isCancelling.value) return

    isCancelling.value = true
    error.value = null
    const conversationId = conversation.value.id
    const visibleTextLength = stream.streamingText.value.length
    // 用户点击后立即停掉浏览器消费和打字机队列；后端取消命令并行完成真实模型中止。
    stream.stop()
    try {
      await chatApi.submitCommand(run.id, {
        type: 'cancel_run',
        expectedRevision: run.revision,
        payload: { reason, visibleTextLength },
      })

      // cancel_run 只有在 Worker 完成取消落库后才返回；这里再读取一次服务端事实，避免 UI 提前宣告成功。
      const settledRun = await chatApi.getRun(run.id)
      if (!isTerminalRunStatus(settledRun.status)) {
        throw new Error('停止操作尚未完成，请稍后重试')
      }
      await reloadMessages()
      stream.clearActiveRunCursor()
      stream.clearState()
    } catch (nextError) {
      // 请求响应和最后一次状态写入可能恰好交错；终态已经落库时仍按成功收口，不能复活旧 Run。
      const settledRun = await chatApi.getRun(run.id).catch(() => null)
      if (settledRun && isTerminalRunStatus(settledRun.status)) {
        await reloadMessages()
        stream.clearActiveRunCursor()
        stream.clearState()
        return
      }

      error.value = nextError
      // 后端没有接受取消时，恢复原 Run，不能让页面假装模型已经停止。
      await stream.resumeRun(run.id, conversationId)
      throw nextError
    } finally {
      isCancelling.value = false
    }
  }

  async function confirmToolAction(
    toolActionId: string,
    decision: 'approved' | 'rejected',
    modelConnection: LlmConnectionSettings,
  ) {
    const run = activeRun.value
    if (!run || run.status !== 'waiting_confirmation') {
      throw new Error('当前任务已不处于等待确认状态')
    }
    if (!conversation.value) throw new Error('当前聊天会话不存在')
    if (confirmingToolActionId.value) return

    confirmingToolActionId.value = toolActionId
    confirmingToolDecision.value = decision
    error.value = null
    const conversationId = conversation.value.id
    // 用户点击后先废弃等待确认阶段遗留的 history 回读，但保留当前文字和确认卡。
    stream.beginConfirmationCommand()
    try {
      // 等待确认期间数据库是权威状态。提交前重新读取 revision，避免前端快照晚一拍导致 409。
      const latestRun = await chatApi.getRun(run.id)
      if (latestRun.status !== 'waiting_confirmation') {
        throw new Error('当前任务已不处于等待确认状态')
      }

      const result = await chatApi.submitCommand(run.id, {
        type: 'confirm_tool',
        expectedRevision: latestRun.revision,
        payload: { toolActionId, decision },
        modelConnection,
      })
      // 确认事件已经落库后立即按同一个 Run 重建流状态，避免按钮在 SSE 下一轮轮询前短暂恢复可点。
      await stream.resumeRun(run.id, conversationId)
      return result
    } catch (nextError) {
      // 网络错误可能发生在服务端已经接受 Command 之后；先恢复服务端事实，再决定是否向用户报错。
      const recovered = await stream.resumeRun(run.id, conversationId)
      if (recovered && stream.snapshot.value?.status !== 'waiting_confirmation') return
      error.value = nextError
      throw nextError
    } finally {
      confirmingToolActionId.value = null
      confirmingToolDecision.value = null
    }
  }

  async function provideToolInput(requestId: string, value: unknown, modelConnection: LlmConnectionSettings) {
    const run = activeRun.value
    if (!run || run.status !== 'waiting_input') throw new Error('当前任务已不处于等待补充信息状态')
    if (!conversation.value) throw new Error('当前聊天会话不存在')
    if (submittingInputRequestId.value) return

    submittingInputRequestId.value = requestId
    error.value = null
    const conversationId = conversation.value.id
    stream.beginConfirmationCommand()
    try {
      const latestRun = await chatApi.getRun(run.id)
      if (latestRun.status !== 'waiting_input') throw new Error('当前任务已不处于等待补充信息状态')

      const result = await chatApi.submitCommand(run.id, {
        type: 'provide_input',
        expectedRevision: latestRun.revision,
        payload: { requestId, value },
        modelConnection,
      })
      await stream.resumeRun(run.id, conversationId)
      return result
    } catch (nextError) {
      const recovered = await stream.resumeRun(run.id, conversationId)
      if (recovered && stream.snapshot.value?.status !== 'waiting_input') return
      error.value = nextError
      throw nextError
    } finally {
      submittingInputRequestId.value = null
    }
  }

  function stop() {
    stream.stop()
  }

  watch([() => stream.connectionState.value, () => stream.isRenderingText.value], ([state, isRendering]) => {
    if (!['completed', 'failed'].includes(state) || isRendering || !conversation.value || isFinalizing.value) return

    isFinalizing.value = true
    void reloadMessages()
      .catch((nextError) => {
        error.value = nextError
      })
      .finally(() => {
        isFinalizing.value = false
      })
  })

  onBeforeUnmount(stop)

  return {
    conversation,
    messages,
    toolActions,
    isLoading,
    isSending,
    isCancelling,
    isFinalizing,
    confirmingToolActionId,
    confirmingToolDecision,
    submittingInputRequestId,
    error,
    activeRun,
    streamingAssistantText,
    stream,
    open,
    clear,
    create,
    send,
    reloadMessages,
    recoverAfterOpen,
    getPendingSubmission,
    discardPendingSubmission,
    stop,
    cancel,
    confirmToolAction,
    provideToolInput,
  }
}
