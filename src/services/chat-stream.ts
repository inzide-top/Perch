import type { ChatRunEventType, ChatRunPhase, ChatRunStatus } from '@/shared/chat/schemas'
import { parseChatSseFrame, parseChatSseFrames, type ChatSseFrame } from '@/shared/chat/sse'
import { appAuthMode } from './auth/auth-mode'
import { getAuthAccessToken, invalidateAuthSession, refreshAuthAccessToken } from './auth/supabase-client'
import { ApiRequestError, toApiUrl } from './http'

export type ChatRunSnapshot = {
  id: string
  status: ChatRunStatus
  phase: ChatRunPhase | null
  revision: number
  outputMessageId: string | null
  error: unknown
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type ChatRunEventRecord = {
  id: string
  runId: string
  sequence: number
  eventType: ChatRunEventType
  stateRevision: number
  payload: Record<string, unknown>
  createdAt: string
}

export type ChatRunStreamHandlers = {
  onSnapshot?: (snapshot: ChatRunSnapshot) => void
  onRunEvent?: (event: ChatRunEventRecord) => void
  onComplete?: (payload: { runId: string; status: ChatRunStatus }) => void
  onSuspended?: (payload: { runId: string; status: 'waiting_input' | 'waiting_confirmation' }) => void
  onKeepalive?: (payload: { runId: string }) => void
  onUnknownEvent?: (frame: ChatSseFrame) => void
  onError?: (error: unknown) => void
}

export type OpenChatRunStreamOptions = ChatRunStreamHandlers & {
  afterSequence?: number
  limit?: number
  signal?: AbortSignal
}

export type ChatRunStreamHandle = {
  abort: (reason?: string) => void
  done: Promise<void>
  getLastSequence: () => number
}

type ChatRunEventPayload = { runId: string; event: ChatRunEventRecord }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFramePayload(frame: ChatSseFrame): unknown {
  try {
    return JSON.parse(frame.data) as unknown
  } catch {
    throw new Error(`聊天流事件 ${frame.event} 的 data 不是合法 JSON`)
  }
}

function assertRunEventPayload(payload: unknown): ChatRunEventPayload {
  if (!isRecord(payload) || typeof payload.runId !== 'string' || !isRecord(payload.event)) {
    throw new Error('聊天流事件缺少 runId 或 event')
  }

  const event = payload.event
  if (
    typeof event.id !== 'string' ||
    typeof event.runId !== 'string' ||
    typeof event.sequence !== 'number' ||
    typeof event.eventType !== 'string' ||
    typeof event.stateRevision !== 'number' ||
    !isRecord(event.payload) ||
    typeof event.createdAt !== 'string'
  ) {
    throw new Error('聊天流事件的 event 结构不完整')
  }

  return {
    runId: payload.runId,
    event: event as unknown as ChatRunEventRecord,
  }
}

function createAbortError() {
  return new DOMException('聊天流已取消', 'AbortError')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function readErrorMessage(response: Response) {
  const data = (await response.json().catch(() => null)) as { message?: string } | null
  return data?.message ?? `聊天流连接失败：${response.status}`
}

/**
 * 建立一个可取消、可从 afterSequence 续接的 Fetch Stream 连接。
 * 这里不负责渲染 UI，只负责把后端 SSE 事件安全地分发给调用方。
 */
export function openChatRunStream(runId: string, options: OpenChatRunStreamOptions = {}): ChatRunStreamHandle {
  const controller = new AbortController()
  const initialSequence = options.afterSequence ?? 0
  let lastSequence = initialSequence

  const abortFromCaller = () => controller.abort(options.signal?.reason)
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason)
    } else {
      options.signal.addEventListener('abort', abortFromCaller, { once: true })
    }
  }

  const done = consumeChatRunStream(
    runId,
    controller.signal,
    options,
    () => lastSequence,
    (sequence) => {
      lastSequence = sequence
    },
  )
    .catch((error: unknown) => {
      if (!isAbortError(error)) {
        options.onError?.(error)
        throw error
      }
    })
    .finally(() => {
      options.signal?.removeEventListener('abort', abortFromCaller)
    })

  return {
    abort: (reason) => controller.abort(reason ?? createAbortError().message),
    done,
    getLastSequence: () => lastSequence,
  }
}

async function consumeChatRunStream(
  runId: string,
  signal: AbortSignal,
  options: OpenChatRunStreamOptions,
  getLastSequence: () => number,
  setLastSequence: (sequence: number) => void,
) {
  const query = new URLSearchParams({
    afterSequence: String(getLastSequence()),
    limit: String(options.limit ?? 200),
  })
  const streamUrl = `${toApiUrl(`/chat/runs/${encodeURIComponent(runId)}/stream`)}?${query.toString()}`
  const response = await openAuthenticatedStream(streamUrl, signal)

  if (!response.ok) {
    throw new ApiRequestError(await readErrorMessage(response), response.status)
  }
  if (!response.body) {
    throw new Error('聊天流响应没有可读取的 body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

      const parsed = parseChatSseFrames(buffer)
      buffer = parsed.remainder
      for (const frame of parsed.frames) {
        dispatchChatSseFrame(frame, options, setLastSequence)
      }

      if (done) {
        const trailingFrame = parseChatSseFrame(buffer)
        if (trailingFrame) dispatchChatSseFrame(trailingFrame, options, setLastSequence)
        return
      }

      if (signal.aborted) throw createAbortError()
    }
  } finally {
    reader.releaseLock()
  }
}

async function openAuthenticatedStream(url: string, signal: AbortSignal) {
  const headers = new Headers({ accept: 'text/event-stream' })
  const accessToken = await getAuthAccessToken()
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)

  const response = await fetch(url, { method: 'GET', headers, signal })
  if (response.status !== 401 || appAuthMode !== 'supabase') return response

  const refreshedToken = await refreshAuthAccessToken()
  if (!refreshedToken) return response

  headers.set('authorization', `Bearer ${refreshedToken}`)
  const retriedResponse = await fetch(url, { method: 'GET', headers, signal })
  if (retriedResponse.status === 401) await invalidateAuthSession()
  return retriedResponse
}

function dispatchChatSseFrame(
  frame: ChatSseFrame,
  options: OpenChatRunStreamOptions,
  setLastSequence: (sequence: number) => void,
) {
  const payload = parseFramePayload(frame)

  switch (frame.event) {
    case 'chat.run_snapshot':
      options.onSnapshot?.(payload as ChatRunSnapshot)
      return
    case 'chat.run_event': {
      const eventPayload = assertRunEventPayload(payload)
      setLastSequence(eventPayload.event.sequence)
      options.onRunEvent?.(eventPayload.event)
      return
    }
    case 'chat.run_complete':
      if (!isRecord(payload) || typeof payload.runId !== 'string' || typeof payload.status !== 'string') {
        throw new Error('聊天流完成事件结构不完整')
      }
      options.onComplete?.(payload as { runId: string; status: ChatRunStatus })
      return
    case 'chat.run_suspended':
      if (
        !isRecord(payload) ||
        typeof payload.runId !== 'string' ||
        (payload.status !== 'waiting_input' && payload.status !== 'waiting_confirmation')
      ) {
        throw new Error('聊天流暂停事件结构不完整')
      }
      options.onSuspended?.(payload as { runId: string; status: 'waiting_input' | 'waiting_confirmation' })
      return
    case 'chat.keepalive':
      if (!isRecord(payload) || typeof payload.runId !== 'string') {
        throw new Error('聊天流心跳事件结构不完整')
      }
      options.onKeepalive?.(payload as { runId: string })
      return
    case 'chat.run_error':
      if (!isRecord(payload) || typeof payload.message !== 'string') {
        throw new Error('聊天流错误事件结构不完整')
      }
      throw new Error(payload.message)
    default:
      options.onUnknownEvent?.(frame)
  }
}
