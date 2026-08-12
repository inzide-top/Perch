<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ChatConversationScopeType, ChatRunPhase, ChatRunStatus } from '@/shared/chat/schemas'
import {
  chatRunDebugApi,
  type ChatRunDebugDetail,
  type ChatRunDebugEvent,
  type ChatRunDebugItem,
} from '@/services/chat-run-debug'

const router = useRouter()
const runs = ref<ChatRunDebugItem[]>([])
const selectedRunId = ref<string | null>(null)
const selectedRun = ref<ChatRunDebugDetail | null>(null)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const searchDraft = ref('')
const appliedSearch = ref('')
const selectedStatus = ref<'all' | ChatRunStatus>('all')
const selectedScope = ref<'all' | ChatConversationScopeType>('all')
const selectedModel = ref('all')
const isLoading = ref(true)
const isLoadingMore = ref(false)
const isRefreshing = ref(false)
const isDetailLoading = ref(false)
const errorMessage = ref('')
const lastUpdatedAt = ref<Date | null>(null)

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '排队中', value: 'queued' },
  { label: '执行中', value: 'running' },
  { label: '等待补充', value: 'waiting_input' },
  { label: '等待确认', value: 'waiting_confirmation' },
  { label: '停止中', value: 'cancelling' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
]
const scopeOptions = [
  { label: '全部范围', value: 'all' },
  { label: '全局对话', value: 'global' },
  { label: '机会对话', value: 'opportunity' },
]
const modelOptions = computed(() => [
  { label: '全部模型', value: 'all' },
  ...Array.from(new Set(runs.value.map((run) => run.modelSnapshot.modelName))).map((modelName) => ({
    label: modelName,
    value: modelName,
  })),
])
const hasActiveRun = computed(() => runs.value.some((run) => ['queued', 'running', 'cancelling'].includes(run.status)))

function statusLabel(status: ChatRunStatus | ChatRunDebugDetail['modelCalls'][number]['status']) {
  return {
    queued: '排队中',
    running: '执行中',
    waiting_input: '等待补充',
    waiting_confirmation: '等待确认',
    cancelling: '停止中',
    pending: '排队中',
    processing: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status]
}

function statusColor(status: ChatRunStatus | ChatRunDebugDetail['modelCalls'][number]['status']) {
  if (status === 'completed') return 'success' as const
  if (status === 'failed') return 'error' as const
  if (status === 'cancelled') return 'neutral' as const
  if (status === 'waiting_input' || status === 'waiting_confirmation') return 'warning' as const
  return 'primary' as const
}

function phaseLabel(phase: ChatRunPhase | null) {
  if (!phase) return '—'
  return {
    initializing: '初始化',
    loading_context: '读取上下文',
    calling_model: '调用模型',
    streaming_response: '输出回答',
    executing_tool: '执行工具',
    finalizing: '收尾落库',
  }[phase]
}

function formatTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return '—'
  const duration = new Date(finishedAt ?? Date.now()).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(duration) || duration < 0) return '—'
  if (duration < 1_000) return `${duration} ms`
  return `${(duration / 1_000).toFixed(1)} s`
}

function truncate(value: string, length = 80) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized
}

function scopeLabel(run: Pick<ChatRunDebugItem, 'scopeType' | 'company' | 'jobTitle'>) {
  if (run.scopeType === 'global') return '全局对话'
  return run.company && run.jobTitle ? `${run.company} · ${run.jobTitle}` : '机会对话'
}

function messageText(message: ChatRunDebugDetail['inputMessage']) {
  if (!message) return ''
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function eventLabel(event: ChatRunDebugEvent) {
  return {
    run_started: 'Chat Run 开始执行',
    run_phase_changed: '运行阶段变化',
    message_started: '开始生成助手消息',
    message_completed: '本次模型输出完成',
    tool_call_requested: '模型请求调用工具',
    tool_call_started: '工具开始执行',
    tool_call_completed: '工具执行完成',
    tool_call_failed: '工具执行失败',
    input_requested: '等待用户补充信息',
    input_received: '收到用户补充信息',
    confirmation_requested: '等待用户确认',
    confirmation_resolved: '用户已处理确认',
    run_completed: 'Chat Run 已完成',
    run_failed: 'Chat Run 执行失败',
    run_cancelled: 'Chat Run 已取消',
    message_delta: '流式文本批次',
  }[event.eventType]
}

let listRequestGeneration = 0
async function loadRuns(options: { append?: boolean; silent?: boolean } = {}) {
  const generation = ++listRequestGeneration
  const append = Boolean(options.append)
  if (append) isLoadingMore.value = true
  else if (options.silent) isRefreshing.value = true
  else isLoading.value = true
  errorMessage.value = ''

  try {
    const response = await chatRunDebugApi.getRuns({
      limit: 30,
      ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      ...(selectedStatus.value !== 'all' ? { status: selectedStatus.value } : {}),
      ...(selectedScope.value !== 'all' ? { scopeType: selectedScope.value } : {}),
      ...(selectedModel.value !== 'all' ? { modelName: selectedModel.value } : {}),
      ...(appliedSearch.value ? { search: appliedSearch.value } : {}),
    })
    if (generation !== listRequestGeneration) return

    runs.value = append ? [...runs.value, ...response.items] : response.items
    nextCursor.value = response.nextCursor
    hasMore.value = response.hasMore
    lastUpdatedAt.value = new Date()

    if (selectedRunId.value && !runs.value.some((run) => run.id === selectedRunId.value)) {
      selectedRunId.value = null
      selectedRun.value = null
    }
  } catch (error) {
    if (generation !== listRequestGeneration) return
    errorMessage.value = error instanceof Error ? error.message : '无法加载 Chat Run'
  } finally {
    if (generation === listRequestGeneration) {
      isLoading.value = false
      isLoadingMore.value = false
      isRefreshing.value = false
    }
  }
}

let detailRequestGeneration = 0
async function selectRun(runId: string, options: { silent?: boolean } = {}) {
  const generation = ++detailRequestGeneration
  selectedRunId.value = runId
  if (!options.silent) isDetailLoading.value = true
  try {
    const detail = await chatRunDebugApi.getRun(runId)
    if (generation !== detailRequestGeneration || selectedRunId.value !== runId) return
    selectedRun.value = detail
  } catch (error) {
    if (generation !== detailRequestGeneration) return
    errorMessage.value = error instanceof Error ? error.message : '无法加载 Chat Run 详情'
  } finally {
    if (!options.silent && generation === detailRequestGeneration) isDetailLoading.value = false
  }
}

async function refreshPage() {
  await loadRuns({ silent: true })
  if (selectedRunId.value) await selectRun(selectedRunId.value, { silent: true })
}

let searchTimer: number | null = null
watch(searchDraft, (value) => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    appliedSearch.value = value.trim()
    void loadRuns()
  }, 400)
})
watch([selectedStatus, selectedScope, selectedModel], () => void loadRuns())

let refreshTimer: number | null = null
function scheduleActiveRefresh() {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
  refreshTimer = window.setInterval(() => {
    if (!document.hidden && hasActiveRun.value) void refreshPage()
  }, 15_000)
}

onMounted(() => {
  void loadRuns()
  scheduleActiveRefresh()
})
onBeforeUnmount(() => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <main class="min-h-screen bg-[var(--app-bg)] p-4 text-default sm:p-6">
    <section class="chat-run-page mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1600px] flex-col gap-4">
      <header class="app-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">PERCH / developer</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-highlighted">Chat Run 调试台</h1>
          <p class="mt-1 text-sm text-muted">按一轮用户请求观察对话状态、模型调用、工具动作和持久化结果。</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span class="hidden text-xs text-muted xl:inline">
            {{ lastUpdatedAt ? `更新于 ${formatTime(lastUpdatedAt.toISOString())}` : '' }}
          </span>
          <UButton to="/developer/agent-runs" color="neutral" variant="outline" icon="i-lucide-bug-play">
            Agent Run
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="isRefreshing"
            @click="refreshPage"
          >
            刷新
          </UButton>
          <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="router.push('/opportunities')">
            返回工作台
          </UButton>
        </div>
      </header>

      <div v-if="errorMessage" class="app-panel-muted p-4 text-sm text-error">{{ errorMessage }}</div>

      <section class="chat-run-toolbar app-toolbar grid gap-2 p-3">
        <UInput
          v-model="searchDraft"
          icon="i-lucide-search"
          placeholder="搜索对话标题、问题、公司或岗位"
          aria-label="搜索 Chat Run"
        />
        <USelect v-model="selectedStatus" :items="statusOptions" aria-label="按运行状态筛选" />
        <USelect v-model="selectedScope" :items="scopeOptions" aria-label="按对话范围筛选" />
        <USelect v-model="selectedModel" :items="modelOptions" aria-label="按模型筛选" />
        <span class="self-center text-right text-xs text-muted">已加载 {{ runs.length }} 条</span>
      </section>

      <div class="chat-run-master-detail grid min-h-0 flex-1 items-start gap-4">
        <section class="chat-run-list app-card flex min-w-0 flex-col overflow-hidden">
          <div class="border-b border-default px-5 py-4">
            <h2 class="text-sm font-semibold text-highlighted">最近对话轮次</h2>
            <p class="mt-1 text-xs text-muted">一行对应用户的一次发送，不平铺内部模型调用。</p>
          </div>
          <div v-if="isLoading" class="min-h-0 flex-1 space-y-3 overflow-hidden p-4">
            <USkeleton v-for="index in 7" :key="index" class="h-24 w-full rounded-xl" />
          </div>
          <div
            v-else-if="runs.length === 0"
            class="flex min-h-72 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <UIcon name="i-lucide-message-square-dashed" class="size-8 text-dimmed" />
            <p class="text-sm font-medium text-highlighted">没有符合条件的 Chat Run</p>
            <p class="text-xs text-muted">发送一次 AI 助手消息后，这里会出现对应的运行记录。</p>
          </div>
          <div v-else class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            <button
              v-for="run in runs"
              :key="run.id"
              type="button"
              class="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :class="selectedRunId === run.id ? 'bg-elevated ring-1 ring-primary/35' : ''"
              @click="selectRun(run.id)"
            >
              <div class="flex min-w-0 items-center justify-between gap-3">
                <p class="truncate text-sm font-medium text-highlighted">{{ run.conversationTitle }}</p>
                <UBadge :color="statusColor(run.status)" variant="subtle" :label="statusLabel(run.status)" />
              </div>
              <p class="mt-1 truncate text-xs text-muted">{{ truncate(run.inputText) || '未记录输入摘要' }}</p>
              <div class="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs text-muted">
                <span class="truncate">{{ scopeLabel(run) }} · {{ run.modelSnapshot.modelName }}</span>
                <span class="shrink-0">{{ formatTime(run.createdAt) }}</span>
              </div>
              <div class="mt-2 flex gap-3 text-[11px] text-dimmed">
                <span>模型 {{ run.agentRunCount }} 次</span>
                <span>工具 {{ run.toolActionCount }} 次</span>
                <span>{{ formatDuration(run.startedAt, run.finishedAt) }}</span>
              </div>
            </button>
            <div v-if="hasMore" class="p-2">
              <UButton
                block
                color="neutral"
                variant="ghost"
                :loading="isLoadingMore"
                icon="i-lucide-chevron-down"
                @click="loadRuns({ append: true })"
              >
                加载更多
              </UButton>
            </div>
          </div>
        </section>

        <section class="chat-run-detail app-card min-h-96 min-w-0 overflow-hidden p-5">
          <div v-if="isDetailLoading" class="space-y-4">
            <USkeleton class="h-7 w-72" />
            <USkeleton class="h-24 w-full rounded-xl" />
            <USkeleton class="h-64 w-full rounded-xl" />
          </div>
          <div v-else-if="!selectedRun" class="flex min-h-80 flex-col items-center justify-center gap-2 text-center">
            <UIcon name="i-lucide-workflow" class="size-8 text-dimmed" />
            <p class="text-sm font-medium text-highlighted">选择一轮 Chat Run</p>
            <p class="text-xs text-muted">详情会按运行层级展示，不会把多轮对话混在一起。</p>
          </div>
          <template v-else>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate text-base font-semibold text-highlighted">{{ selectedRun.conversation.title }}</h2>
                <p class="mt-1 text-xs text-muted">
                  {{ selectedRun.run.modelSnapshot.modelName }} · {{ selectedRun.run.promptVersion }} · revision
                  {{ selectedRun.run.revision }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  color="neutral"
                  variant="outline"
                  :label="
                    scopeLabel({
                      scopeType: selectedRun.conversation.scopeType,
                      company: selectedRun.company,
                      jobTitle: selectedRun.jobTitle,
                    })
                  "
                />
                <UBadge
                  :color="statusColor(selectedRun.run.status)"
                  variant="subtle"
                  :label="statusLabel(selectedRun.run.status)"
                />
              </div>
            </div>

            <div class="chat-run-stats-grid mt-5 grid gap-3">
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">当前阶段</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ phaseLabel(selectedRun.run.phase) }}</p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">模型调用</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ selectedRun.modelCalls.length }} 次</p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">工具动作</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ selectedRun.toolActions.length }} 次</p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">流式持久化</p>
                <p class="mt-1 text-sm font-medium text-highlighted">
                  {{ selectedRun.deltaSummary.batchCount }} 批 / {{ selectedRun.deltaSummary.characterCount }} 字符
                </p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">记忆索引</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ selectedRun.memoryDocumentCount }} 个分块</p>
              </div>
            </div>

            <div v-if="selectedRun.run.error" class="mt-4 rounded-xl border border-error/25 bg-error/8 p-4 text-sm">
              <p class="font-medium text-error">{{ selectedRun.run.error.code }}</p>
              <p class="mt-1 text-muted">{{ selectedRun.run.error.message }}</p>
            </div>

            <section class="chat-run-two-column-grid mt-5 grid gap-4">
              <article class="app-panel-muted min-w-0 p-4">
                <p class="text-sm font-medium text-highlighted">用户输入</p>
                <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                  {{ messageText(selectedRun.inputMessage) || '未找到输入消息' }}
                </p>
              </article>
              <article class="app-panel-muted min-w-0 p-4">
                <p class="text-sm font-medium text-highlighted">最终助手消息</p>
                <p class="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                  {{ messageText(selectedRun.outputMessage) || '当前尚未生成最终消息' }}
                </p>
              </article>
            </section>

            <section class="mt-5">
              <div class="flex items-end justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">主流程模型调用</h3>
                  <p class="mt-1 text-xs text-muted">只记录本轮 AgentRuntime 调用，不包含自动标题和 Embedding。</p>
                </div>
              </div>
              <div v-if="selectedRun.modelCalls.length === 0" class="app-panel-muted mt-3 p-4 text-sm text-muted">
                这轮运行尚无模型调用记录；旧历史 Chat Run 不会自动补造记录。
              </div>
              <div v-else class="mt-3 space-y-3">
                <details v-for="(call, index) in selectedRun.modelCalls" :key="call.id" class="app-panel-muted p-4">
                  <summary class="cursor-pointer list-none">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p class="text-sm font-medium text-highlighted">第 {{ index + 1 }} 次 · {{ call.modelName }}</p>
                        <p class="mt-1 text-xs text-muted">
                          {{ formatDuration(call.startedAt, call.finishedAt) }} · Token
                          {{ call.tokenUsage?.totalTokens ?? '—' }}
                        </p>
                      </div>
                      <UBadge :color="statusColor(call.status)" variant="subtle" :label="statusLabel(call.status)" />
                    </div>
                  </summary>
                  <div class="chat-run-two-column-grid mt-4 grid gap-3">
                    <div>
                      <p class="text-xs font-medium text-muted">输入摘要</p>
                      <pre
                        class="app-code-block mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-muted"
                        >{{ formatJson(call.input) }}</pre>
                    </div>
                    <div>
                      <p class="text-xs font-medium text-muted">模型输出</p>
                      <pre
                        class="app-code-block mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-muted"
                        >{{ call.rawOutput || formatJson(call.parsedOutput) }}</pre>
                    </div>
                  </div>
                </details>
              </div>
            </section>

            <section class="chat-run-two-column-grid mt-5 grid gap-4">
              <div>
                <h3 class="text-sm font-semibold text-highlighted">工具动作</h3>
                <div v-if="selectedRun.toolActions.length === 0" class="app-panel-muted mt-3 p-4 text-sm text-muted">
                  本轮没有调用工具。
                </div>
                <div v-else class="mt-3 space-y-2">
                  <details v-for="tool in selectedRun.toolActions" :key="tool.id" class="app-panel-muted p-4">
                    <summary class="cursor-pointer list-none">
                      <div class="flex items-center justify-between gap-3">
                        <span class="truncate text-sm font-medium text-highlighted">{{ tool.toolName }}</span>
                        <UBadge color="neutral" variant="outline" :label="tool.status" />
                      </div>
                    </summary>
                    <pre
                      class="app-code-block mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-muted"
                      >{{ formatJson({ input: tool.input, output: tool.output, error: tool.error }) }}</pre>
                  </details>
                </div>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-highlighted">运行时间线</h3>
                <div v-if="selectedRun.events.length === 0" class="app-panel-muted mt-3 p-4 text-sm text-muted">
                  暂无非文本运行事件。
                </div>
                <ol v-else class="mt-3 space-y-2">
                  <li v-for="event in selectedRun.events" :key="event.id" class="app-panel-muted flex gap-3 p-3">
                    <span class="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-3">
                        <p class="truncate text-sm font-medium text-highlighted">{{ eventLabel(event) }}</p>
                        <span class="shrink-0 text-xs text-muted">{{ formatTime(event.createdAt) }}</span>
                      </div>
                      <p class="mt-1 text-xs text-muted">
                        sequence {{ event.sequence }} · revision {{ event.stateRevision }}
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </section>

            <details class="app-panel-muted mt-5 overflow-hidden p-4">
              <summary class="cursor-pointer text-sm font-medium text-highlighted">运行标识与原始状态</summary>
              <pre class="app-code-block mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-muted">{{
                formatJson({
                  runId: selectedRun.run.id,
                  conversationId: selectedRun.conversation.id,
                  input: selectedRun.run.input,
                  budget: selectedRun.run.budget,
                  runtimeState: selectedRun.run.runtimeState,
                })
              }}</pre>
            </details>
          </template>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.chat-run-page {
  container-name: chat-run-page;
  container-type: inline-size;
}

.chat-run-toolbar,
.chat-run-master-detail,
.chat-run-stats-grid,
.chat-run-two-column-grid {
  grid-template-columns: minmax(0, 1fr);
}

.chat-run-list {
  height: min(32rem, calc(100vh - 8rem));
  min-height: 24rem;
}

@container chat-run-page (min-width: 44rem) {
  .chat-run-toolbar,
  .chat-run-stats-grid,
  .chat-run-two-column-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container chat-run-page (min-width: 70rem) {
  .chat-run-toolbar {
    grid-template-columns: minmax(220px, 1fr) 150px 150px 190px auto;
  }

  .chat-run-master-detail {
    grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.7fr);
  }

  .chat-run-list,
  .chat-run-detail {
    height: max(40rem, calc(100vh - 15rem));
  }

  .chat-run-detail {
    overflow-y: auto;
  }

  .chat-run-stats-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
