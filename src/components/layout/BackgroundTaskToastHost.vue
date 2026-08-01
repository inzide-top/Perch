<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import {
  useBackgroundTaskStore,
  type BackgroundTaskEntry,
  type BackgroundTaskUpdateKind,
} from '@/stores/background-tasks'
import { useInterviewStore } from '@/stores/interview'
import { useOpportunityStore } from '@/stores/opportunity'
import { useResumeStore } from '@/stores/resume'
import { useSettingsStore } from '@/stores/settings'
import { getAiTaskErrorPresentation } from '@/services/ai-errors'
import { actionStrategyApi } from '@/services/action-strategy'
import AnswerReviewDrawer from '@/pages/opportunity/detail/interview/components/AnswerReviewDrawer.vue'

type ToastItem = {
  id: string
  task: BackgroundTaskEntry
  kind: Extract<BackgroundTaskUpdateKind, 'completed' | 'failed'>
}

type ToastTimer = {
  timeoutId: number | null
  remainingMs: number
  startedAt: number
}

const route = useRoute()
const router = useRouter()
const appToast = useToast()
const backgroundTaskStore = useBackgroundTaskStore()
const opportunityStore = useOpportunityStore()
const interviewStore = useInterviewStore()
const resumeStore = useResumeStore()
const settingsStore = useSettingsStore()
const toastItems = ref<ToastItem[]>([])
const activeReviewTarget = ref<{ sessionId: string; turnId: string } | null>(null)
const toastTimers = new Map<string, ToastTimer>()
let unsubscribe: (() => void) | null = null

const activeReviewSession = computed(() => {
  const target = activeReviewTarget.value
  return target ? interviewStore.session(target.sessionId) : null
})
const activeReviewAnswer = computed(() => {
  const target = activeReviewTarget.value
  return activeReviewSession.value?.answers.find((answer) => answer.id === target?.turnId) ?? null
})
const activeReviewQuestion = computed(() => {
  const target = activeReviewTarget.value
  return activeReviewSession.value?.questions.find((question) => question.id === target?.turnId) ?? null
})
const isActiveReviewLoading = computed(() => {
  const target = activeReviewTarget.value
  return target ? interviewStore.isAnswerReviewing(target.turnId) : false
})

function isCurrentTaskContext(task: BackgroundTaskEntry) {
  if (task.type === 'job_analysis') {
    return route.path === '/opportunities' || route.path.startsWith(`/opportunities/${task.opportunityId}`)
  }

  if (task.type === 'answer_deep_evaluation') return route.path.includes(`/interviews/${task.sessionId}`)
  return route.path === '/strategy/actions'
}

function addToast(task: BackgroundTaskEntry, kind: Extract<BackgroundTaskUpdateKind, 'completed' | 'failed'>) {
  if (isCurrentTaskContext(task)) return
  if (toastItems.value.some((item) => item.task.key === task.key && item.kind === kind)) return

  const nextItems = [
    ...toastItems.value.filter((item) => item.task.key !== task.key),
    { id: `${task.key}:${kind}:${Date.now()}`, task, kind },
  ].slice(-3)
  const nextIds = new Set(nextItems.map((item) => item.id))
  toastItems.value.forEach((item) => {
    if (!nextIds.has(item.id)) clearToastTimer(item.id)
  })
  toastItems.value = nextItems
  scheduleToastTimer(nextItems.at(-1)!.id, 5_000)
}

function dismissToast(id: string) {
  clearToastTimer(id)
  toastItems.value = toastItems.value.filter((item) => item.id !== id)
}

function clearToastTimer(id: string) {
  const timer = toastTimers.get(id)
  if (timer && timer.timeoutId !== null) window.clearTimeout(timer.timeoutId)
  toastTimers.delete(id)
}

function scheduleToastTimer(id: string, durationMs: number) {
  clearToastTimer(id)
  const timer: ToastTimer = {
    timeoutId: null,
    remainingMs: durationMs,
    startedAt: Date.now(),
  }
  timer.timeoutId = window.setTimeout(() => dismissToast(id), durationMs)
  toastTimers.set(id, timer)
}

function pauseToastTimer(id: string) {
  const timer = toastTimers.get(id)
  if (!timer || timer.timeoutId === null) return

  window.clearTimeout(timer.timeoutId)
  timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt))
  timer.timeoutId = null
}

function resumeToastTimer(id: string) {
  const timer = toastTimers.get(id)
  if (!timer || timer.timeoutId !== null) return

  timer.startedAt = Date.now()
  timer.timeoutId = window.setTimeout(() => dismissToast(id), timer.remainingMs)
}

function getInterviewTypeLabel(type: 'foundation' | 'project') {
  return type === 'foundation' ? '基础面' : '项目面'
}

function taskContextLabel(task: BackgroundTaskEntry) {
  if (task.displayContext) {
    return [task.displayContext.primary, task.displayContext.secondary].filter(Boolean).join(' · ')
  }

  if (task.type === 'job_analysis') {
    const opportunity = opportunityStore.opportunities.find((item) => item.id === task.opportunityId)
    return opportunity ? `${opportunity.company} · ${opportunity.jobTitle}` : '当前 JD'
  }

  if (task.type === 'action_strategy') return '求职策略'

  const session = interviewStore.session(task.sessionId)
  const opportunity = session ? opportunityStore.opportunities.find((item) => item.id === session.opportunityId) : null
  const answerSequence = session?.answers.findIndex((answer) => answer.id === task.turnId) ?? -1
  return [
    opportunity ? `${opportunity.company} · ${opportunity.jobTitle}` : '当前模拟面试',
    session ? getInterviewTypeLabel(session.config.type) : null,
    answerSequence >= 0 ? `第 ${answerSequence + 1} 次回答` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function taskStatusDescription(item: ToastItem) {
  const taskName =
    item.task.type === 'job_analysis'
      ? 'JD 匹配分析'
      : item.task.type === 'answer_deep_evaluation'
        ? '深度点评'
        : '求职策略'
  if (item.kind !== 'failed') return `${taskName}已经完成。`
  return getAiTaskErrorPresentation(taskError(item.task)).description
}

function taskError(task: BackgroundTaskEntry) {
  if (task.type === 'job_analysis') return task.analysis?.error
  if (task.type === 'answer_deep_evaluation') return task.evaluation?.error
  return task.strategy?.error
}

function taskFailurePresentation(task: BackgroundTaskEntry) {
  return getAiTaskErrorPresentation(taskError(task))
}

async function openDeepReview(task: Extract<BackgroundTaskEntry, { type: 'answer_deep_evaluation' }>) {
  const session =
    interviewStore.session(task.sessionId) ?? (await interviewStore.loadSession(task.sessionId, { force: true }))

  const answer = session?.answers.find((item) => item.id === task.turnId)
  const question = session?.questions.find((item) => item.id === task.turnId)
  if (!session || !answer || !question) {
    appToast.add({
      title: '无法打开深度点评',
      description: '对应的面试回答不存在或已经被删除。',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return false
  }

  activeReviewTarget.value = { sessionId: task.sessionId, turnId: task.turnId }
  if (!answer.deepReview) void interviewStore.loadAnswerReview(task.sessionId, task.turnId)
  return true
}

async function openTask(item: ToastItem) {
  if (item.task.type === 'job_analysis') {
    dismissToast(item.id)
    await router.push(`/opportunities/${item.task.opportunityId}`)
    return
  }

  if (item.task.type === 'answer_deep_evaluation') {
    if (await openDeepReview(item.task)) dismissToast(item.id)
    return
  }

  dismissToast(item.id)
  await router.push('/strategy/actions')
}

async function retryTask(item: ToastItem) {
  if (taskFailurePresentation(item.task).requiresModelAttention) {
    dismissToast(item.id)
    await router.push('/settings')
    return
  }

  dismissToast(item.id)
  backgroundTaskStore.unregister(item.task)

  if (item.task.type === 'answer_deep_evaluation') {
    const result = await interviewStore.generateAnswerReview(
      item.task.sessionId,
      item.task.turnId,
      item.task.displayContext ?? undefined,
    )
    if (result.status === 'capacity_exceeded') {
      appToast.add({ title: '深度点评任务已达上限', description: result.message, color: 'warning' })
    }
    return
  }

  if (item.task.type === 'action_strategy') {
    try {
      const result = await actionStrategyApi.generate(settingsStore.llm)
      if (result.snapshotId && (result.status === 'pending' || result.status === 'processing')) {
        backgroundTaskStore.register(
          { type: 'action_strategy', snapshotId: result.snapshotId },
          { primary: '求职策略' },
        )
      }
    } catch {
      // 失败状态由统一后台轮询再次反馈。
    }
    return
  }

  const resume = resumeStore.currentResume
  const version = resumeStore.currentVersion
  if (!resume || !version || !settingsStore.llm.apiKey.trim()) {
    await router.push('/settings')
    return
  }

  try {
    await opportunityStore.retryJobAnalysis(item.task.opportunityId, {
      resumeId: resume.id,
      resumeVersionId: version.id,
      modelConnection: settingsStore.llm,
    })
  } catch {
    await router.push(`/opportunities/${item.task.opportunityId}`)
  }
}

onMounted(() => {
  unsubscribe = backgroundTaskStore.subscribe((task, kind) => {
    if (kind === 'completed' || kind === 'failed') addToast(task, kind)
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  toastTimers.forEach((_, id) => clearToastTimer(id))
})
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-4 bottom-4 z-[200] flex flex-col items-end gap-3 sm:left-auto sm:w-[360px]"
  >
    <TransitionGroup name="background-toast" tag="div" class="flex w-full flex-col gap-3">
      <article
        v-for="item in toastItems"
        :key="item.id"
        class="pointer-events-auto rounded-2xl border bg-default/95 p-4 shadow-xl backdrop-blur"
        :class="item.kind === 'failed' ? 'border-error/40' : 'border-success/30'"
        @pointerenter="pauseToastTimer(item.id)"
        @pointerleave="resumeToastTimer(item.id)"
        @focusin="pauseToastTimer(item.id)"
        @focusout="resumeToastTimer(item.id)"
      >
        <div class="flex items-start gap-3">
          <UIcon
            :name="item.kind === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
            class="mt-0.5 size-5 shrink-0"
            :class="item.kind === 'failed' ? 'text-error' : 'text-success'"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-highlighted">
              {{
                item.kind === 'failed'
                  ? taskFailurePresentation(item.task).title
                  : `${item.task.type === 'job_analysis' ? 'JD 分析' : item.task.type === 'answer_deep_evaluation' ? '深度点评' : '求职策略'}已完成`
              }}
            </p>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{ taskContextLabel(item.task) }}
            </p>
            <p class="mt-0.5 text-xs leading-5 text-muted">
              {{ taskStatusDescription(item) }}
            </p>
          </div>
          <button class="text-muted transition hover:text-highlighted" type="button" @click="dismissToast(item.id)">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
        <div class="mt-3 flex justify-end">
          <UButton
            size="xs"
            :color="item.kind === 'failed' ? 'error' : 'primary'"
            @click="item.kind === 'failed' ? retryTask(item) : openTask(item)"
          >
            {{
              item.kind === 'failed'
                ? taskFailurePresentation(item.task).requiresModelAttention
                  ? '检查模型'
                  : '重新生成'
                : '打开'
            }}
          </UButton>
        </div>
      </article>
    </TransitionGroup>
  </div>

  <AnswerReviewDrawer
    :open="Boolean(activeReviewTarget)"
    :answer="activeReviewAnswer"
    :question="activeReviewQuestion"
    :loading="isActiveReviewLoading"
    @close="activeReviewTarget = null"
  />
</template>

<style scoped>
.background-toast-enter-active,
.background-toast-leave-active {
  transition: all 220ms ease;
}

.background-toast-enter-from,
.background-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
