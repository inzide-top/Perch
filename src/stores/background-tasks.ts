import { defineStore } from 'pinia'
import { backgroundTaskApi, type BackgroundTaskReference, type BackgroundTaskStatus } from '@/services/background-tasks'
import type { AnswerDeepEvaluationResult } from '@/shared/interview/schemas'
import type { AgentRunStatus, JobAnalysisProgress } from '@/types/opportunity'

export type BackgroundTaskEntry = BackgroundTaskReference & {
  key: string
  displayContext: BackgroundTaskDisplayContext | null
  status: AgentRunStatus | 'missing'
  analysis: JobAnalysisProgress | null
  evaluation: {
    result: AnswerDeepEvaluationResult | null
    error: unknown
    updatedAt: string | null
    completedAt: string | null
  } | null
  strategy: {
    error: unknown
    updatedAt: string | null
    completedAt: string | null
  } | null
  updatedAt: string | null
}

export type BackgroundTaskDisplayContext = {
  primary: string
  secondary?: string
}

export type BackgroundTaskTerminalEvent = {
  id: string
  task: BackgroundTaskEntry
}

type BackgroundTaskState = {
  tasksByKey: Record<string, BackgroundTaskEntry>
  reservedTaskKeys: string[]
  isPolling: boolean
  lastPolledAt: string | null
}

export type BackgroundTaskUpdateKind = 'updated' | 'completed' | 'failed'
type BackgroundTaskListener = (task: BackgroundTaskEntry, kind: BackgroundTaskUpdateKind) => void

const storageKey = 'agent-seek-employment:background-tasks'
const listeners = new Set<BackgroundTaskListener>()
export const backgroundTaskClientLimits = {
  job_analysis: 5,
  answer_deep_evaluation: 5,
  action_strategy: 1,
  total: 10,
} as const
let pollingPromise: Promise<void> | null = null
let pollingTimer: number | null = null
let visibilityHandler: (() => void) | null = null

function taskKey(reference: BackgroundTaskReference) {
  return reference.type === 'job_analysis'
    ? `job_analysis:${reference.opportunityId}`
    : reference.type === 'answer_deep_evaluation'
      ? `answer_deep_evaluation:${reference.sessionId}:${reference.turnId}`
      : `action_strategy:${reference.snapshotId}`
}

function isActive(status: BackgroundTaskEntry['status']) {
  return status === 'pending' || status === 'processing'
}

function isHidden() {
  return typeof document !== 'undefined' && document.hidden
}

function nextDelay() {
  return isHidden() ? 30_000 : 5_000
}

function notify(task: BackgroundTaskEntry, kind: BackgroundTaskUpdateKind) {
  listeners.forEach((listener) => listener(task, kind))
}

function toEntry(status: BackgroundTaskStatus, previous?: BackgroundTaskEntry): BackgroundTaskEntry {
  if (status.type === 'job_analysis') {
    return {
      type: status.type,
      opportunityId: status.opportunityId,
      key: taskKey(status),
      displayContext: previous?.displayContext ?? null,
      status: status.analysis?.status ?? 'missing',
      analysis: status.analysis,
      evaluation: null,
      strategy: null,
      updatedAt: status.analysis?.updatedAt ?? null,
    }
  }

  if (status.type === 'answer_deep_evaluation') {
    return {
      type: status.type,
      sessionId: status.sessionId,
      turnId: status.turnId,
      key: taskKey(status),
      displayContext: previous?.displayContext ?? null,
      status: status.evaluation?.status ?? 'missing',
      analysis: null,
      evaluation: status.evaluation
        ? {
            result: status.evaluation.result,
            error: status.evaluation.error,
            updatedAt: status.evaluation.updatedAt,
            completedAt: status.evaluation.completedAt,
          }
        : null,
      strategy: null,
      updatedAt: status.evaluation?.updatedAt ?? null,
    }
  }

  return {
    type: status.type,
    snapshotId: status.snapshotId,
    key: taskKey(status),
    displayContext: previous?.displayContext ?? null,
    status: status.strategy?.status ?? 'missing',
    analysis: null,
    evaluation: null,
    strategy: status.strategy
      ? { error: status.strategy.error, updatedAt: status.strategy.updatedAt, completedAt: status.strategy.completedAt }
      : null,
    updatedAt: status.strategy?.updatedAt ?? null,
  }
}

function persist(state: BackgroundTaskState) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, JSON.stringify({ tasksByKey: state.tasksByKey }))
}

function clearPollingTimer() {
  if (pollingTimer !== null) window.clearTimeout(pollingTimer)
  pollingTimer = null
}

function removeReservedKey(keys: string[], key: string) {
  const index = keys.indexOf(key)
  if (index >= 0) keys.splice(index, 1)
}

export const useBackgroundTaskStore = defineStore('backgroundTasks', {
  state: (): BackgroundTaskState => ({
    tasksByKey: {},
    reservedTaskKeys: [],
    isPolling: false,
    lastPolledAt: null,
  }),

  getters: {
    tasks: (state) => Object.values(state.tasksByKey),
    activeTasks: (state) => Object.values(state.tasksByKey).filter((task) => isActive(task.status)),
  },

  actions: {
    reserve(reference: BackgroundTaskReference) {
      const key = taskKey(reference)
      const activeKeys = Object.values(this.tasksByKey)
        .filter((task) => isActive(task.status))
        .map((task) => task.key)
      const occupiedKeys = new Set([...activeKeys, ...this.reservedTaskKeys])

      if (occupiedKeys.has(key)) return { accepted: true as const }

      const typePrefix = `${reference.type}:`
      const typeCount = [...occupiedKeys].filter((occupiedKey) => occupiedKey.startsWith(typePrefix)).length
      const typeLimit = backgroundTaskClientLimits[reference.type]

      if (typeCount >= typeLimit) {
        return {
          accepted: false as const,
          message:
            reference.type === 'job_analysis'
              ? `当前最多同时执行 ${typeLimit} 个 JD 分析任务，请等待已有任务完成。`
              : reference.type === 'answer_deep_evaluation'
                ? `当前最多同时执行 ${typeLimit} 个深度点评任务，请等待已有任务完成。`
                : `当前最多同时生成 ${typeLimit} 个行动策略，请等待已有任务完成。`,
        }
      }

      if (occupiedKeys.size >= backgroundTaskClientLimits.total) {
        return {
          accepted: false as const,
          message: `当前最多同时执行 ${backgroundTaskClientLimits.total} 个后台 AI 任务，请等待已有任务完成。`,
        }
      }

      this.reservedTaskKeys.push(key)
      return { accepted: true as const }
    },

    releaseReservation(reference: BackgroundTaskReference) {
      removeReservedKey(this.reservedTaskKeys, taskKey(reference))
    },

    hydrate() {
      if (typeof localStorage === 'undefined') return
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<BackgroundTaskState>
        if (!parsed.tasksByKey || typeof parsed.tasksByKey !== 'object') return
        this.tasksByKey = Object.fromEntries(
          Object.entries(parsed.tasksByKey).filter(([, task]) => task && typeof task === 'object'),
        ) as Record<string, BackgroundTaskEntry>
      } catch {
        localStorage.removeItem(storageKey)
      }
    },

    subscribe(listener: BackgroundTaskListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    register(reference: BackgroundTaskReference, displayContext?: BackgroundTaskDisplayContext) {
      const key = taskKey(reference)
      const current = this.tasksByKey[key]
      if (current) {
        if (displayContext) current.displayContext = displayContext
        if (!isActive(current.status)) this.reset(reference)
        this.releaseReservation(reference)
        this.start()
        return current
      }

      const entry: BackgroundTaskEntry = {
        ...reference,
        key,
        displayContext: displayContext ?? null,
        status: 'pending',
        analysis: null,
        evaluation: null,
        strategy: null,
        updatedAt: null,
      }
      this.tasksByKey[key] = entry
      this.releaseReservation(reference)
      persist(this.$state)
      this.start()
      void this.pollNow()
      return entry
    },

    reset(reference: BackgroundTaskReference) {
      const key = taskKey(reference)
      const current = this.tasksByKey[key]
      if (!current) return
      current.status = 'pending'
      current.analysis = null
      current.evaluation = null
      current.strategy = null
      current.updatedAt = null
      persist(this.$state)
      this.start()
    },

    registerMany(references: BackgroundTaskReference[]) {
      references.forEach((reference) => this.register(reference))
    },

    unregister(reference: BackgroundTaskReference) {
      delete this.tasksByKey[taskKey(reference)]
      this.releaseReservation(reference)
      persist(this.$state)
      this.schedule()
    },

    start() {
      if (typeof window === 'undefined') return
      if (!visibilityHandler) {
        visibilityHandler = () => {
          if (!isHidden()) void this.pollNow()
          else this.schedule()
        }
        document.addEventListener('visibilitychange', visibilityHandler)
      }
      this.schedule()
    },

    stop() {
      clearPollingTimer()
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
      this.isPolling = false
    },

    schedule() {
      clearPollingTimer()
      if (this.activeTasks.length === 0) return
      pollingTimer = window.setTimeout(() => void this.pollNow(), nextDelay())
    },

    async pollNow() {
      if (pollingPromise) return pollingPromise
      const activeTasks = this.activeTasks
      if (activeTasks.length === 0) {
        this.schedule()
        return
      }

      pollingPromise = (async () => {
        this.isPolling = true
        try {
          const response = await backgroundTaskApi.getStatuses(activeTasks)
          const completedStatuses = await Promise.all(
            response.tasks.map(async (status) => {
              const previous = this.tasksByKey[taskKey(status)]
              const reachedCompleted =
                previous && isActive(previous.status)
                  ? status.type === 'job_analysis'
                    ? status.analysis?.status === 'completed'
                    : status.type === 'answer_deep_evaluation'
                      ? status.evaluation?.status === 'completed'
                      : status.strategy?.status === 'completed'
                  : false

              if (!reachedCompleted) return status

              try {
                if (status.type === 'job_analysis') {
                  const analysis = await backgroundTaskApi.getCompletedJobAnalysis(status.opportunityId)
                  return analysis ? { ...status, analysis } : status
                }

                if (status.type === 'answer_deep_evaluation') {
                  const evaluation = await backgroundTaskApi.getCompletedDeepEvaluation(status.sessionId, status.turnId)
                  return { ...status, evaluation }
                }

                return status
              } catch {
                // 终态详情补取失败时保留轻量状态；下一次进入详情页仍可再次读取完整结果。
                return status
              }
            }),
          )

          completedStatuses.forEach((status) => {
            const key = taskKey(status)
            const previous = this.tasksByKey[key]
            const next = toEntry(status, previous)
            this.tasksByKey[next.key] = next
            const kind: BackgroundTaskUpdateKind =
              previous && isActive(previous.status) && next.status === 'completed'
                ? 'completed'
                : previous && isActive(previous.status) && next.status === 'failed'
                  ? 'failed'
                  : 'updated'
            notify(next, kind)
          })
          this.lastPolledAt = new Date().toISOString()
          persist(this.$state)
        } catch {
          // 后台任务轮询失败不应打断页面交互；下一次可见性或定时轮询会继续尝试。
        } finally {
          this.isPolling = false
          pollingPromise = null
          this.schedule()
        }
      })()

      return pollingPromise
    },
  },
})

export function getBackgroundTaskKey(reference: BackgroundTaskReference) {
  return taskKey(reference)
}
