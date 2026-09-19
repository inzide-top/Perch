import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { getUserErrorMessage } from '@/services/error-presentation'
import { chatApi, getAllChatRunEvents, type ChatBootstrapRunSummary } from '@/services/chat-api'
import { readToolConfirmationRequest, type ChatToolConfirmation } from '@/shared/chat/confirmation'
import { readToolInputRequest, type ChatToolInputRequest } from '@/shared/chat/input-request'
import {
  openChatRunStream,
  type ChatRunEventRecord,
  type ChatRunSnapshot,
  type ChatRunStreamHandle,
} from '@/services/chat-stream'

export type ChatRunConnectionState =
  'idle' | 'connecting' | 'connected' | 'suspending' | 'suspended' | 'completed' | 'failed' | 'aborted'

export type ChatToolActivity = {
  callId: string
  name: string
  status: 'requested' | 'running' | 'completed' | 'failed'
  output?: Record<string, unknown>
  error?: string
  recoverable?: boolean
}

export type UseChatRunStreamOptions = {
  conversationId?: string
  afterSequence?: number
  limit?: number
  reset?: boolean
}

type PersistedChatRunCursor = {
  conversationId: string
  runId: string
  lastSequence: number
}

const activeRunStorageKey = 'agent-seek-employment:chat-active-runs'

function readMessageDelta(event: ChatRunEventRecord) {
  if (event.eventType !== 'message_delta') return ''
  const text = event.payload.text
  return typeof text === 'string' ? text : ''
}

function readToolActivity(event: ChatRunEventRecord) {
  if (
    event.eventType !== 'tool_call_requested' &&
    event.eventType !== 'tool_call_started' &&
    event.eventType !== 'tool_call_completed' &&
    event.eventType !== 'tool_call_failed'
  ) {
    return null
  }

  const callId = event.payload.callId
  const name = event.payload.name
  if (typeof callId !== 'string' || typeof name !== 'string') return null

  if (event.eventType === 'tool_call_requested') return { callId, name, status: 'requested' as const }

  if (event.eventType === 'tool_call_started') return { callId, name, status: 'running' as const }

  if (event.eventType === 'tool_call_completed') {
    const output = event.payload.output
    return {
      callId,
      name,
      status: 'completed' as const,
      ...(output && typeof output === 'object' && !Array.isArray(output)
        ? { output: output as Record<string, unknown> }
        : {}),
    }
  }

  const error = event.payload.error
  return {
    callId,
    name,
    status: 'failed' as const,
    recoverable: event.payload.recoverable === true,
    ...(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? { error: getUserErrorMessage(error, '工具执行失败，请稍后重试。') }
      : {}),
  }
}

function isTerminalStatus(status: ChatRunSnapshot['status']) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function toTerminalConnectionState(status: ChatRunSnapshot['status']): ChatRunConnectionState {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'aborted'
  return 'completed'
}

function isBrowserStorageAvailable() {
  return typeof sessionStorage !== 'undefined'
}

function readPersistedCursors(): Record<string, PersistedChatRunCursor> {
  if (!isBrowserStorageAvailable()) return {}

  try {
    const parsed = JSON.parse(sessionStorage.getItem(activeRunStorageKey) ?? '{}') as Record<
      string,
      Partial<PersistedChatRunCursor>
    >
    if (!parsed || typeof parsed !== 'object') return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([conversationId, cursor]) => {
        if (
          typeof cursor?.conversationId !== 'string' ||
          cursor.conversationId !== conversationId ||
          typeof cursor.runId !== 'string' ||
          typeof cursor.lastSequence !== 'number'
        ) {
          return []
        }

        return [[conversationId, { conversationId, runId: cursor.runId, lastSequence: cursor.lastSequence }]]
      }),
    )
  } catch {
    sessionStorage.removeItem(activeRunStorageKey)
    return {}
  }
}

function readPersistedCursor(conversationId: string): PersistedChatRunCursor | null {
  return readPersistedCursors()[conversationId] ?? null
}

function persistCursor(cursor: PersistedChatRunCursor) {
  if (!isBrowserStorageAvailable()) return
  try {
    const cursors = readPersistedCursors()
    cursors[cursor.conversationId] = cursor
    sessionStorage.setItem(activeRunStorageKey, JSON.stringify(cursors))
  } catch {
    // 存储被浏览器禁用或配额不足时，数据库仍是最终数据源，不阻断聊天流。
  }
}

function clearPersistedCursor(conversationId: string, runId?: string) {
  if (!isBrowserStorageAvailable()) return
  const cursors = readPersistedCursors()
  const current = cursors[conversationId]
  if (!runId || current?.runId === runId) {
    delete cursors[conversationId]
    sessionStorage.setItem(activeRunStorageKey, JSON.stringify(cursors))
  }
}

/**
 * 将 ChatRun 的持久化事件转换成 Vue 可以直接消费的状态。
 * 连接本身仍由 chat-stream.ts 负责，这里只管理生命周期和派生展示数据。
 */
export function useChatRunStream() {
  const snapshot = shallowRef<ChatRunSnapshot | null>(null)
  const events = ref<ChatRunEventRecord[]>([])
  const toolActivities = computed<ChatToolActivity[]>(() => {
    const activities = new Map<string, ChatToolActivity>()
    for (const event of events.value) {
      const activity = readToolActivity(event)
      if (activity) activities.set(activity.callId, activity)
    }
    return [...activities.values()]
  })
  const toolConfirmations = computed<ChatToolConfirmation[]>(() => {
    const confirmations = new Map<string, ChatToolConfirmation>()
    for (const event of events.value) {
      if (event.eventType === 'confirmation_requested') {
        const confirmation = readToolConfirmationRequest(event)
        if (!confirmation) continue
        confirmations.set(confirmation.toolActionId, confirmation)
        continue
      }

      if (event.eventType !== 'confirmation_resolved') continue
      const toolActionId = event.payload.toolActionId
      const decision = event.payload.decision
      if (typeof toolActionId !== 'string' || (decision !== 'approved' && decision !== 'rejected')) continue
      const current = confirmations.get(toolActionId)
      if (current) confirmations.set(toolActionId, { ...current, status: decision })
    }
    return [...confirmations.values()]
  })
  const toolInputRequests = computed<ChatToolInputRequest[]>(() => {
    const requests = new Map<string, ChatToolInputRequest>()
    for (const event of events.value) {
      if (event.eventType === 'input_requested') {
        const request = readToolInputRequest(event)
        if (request) requests.set(request.requestId, request)
        continue
      }
      if (event.eventType !== 'input_received') continue
      const requestId = event.payload.requestId
      if (typeof requestId !== 'string') continue
      const current = requests.get(requestId)
      if (current) requests.set(requestId, { ...current, status: 'submitted' })
    }
    return [...requests.values()]
  })
  const streamingText = ref('')
  const lastSequence = ref(0)
  const connectionState = ref<ChatRunConnectionState>('idle')
  const isRenderingText = ref(false)
  const error = shallowRef<unknown>(null)

  let activeHandle: ChatRunStreamHandle | null = null
  let connectionGeneration = 0
  let activeRunId: string | null = null
  let activeConversationId: string | null = null
  let pendingText = ''
  let hasTextPlaybackStarted = false
  let textFrameId: number | null = null
  let lastTextFrameAt = 0
  let textBufferStartedAt = 0
  let lastDeltaAt = 0
  const seenSequences = new Set<number>()
  const initialBufferChars = 24
  const initialBufferMs = 200
  const phraseBatchMinChars = 2
  const tailCoalesceMs = 100
  const textRenderIntervalMs = 52
  const maxTextBatchSize = 4

  const isActive = computed(
    () =>
      connectionState.value === 'connecting' ||
      connectionState.value === 'connected' ||
      connectionState.value === 'suspending' ||
      isRenderingText.value,
  )

  function getTextBatchSize(backlogLength: number) {
    if (backlogLength >= 96) return maxTextBatchSize
    if (backlogLength >= 36) return 3
    return Math.min(backlogLength, phraseBatchMinChars)
  }

  function flushPendingText() {
    if (textFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(textFrameId)
    }
    textFrameId = null
    if (pendingText) streamingText.value += pendingText
    pendingText = ''
    hasTextPlaybackStarted = false
    isRenderingText.value = false
    lastTextFrameAt = 0
    textBufferStartedAt = 0
    lastDeltaAt = 0
  }

  function discardPendingText() {
    if (textFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(textFrameId)
    }
    textFrameId = null
    pendingText = ''
    hasTextPlaybackStarted = false
    isRenderingText.value = false
    lastTextFrameAt = 0
    textBufferStartedAt = 0
    lastDeltaAt = 0
  }

  function renderPendingTextFrame(timestamp: number) {
    textFrameId = null
    if (!pendingText) {
      isRenderingText.value = false
      lastTextFrameAt = 0
      return
    }

    const bufferAge = timestamp - textBufferStartedAt
    const shouldWaitForInitialBuffer =
      !hasTextPlaybackStarted &&
      connectionState.value === 'connected' &&
      pendingText.length < initialBufferChars &&
      bufferAge < initialBufferMs
    if (shouldWaitForInitialBuffer) {
      schedulePendingTextRender()
      return
    }
    hasTextPlaybackStarted = true

    if (lastTextFrameAt > 0 && timestamp - lastTextFrameAt < textRenderIntervalMs) {
      schedulePendingTextRender()
      return
    }

    // 播放开始后以 2～4 个字符的小节奏输出；不足 2 个字符的尾包只短暂等待下一次网络 delta。
    if (
      connectionState.value === 'connected' &&
      pendingText.length < phraseBatchMinChars &&
      timestamp - lastDeltaAt < tailCoalesceMs
    ) {
      schedulePendingTextRender()
      return
    }

    const batchSize = getTextBatchSize(pendingText.length)
    streamingText.value += pendingText.slice(0, batchSize)
    pendingText = pendingText.slice(batchSize)
    lastTextFrameAt = timestamp

    if (!pendingText) {
      isRenderingText.value = false
      lastTextFrameAt = 0
      return
    }

    schedulePendingTextRender()
  }

  function schedulePendingTextRender() {
    if (!pendingText || textFrameId !== null) return
    isRenderingText.value = true
    if (typeof requestAnimationFrame === 'undefined') {
      flushPendingText()
      return
    }

    textFrameId = requestAnimationFrame(renderPendingTextFrame)
  }

  function clearState(afterSequence = 0) {
    pendingText = ''
    if (textFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(textFrameId)
    }
    textFrameId = null
    isRenderingText.value = false
    hasTextPlaybackStarted = false
    lastTextFrameAt = 0
    textBufferStartedAt = 0
    lastDeltaAt = 0
    snapshot.value = null
    events.value = []
    streamingText.value = ''
    lastSequence.value = afterSequence
    error.value = null
    seenSequences.clear()
  }

  function clearActiveRunCursor() {
    if (activeConversationId) clearPersistedCursor(activeConversationId, activeRunId ?? undefined)
  }

  function hydrateHistoricalEvents(history: ChatRunEventRecord[]) {
    const sortedHistory = [...history].sort((left, right) => left.sequence - right.sequence)
    events.value = sortedHistory
    seenSequences.clear()
    sortedHistory.forEach((event) => seenSequences.add(event.sequence))
    lastSequence.value = sortedHistory.at(-1)?.sequence ?? 0
    streamingText.value = sortedHistory.map(readMessageDelta).join('')
    pendingText = ''
    isRenderingText.value = false
    hasTextPlaybackStarted = false
    lastTextFrameAt = 0
    textBufferStartedAt = 0
    lastDeltaAt = 0
  }

  function applyEvent(event: ChatRunEventRecord) {
    if (seenSequences.has(event.sequence)) return false

    seenSequences.add(event.sequence)
    events.value.push(event)
    lastSequence.value = event.sequence
    const delta = readMessageDelta(event)
    if (delta) {
      const now = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (!pendingText) textBufferStartedAt = now
      pendingText += delta
      lastDeltaAt = now
      schedulePendingTextRender()
    }
    return true
  }

  function applyEventStateToSnapshot(event: ChatRunEventRecord) {
    const current = snapshot.value
    if (!current) return

    const base =
      event.stateRevision > current.revision
        ? { ...current, revision: event.stateRevision, updatedAt: event.createdAt }
        : current
    if (event.eventType === 'confirmation_requested') {
      snapshot.value = { ...base, status: 'waiting_confirmation', phase: null }
      return
    }
    if (event.eventType === 'input_requested') {
      snapshot.value = { ...base, status: 'waiting_input', phase: null }
      return
    }
    if (event.eventType === 'input_received') {
      snapshot.value = { ...base, status: 'queued', phase: null }
      return
    }
    if (event.eventType === 'confirmation_resolved') {
      snapshot.value = { ...base, status: 'queued', phase: null }
      return
    }
    if (event.eventType === 'run_started') {
      snapshot.value = { ...base, status: 'running', phase: 'initializing' }
      return
    }
    if (event.eventType === 'tool_call_started') {
      snapshot.value = { ...base, status: 'running', phase: 'executing_tool' }
      return
    }
    if (event.eventType === 'tool_call_completed') {
      snapshot.value = { ...base, status: 'running', phase: 'calling_model' }
      return
    }
    if (event.eventType === 'tool_call_failed' && event.payload.recoverable === true) {
      snapshot.value = { ...base, status: 'running', phase: 'calling_model' }
      return
    }
    snapshot.value = base
  }

  function stop(markAborted = true) {
    // 用户停止时冻结屏幕上已经播放的文字，未播放的缓冲区不能突然整段跳出来。
    discardPendingText()
    connectionGeneration += 1
    activeHandle?.abort()
    activeHandle = null
    if (markAborted && isActive.value) connectionState.value = 'aborted'
  }

  /**
   * 用户开始处理确认卡片时，让等待确认阶段遗留的 history 回读立即失效。
   * 保留现有事件、文字和确认卡，只把页面维持在进行中，直到 Command 给出权威结果。
   */
  function beginConfirmationCommand() {
    connectionGeneration += 1
    activeHandle?.abort()
    activeHandle = null
    connectionState.value = 'suspending'
    error.value = null
  }

  function connect(runId: string, options: UseChatRunStreamOptions = {}) {
    stop(false)

    const initialSequence = options.afterSequence ?? lastSequence.value
    if (options.reset || (activeRunId !== null && activeRunId !== runId)) clearState(initialSequence)
    activeRunId = runId
    activeConversationId = options.conversationId ?? activeConversationId
    if (activeConversationId)
      persistCursor({ conversationId: activeConversationId, runId, lastSequence: initialSequence })

    const generation = ++connectionGeneration
    connectionState.value = 'connecting'
    error.value = null

    const handle = openChatRunStream(runId, {
      afterSequence: initialSequence,
      limit: options.limit,
      onSnapshot: (nextSnapshot) => {
        if (generation !== connectionGeneration) return
        snapshot.value = nextSnapshot
        connectionState.value = 'connected'
      },
      onRunEvent: (event) => {
        if (generation !== connectionGeneration) return
        if (!applyEvent(event)) return
        applyEventStateToSnapshot(event)
        if (activeConversationId) {
          persistCursor({ conversationId: activeConversationId, runId, lastSequence: event.sequence })
        }
      },
      onComplete: (payload) => {
        if (generation !== connectionGeneration) return
        snapshot.value = snapshot.value ? { ...snapshot.value, status: payload.status } : snapshot.value
        connectionState.value = toTerminalConnectionState(payload.status)
        if (activeConversationId) clearPersistedCursor(activeConversationId, runId)
      },
      onSuspended: (payload) => {
        if (generation !== connectionGeneration) return
        snapshot.value = snapshot.value ? { ...snapshot.value, status: payload.status, phase: null } : snapshot.value
        // HTTP 流可以在等待确认时断开，但 UI 要先用持久化事件做一次最终对齐。
        // 在对齐完成前保持 active，避免助手消息和确认卡片瞬间消失。
        connectionState.value = 'suspending'
        void settleSuspendedRun(runId, generation, payload.status)
      },
      onError: (nextError) => {
        if (generation !== connectionGeneration) return
        error.value = nextError
        connectionState.value = 'failed'
      },
    })

    activeHandle = handle
    void handle.done
      .catch(() => undefined)
      .finally(() => {
        if (generation !== connectionGeneration) return
        activeHandle = null
        if (connectionState.value === 'connected' && snapshot.value && isTerminalStatus(snapshot.value.status)) {
          connectionState.value = toTerminalConnectionState(snapshot.value.status)
        }
      })

    return handle
  }

  async function settleSuspendedRun(
    runId: string,
    generation: number,
    status: Extract<ChatRunSnapshot['status'], 'waiting_input' | 'waiting_confirmation'>,
  ) {
    try {
      const history = await getAllChatRunEvents(runId)
      if (generation !== connectionGeneration || activeRunId !== runId) return

      // SSE 通常已经送达 input_requested 或 confirmation_requested；这次回读是传输边界的保险对齐，
      // 确保“最后一个事件”和“关闭 HTTP 流”不会在前端产生竞态。
      hydrateHistoricalEvents(history)
      snapshot.value = snapshot.value ? { ...snapshot.value, status, phase: null } : snapshot.value
      if (activeConversationId) {
        persistCursor({ conversationId: activeConversationId, runId, lastSequence: lastSequence.value })
      }
    } catch (nextError) {
      if (generation !== connectionGeneration || activeRunId !== runId) return
      // 回读失败时仍保留 SSE 已收到的事件；等待确认不能被误判为 Run 失败。
      if (
        !toolConfirmations.value.some((confirmation) => confirmation.status === 'waiting') &&
        !toolInputRequests.value.some((request) => request.status === 'waiting')
      ) {
        error.value = nextError
      }
    } finally {
      if (generation === connectionGeneration && activeRunId === runId) {
        connectionState.value = 'suspended'
      }
    }
  }

  async function resumeRun(
    runId: string,
    expectedConversationId?: string,
    prefetchedRun: ChatBootstrapRunSummary | null = null,
  ) {
    try {
      const [run, history] = await Promise.all([
        prefetchedRun?.id === runId ? Promise.resolve(prefetchedRun) : chatApi.getRun(runId),
        getAllChatRunEvents(runId),
      ])

      if (expectedConversationId && run.conversationId !== expectedConversationId) return false

      stop(false)
      clearState(0)
      activeRunId = run.id
      activeConversationId = run.conversationId
      snapshot.value = run
      // 历史事件直接还原为已有内容；只有重连后新到达的 delta 才播放打字机动画。
      hydrateHistoricalEvents(history)

      if (isTerminalStatus(run.status)) {
        connectionState.value = toTerminalConnectionState(run.status)
        // cancelled 消息已经由会话接口按 visibleTextLength 持久化；不能再把完整事件历史当成第二条临时回答展示。
        if (run.status === 'cancelled') streamingText.value = ''
        clearPersistedCursor(run.conversationId, run.id)
        return true
      }

      if (run.status === 'waiting_input' || run.status === 'waiting_confirmation') {
        // 表单或确认卡片已经从持久化事件恢复；等待用户期间不维持无意义的长连接。
        connectionState.value = 'suspended'
        persistCursor({ conversationId: run.conversationId, runId: run.id, lastSequence: lastSequence.value })
        return true
      }

      connect(run.id, { afterSequence: lastSequence.value, conversationId: run.conversationId })
      return true
    } catch (nextError) {
      error.value = nextError
      connectionState.value = 'failed'
      return false
    }
  }

  async function resumeFromStorage(expectedConversationId?: string) {
    const persisted = expectedConversationId ? readPersistedCursor(expectedConversationId) : null
    if (!persisted) return false

    return resumeRun(persisted.runId, expectedConversationId)
  }

  function discardPersistedRun(conversationId: string) {
    clearPersistedCursor(conversationId)
  }

  onBeforeUnmount(() => stop(false))

  return {
    snapshot,
    events,
    toolActivities,
    toolInputRequests,
    toolConfirmations,
    streamingText,
    lastSequence,
    connectionState,
    isActive,
    isRenderingText,
    error,
    connect,
    resumeRun,
    resumeFromStorage,
    discardPersistedRun,
    beginConfirmationCommand,
    stop,
    clearState,
    clearActiveRunCursor,
  }
}
