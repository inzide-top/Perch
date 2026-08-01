<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { agentRunApi, type AgentRunDebugDetail, type AgentRunDebugItem } from '@/services/agent-runs'

const router = useRouter()
const runs = ref<AgentRunDebugItem[]>([])
const selectedRunId = ref<string | null>(null)
const selectedRun = ref<AgentRunDebugDetail | null>(null)
const isLoading = ref(true)
const isRefreshing = ref(false)
const isDetailLoading = ref(false)
const errorMessage = ref('')
const lastUpdatedAt = ref<Date | null>(null)

function formatTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(value),
  )
}

function formatDuration(value: number | null) {
  if (value === null) return '—'
  if (value < 1_000) return `${value} ms`
  return `${(value / 1_000).toFixed(1)} s`
}

function statusLabel(status: AgentRunDebugItem['status']) {
  return { pending: '排队中', processing: '执行中', completed: '已完成', failed: '失败' }[status]
}

function statusColor(status: AgentRunDebugItem['status']) {
  const colors = { pending: 'warning', processing: 'primary', completed: 'success', failed: 'error' } as const
  return colors[status]
}

async function loadRuns(options: { initial?: boolean } = {}) {
  if (options.initial) isLoading.value = true
  else isRefreshing.value = true
  errorMessage.value = ''

  try {
    const nextRuns = await agentRunApi.getAgentRuns()
    runs.value = nextRuns
    lastUpdatedAt.value = new Date()

    if (selectedRunId.value && !nextRuns.some((run) => run.id === selectedRunId.value)) {
      selectedRunId.value = null
      selectedRun.value = null
    } else if (selectedRunId.value) {
      const latestSelectedRun = nextRuns.find((run) => run.id === selectedRunId.value)
      const isSelectedRunStale =
        latestSelectedRun &&
        (!selectedRun.value ||
          latestSelectedRun.status !== selectedRun.value.status ||
          latestSelectedRun.finishedAt !== selectedRun.value.finishedAt ||
          latestSelectedRun.durationMs !== selectedRun.value.durationMs)

      if (isSelectedRunStale) await loadRunDetail(selectedRunId.value, { silent: true })
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法加载 AgentRun'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

async function loadRunDetail(runId: string, options: { silent?: boolean } = {}) {
  if (!options.silent) isDetailLoading.value = true

  try {
    selectedRun.value = await agentRunApi.getAgentRun(runId)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法加载执行详情'
  } finally {
    if (!options.silent) isDetailLoading.value = false
  }
}

async function selectRun(runId: string) {
  if (selectedRunId.value === runId && selectedRun.value) return
  selectedRunId.value = runId
  await loadRunDetail(runId)
}

let refreshTimer: number | null = null
onMounted(() => {
  void loadRuns({ initial: true })
  refreshTimer = window.setInterval(() => void loadRuns(), 3_000)
})
onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <main class="min-h-screen bg-[var(--app-bg)] p-4 text-default sm:p-6">
    <section class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1600px] flex-col gap-4">
      <header class="app-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">PERCH / developer</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-highlighted">AgentRun 调试台</h1>
          <p class="mt-1 text-sm text-muted">独立观察模型调用、重试、结构化输出与失败原因。每 3 秒自动刷新。</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="hidden text-xs text-muted sm:inline">{{ lastUpdatedAt ? `更新于 ${formatTime(lastUpdatedAt.toISOString())}` : '' }}</span>
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="isRefreshing" @click="loadRuns()">
            刷新
          </UButton>
          <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="router.push('/opportunities')">
            返回工作台
          </UButton>
        </div>
      </header>

      <div v-if="errorMessage" class="app-panel-muted p-5 text-sm text-error">{{ errorMessage }}</div>

      <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.65fr)]">
        <section class="app-card min-h-96 overflow-hidden">
          <div class="border-b border-default px-5 py-4"><h2 class="text-sm font-semibold text-highlighted">最近执行</h2></div>
          <div v-if="isLoading" class="space-y-3 p-4"><USkeleton v-for="index in 7" :key="index" class="h-16 w-full rounded-xl" /></div>
          <div v-else-if="runs.length === 0" class="flex min-h-72 items-center justify-center px-6 text-center text-sm text-muted">
            暂无模型执行记录。创建 JD 分析后，这里会出现每一次模型调用和重试。
          </div>
          <div v-else class="max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto p-2">
            <button
              v-for="run in runs"
              :key="run.id"
              type="button"
              class="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-elevated"
              :class="selectedRunId === run.id ? 'bg-elevated ring-1 ring-primary/35' : ''"
              @click="selectRun(run.id)"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="truncate text-sm font-medium text-highlighted">{{ run.company }} · {{ run.jobTitle }}</p>
                <UBadge :color="statusColor(run.status)" variant="subtle" :label="statusLabel(run.status)" />
              </div>
              <div class="mt-1 flex items-center justify-between gap-3 text-xs text-muted"><span>第 {{ run.attemptNumber }} 次 · {{ run.modelName }}</span><span>{{ formatDuration(run.durationMs) }}</span></div>
            </button>
          </div>
        </section>

        <section class="app-card min-h-96 overflow-hidden p-5">
          <div v-if="isDetailLoading" class="space-y-4"><USkeleton class="h-7 w-64" /><USkeleton class="h-24 w-full rounded-xl" /><USkeleton class="h-56 w-full rounded-xl" /></div>
          <div v-else-if="!selectedRun" class="flex min-h-80 items-center justify-center text-sm text-muted">从左侧选择一条执行记录，查看输入、原始输出和结构化结果。</div>
          <template v-else>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div><h2 class="text-base font-semibold text-highlighted">{{ selectedRun.company }} · {{ selectedRun.jobTitle }}</h2><p class="mt-1 text-xs text-muted">{{ selectedRun.modelName }} · {{ selectedRun.promptVersion }} · 第 {{ selectedRun.attemptNumber }} 次</p></div>
              <UBadge :color="statusColor(selectedRun.status)" variant="subtle" :label="statusLabel(selectedRun.status)" />
            </div>
            <div class="mt-5 grid gap-3 sm:grid-cols-3">
              <div class="app-panel-muted p-3"><p class="text-xs text-muted">耗时</p><p class="mt-1 text-sm font-medium text-highlighted">{{ formatDuration(selectedRun.durationMs) }}</p></div>
              <div class="app-panel-muted p-3"><p class="text-xs text-muted">Token</p><p class="mt-1 text-sm font-medium text-highlighted">{{ selectedRun.tokenUsage?.totalTokens ?? '—' }}</p></div>
              <div class="app-panel-muted p-3"><p class="text-xs text-muted">完成时间</p><p class="mt-1 text-sm font-medium text-highlighted">{{ formatTime(selectedRun.finishedAt) }}</p></div>
            </div>
            <div
              v-if="selectedRun.status === 'pending' || selectedRun.status === 'processing'"
              class="mt-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"
            >
              <UIcon name="i-lucide-loader-circle" class="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
              <div>
                <p class="text-sm font-medium text-highlighted">模型正在生成结构化分析</p>
                <p class="mt-1 text-xs leading-5 text-muted">
                  当前使用非流式 JSON 请求：模型完成前不会返回可展示的原始输出或思考内容；完成后此处会自动刷新为最终响应。
                </p>
              </div>
            </div>
            <div v-if="selectedRun.error" class="mt-4 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error"><p class="font-medium">{{ selectedRun.error.code }}</p><p class="mt-1 leading-6">{{ selectedRun.error.message }}</p></div>
            <div class="mt-5 grid gap-4 xl:grid-cols-2">
              <details class="app-panel-muted overflow-hidden p-4" open><summary class="cursor-pointer text-sm font-medium text-highlighted">传给模型的业务输入</summary><pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted">{{ JSON.stringify(selectedRun.input, null, 2) }}</pre></details>
              <details class="app-panel-muted overflow-hidden p-4" open><summary class="cursor-pointer text-sm font-medium text-highlighted">原始模型输出</summary><pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted">{{ selectedRun.rawOutput ?? '暂无输出' }}</pre></details>
            </div>
            <details v-if="selectedRun.parsedOutput" class="app-panel-muted mt-4 overflow-hidden p-4"><summary class="cursor-pointer text-sm font-medium text-highlighted">通过校验后的结构化结果</summary><pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted">{{ JSON.stringify(selectedRun.parsedOutput, null, 2) }}</pre></details>
          </template>
        </section>
      </div>
    </section>
  </main>
</template>
