<script setup lang="ts">
import type { InterviewSessionSummary } from '@/types/interview'
import { getScoreClass } from '@/shared/opportunity/analysisPresentation'

defineProps<{
  sessions: InterviewSessionSummary[]
  loading: boolean
  openingSessionId: string | null
}>()

const emit = defineEmits<{
  open: [sessionId: string]
  create: []
}>()

function handleHistoryWheel(event: WheelEvent) {
  if (typeof window === 'undefined' || event.deltaY === 0) return

  const historyList = event.currentTarget as HTMLElement
  const page = document.documentElement
  const maxPageScrollTop = Math.max(0, page.scrollHeight - window.innerHeight)

  if (event.deltaY > 0) {
    if (window.scrollY >= maxPageScrollTop) return

    event.preventDefault()
    window.scrollBy({ top: event.deltaY, behavior: 'auto' })
    return
  }

  if (historyList.scrollTop > 0 || window.scrollY <= 0) return

  event.preventDefault()
  window.scrollBy({ top: event.deltaY, behavior: 'auto' })
}

function getTypeLabel(value: InterviewSessionSummary['config']['type']) {
  return value === 'foundation' ? '基础面' : '项目面'
}

function getStatusLabel(status: InterviewSessionSummary['status']) {
  const map = {
    preparing: '准备中',
    preparation_failed: '准备失败',
    active: '进行中',
    finalizing: '生成复盘中',
    completed: '已完成',
    ended_early: '提前结束',
    cancelled: '已取消',
  } as const

  return map[status]
}

function getStatusColor(status: InterviewSessionSummary['status']) {
  if (status === 'completed') return 'success'
  if (status === 'ended_early') return 'warning'
  if (status === 'active' || status === 'preparing' || status === 'finalizing') return 'primary'
  return 'neutral'
}

function getScoreTone(score: number) {
  return getScoreClass(score)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
</script>

<template>
  <section class="app-panel flex min-h-[calc(100vh-6.5rem)] flex-col p-4 xl:h-[calc(100vh-6.5rem)] xl:min-h-0">
    <div class="flex items-start justify-between gap-3 px-1 pb-4">
      <div>
        <h2 class="text-base font-semibold text-highlighted">历史模拟面试</h2>
        <p class="mt-1 text-xs leading-5 text-muted">按时间回看每一次训练与整体表现</p>
      </div>
      <UButton
        type="button"
        class="interview-history-create"
        color="primary"
        size="sm"
        icon="i-lucide-plus"
        @click="emit('create')"
      >
        新建面试
      </UButton>
    </div>

    <div v-if="loading" class="flex-1 space-y-3 overflow-y-auto pr-1" aria-label="正在加载面试记录">
      <div v-for="item in 4" :key="item" class="interview-skeleton-card animate-pulse" />
    </div>

    <div
      v-else-if="sessions.length"
      class="interview-history-list flex-1 space-y-3 overflow-y-auto pr-1"
      @wheel="handleHistoryWheel"
    >
      <button
        v-for="session in sessions"
        :key="session.id"
        type="button"
        class="interview-history-item w-full text-left"
        :class="{ 'is-opening': openingSessionId === session.id }"
        :disabled="openingSessionId !== null"
        @click="emit('open', session.id)"
      >
        <div class="flex items-start gap-3">
          <div class="interview-history-type-icon">
            <UIcon
              :name="session.config.type === 'project' ? 'i-lucide-briefcase-business' : 'i-lucide-book-open-check'"
              class="size-4"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              <span class="text-sm font-semibold text-highlighted">{{ getTypeLabel(session.config.type) }}</span>
              <span class="interview-history-meta">{{
                session.config.scale === 'quick' ? '快速' : session.config.scale === 'deep' ? '深度' : '标准'
              }}</span>
              <span class="interview-history-meta">{{
                session.config.difficulty === 'adaptive'
                  ? '自适应'
                  : session.config.difficulty === 'advanced'
                    ? '进阶'
                    : session.config.difficulty === 'basic'
                      ? '基础'
                      : '标准难度'
              }}</span>
            </div>
            <p class="mt-1.5 text-xs text-muted">
              {{ formatDate(session.lastActivityAt) }} · {{ session.answeredQuestionCount }} 次作答
            </p>
          </div>
          <div
            v-if="session.overallScore !== null"
            class="interview-history-score"
            :class="getScoreTone(session.overallScore)"
          >
            <strong>{{ session.overallScore }}</strong
            ><span>分</span>
          </div>
          <UIcon
            v-else-if="openingSessionId === session.id"
            name="i-lucide-loader-circle"
            class="mt-0.5 size-4 animate-spin text-primary"
          />
        </div>
        <div class="mt-3 flex items-center justify-between gap-2 border-t border-default pt-3">
          <div class="flex items-center gap-2">
            <UBadge
              size="sm"
              :color="getStatusColor(session.status)"
              variant="subtle"
              :label="getStatusLabel(session.status)"
            />
            <span v-if="session.config.referenceHistoricalWeaknesses" class="text-[11px] text-muted"
              >已参考历史薄弱项</span
            >
          </div>
          <span v-if="session.validAnswerCount < 3 && session.status !== 'active'" class="text-[11px] text-muted"
            >证据不足</span
          >
          <UIcon v-else name="i-lucide-chevron-right" class="size-4 text-muted" />
        </div>
      </button>
    </div>

    <div v-else class="flex flex-1 flex-col items-center justify-center px-5 text-center">
      <div class="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <UIcon name="i-lucide-messages-square" class="size-5" />
      </div>
      <p class="mt-4 text-sm font-medium text-highlighted">还没有模拟面试记录</p>
      <p class="mt-2 text-xs leading-5 text-muted">从一场基础面或项目面开始，后续可在这里回看证据、评分与薄弱项。</p>
      <UButton
        type="button"
        class="mt-4"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-plus"
        @click="emit('create')"
      >
        创建第一场
      </UButton>
    </div>
  </section>
</template>
