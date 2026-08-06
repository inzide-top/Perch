<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import type { AgentWorkflowType } from '@/shared/interview/schemas'
import { agentRunApi, type AgentRunDebugDetail, type AgentRunDebugItem } from '@/services/agent-runs'

const router = useRouter()
const toast = useToast()
const runs = ref<AgentRunDebugItem[]>([])
const selectedRunId = ref<string | null>(null)
const selectedRun = ref<AgentRunDebugDetail | null>(null)
const isLoading = ref(true)
const isRefreshing = ref(false)
const isFilterTransitioning = ref(false)
const isDetailLoading = ref(false)
const errorMessage = ref('')
const lastUpdatedAt = ref<Date | null>(null)
const selectedWorkflow = ref<'all' | AgentWorkflowType>('all')
const selectedStatus = ref<'all' | AgentRunDebugItem['status']>('all')
const selectedModel = ref('all')
const selectedTimeRange = ref<'all' | 'day' | 'week'>('all')
const showContentSkeleton = computed(() => isLoading.value || isFilterTransitioning.value)

const modelOptions = computed(() => [
  { label: '全部模型', value: 'all' },
  ...Array.from(new Set(runs.value.map((run) => run.modelName))).map((modelName) => ({
    label: modelName,
    value: modelName,
  })),
])
const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '排队中', value: 'pending' },
  { label: '执行中', value: 'processing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
]
const workflowOptions: { label: string; value: 'all' | AgentWorkflowType }[] = [
  { label: '全部工作流', value: 'all' },
  { label: 'JD 匹配分析', value: 'job_analysis' },
  { label: '面试蓝图', value: 'interview_plan' },
  { label: '回答评估', value: 'interview_turn' },
  { label: '单题深度点评', value: 'interview_deep_evaluation' },
  { label: '整场复盘', value: 'interview_final_summary' },
  { label: '真实复盘提取', value: 'review_extraction' },
  { label: '求职策略', value: 'action_strategy' },
]
const timeOptions = [
  { label: '全部时间', value: 'all' },
  { label: '最近 24 小时', value: 'day' },
  { label: '最近 7 天', value: 'week' },
]
const filteredRuns = computed(() => {
  const now = Date.now()
  const rangeMs =
    selectedTimeRange.value === 'day' ? 86_400_000 : selectedTimeRange.value === 'week' ? 604_800_000 : null
  return runs.value.filter((run) => {
    if (selectedStatus.value !== 'all' && run.status !== selectedStatus.value) return false
    if (selectedModel.value !== 'all' && run.modelName !== selectedModel.value) return false
    return !rangeMs || now - new Date(run.startedAt).getTime() <= rangeMs
  })
})

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
  return { pending: '排队中', processing: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消' }[status]
}

function statusColor(status: AgentRunDebugItem['status']) {
  const colors = {
    pending: 'warning',
    processing: 'primary',
    completed: 'success',
    failed: 'error',
    cancelled: 'neutral',
  } as const
  return colors[status]
}

function workflowLabel(workflowType: AgentWorkflowType) {
  return {
    job_analysis: 'JD 匹配分析',
    interview_plan: '面试蓝图',
    interview_turn: '回答评估',
    interview_deep_evaluation: '单题深度点评',
    interview_final_summary: '整场复盘',
    review_extraction: '真实复盘提取',
    action_strategy: '求职策略',
  }[workflowType]
}

function opportunityLabel(run: AgentRunDebugItem) {
  if (run.company && run.jobTitle) return `${run.company} · ${run.jobTitle}`
  return run.company ?? run.jobTitle ?? '未关联岗位'
}

function runScopeLabel(run: AgentRunDebugItem) {
  if (run.workflowType !== 'interview_turn' && run.workflowType !== 'interview_deep_evaluation') {
    return workflowLabel(run.workflowType)
  }

  const questionNumber = run.mainQuestionNumber ?? run.turnSequenceNumber
  return questionNumber ? `第 ${questionNumber} 题${workflowLabel(run.workflowType)}` : workflowLabel(run.workflowType)
}

function processingTitle(workflowType: AgentWorkflowType) {
  return {
    job_analysis: '模型正在生成 JD 匹配分析',
    interview_plan: '模型正在生成面试蓝图与第一题',
    interview_turn: '模型正在评估回答并生成下一题',
    interview_deep_evaluation: '模型正在生成单题深度点评',
    interview_final_summary: '模型正在生成整场面试复盘',
    review_extraction: '模型正在提取真实复盘文本',
    action_strategy: '模型正在生成求职策略文案',
  }[workflowType]
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function formatValidationPath(path: Array<string | number>) {
  if (!path.length) return '$（完整输出）'

  return path.reduce<string>((result, part) => {
    if (typeof part === 'number' || /^\d+$/.test(String(part))) return `${result}[${part}]`
    return result ? `${result}.${part}` : String(part)
  }, '')
}

const validationFieldDescriptions: Record<string, string> = {
  $: '模型本次返回的完整 JSON 结构。',
  matchScore: '简历与岗位的综合匹配分数，范围为 0～100。',
  recommendation: '根据综合匹配分数得到的投递建议等级。',
  summary: '对当前分析或评估结果的简要结论。',
  locationMatch: '候选人意向城市与岗位工作地点的匹配判断。',
  scoreBreakdown: '六个固定匹配维度的权重、得分、依据和原因。',
  requirementMatches: '逐条对照 JD 要求与简历证据的匹配结果。',
  strengths: '从简历与回答中确认的优势证据。',
  gaps: '与岗位要求相比仍存在的风险或能力缺口。',
  resumeSuggestions: '根据 JD 匹配结果给出的简历优化建议。',
  interviewFocus: '后续面试中值得重点验证的主题。',
  difficultyRubric: '结合当前岗位定义的基础、标准和进阶难度标准。',
  topics: '本轮模拟面试计划覆盖的能力主题。',
  'topics.evaluationPoints': '该主题下需要通过候选人回答验证的能力证据点。',
  firstQuestion: '面试计划生成的第一道问题、目标评估点和两级提示。',
  'firstQuestion.topicKey': '第一题所属主题，必须引用本次计划中的主题 key。',
  'firstQuestion.targetEvaluationPointKeys': '第一题准备验证的评估点 key 列表。',
  'firstQuestion.subQuestions': '复合问题中需要候选人分别回答的 2～3 个子问题。',
  inputClassification: '判断候选人输入是正式回答、明确不会、澄清请求还是跑题内容。',
  answerEvidence: '围绕当前问题评估点生成的回答证据与评分依据。',
  'answerEvidence.pointResults': '逐项说明目标评估点是否覆盖、对应证据和得分。',
  'answerEvidence.communication': '回答清晰度、结构性和简洁度等通用表达证据。',
  nextAction: '决定继续追问、进入下一主题、澄清问题、引导回题或结束面试。',
  nextQuestion: '回答评估完成后准备生成的下一道问题。',
  clarificationResponse: '候选人请求澄清或回答跑题时，面试官给出的解释或引导。',
  sessionEvaluationPatch: '本轮回答对整场面试累计能力结论和分数的增量更新。',
  'sessionEvaluationPatch.topicEvaluation': '当前能力主题在本轮回答后的掌握度更新。',
}

function describeValidationField(path: Array<string | number>) {
  if (!path.length) return validationFieldDescriptions.$

  const normalizedParts = path.filter((part) => typeof part !== 'number' && !/^\d+$/.test(String(part))).map(String)
  for (let length = normalizedParts.length; length > 0; length -= 1) {
    const description = validationFieldDescriptions[normalizedParts.slice(0, length).join('.')]
    if (description) return description
  }

  return '该字段用于约束模型的结构化输出，确保后端能够安全解析并继续业务流程。'
}

function readValidationValueFromRawOutput(rawOutput: string | null, path: Array<string | number>) {
  if (!rawOutput || !path.length) return undefined

  try {
    const normalized = rawOutput
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    const parsed = JSON.parse(normalized) as unknown
    return path.reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object') return undefined
      return (value as Record<string | number, unknown>)[key]
    }, parsed)
  } catch {
    return undefined
  }
}

function formatReceivedValidationValue(
  issue: { path: Array<string | number>; receivedValue?: unknown },
  rawOutput: string | null,
) {
  const value = Object.prototype.hasOwnProperty.call(issue, 'receivedValue')
    ? issue.receivedValue
    : readValidationValueFromRawOutput(rawOutput, issue.path)
  if (value === undefined) return '模型未返回该字段'

  const formatted = JSON.stringify(value)
  return formatted ?? String(value)
}

async function copyText(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: message, color: 'success', icon: 'i-lucide-copy-check' })
  } catch {
    toast.add({ title: '复制失败，请检查浏览器权限', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

let isListRequestInFlight = false
let shouldReloadListAfterCurrent = false
let isAgentRunPageUnmounted = false

async function loadRuns(options: { initial?: boolean; filterChange?: boolean } = {}) {
  if (isListRequestInFlight) {
    if (options.filterChange) {
      shouldReloadListAfterCurrent = true
      isFilterTransitioning.value = true
    }
    return
  }

  isListRequestInFlight = true
  if (options.initial) isLoading.value = true
  else if (options.filterChange) isFilterTransitioning.value = true
  else isRefreshing.value = true
  errorMessage.value = ''
  const requestedWorkflow = selectedWorkflow.value

  try {
    const nextRuns = await agentRunApi.getAgentRuns({
      workflowType: requestedWorkflow === 'all' ? undefined : requestedWorkflow,
    })
    if (isAgentRunPageUnmounted) return
    if (requestedWorkflow !== selectedWorkflow.value) {
      shouldReloadListAfterCurrent = true
      return
    }

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

      // 详情首次加载尚未结束时不要再启动静默刷新；否则新的请求会递增
      // latestDetailRequestId，让旧请求即使成功返回也无法解除骨架屏。
      if (isSelectedRunStale && !isDetailLoading.value) {
        await loadRunDetail(selectedRunId.value, { silent: true })
      }
    }
  } catch (error) {
    if (isAgentRunPageUnmounted || requestedWorkflow !== selectedWorkflow.value) return
    errorMessage.value = error instanceof Error ? error.message : '无法加载 AgentRun'
  } finally {
    isListRequestInFlight = false
    if (shouldReloadListAfterCurrent && !isAgentRunPageUnmounted) {
      shouldReloadListAfterCurrent = false
      await loadRuns({ filterChange: true })
    } else {
      isLoading.value = false
      isRefreshing.value = false
      isFilterTransitioning.value = false
    }
  }
}

let latestDetailRequestId = 0
async function loadRunDetail(runId: string, options: { silent?: boolean } = {}) {
  const requestId = ++latestDetailRequestId
  if (!options.silent) isDetailLoading.value = true

  try {
    const detail = await agentRunApi.getAgentRun(runId)
    if (requestId !== latestDetailRequestId || selectedRunId.value !== runId) return
    selectedRun.value = detail
  } catch (error) {
    if (requestId !== latestDetailRequestId) return
    errorMessage.value = error instanceof Error ? error.message : '无法加载执行详情'
  } finally {
    if (!options.silent && requestId === latestDetailRequestId) isDetailLoading.value = false
  }
}

async function selectRun(runId: string) {
  if (selectedRunId.value === runId && selectedRun.value) return
  selectedRunId.value = runId
  await loadRunDetail(runId)
}

watch(selectedWorkflow, () => {
  selectedRunId.value = null
  selectedRun.value = null
  void loadRuns({ filterChange: true })
})

let localFilterTransitionTimer: number | null = null
watch([selectedStatus, selectedModel, selectedTimeRange], async () => {
  isFilterTransitioning.value = true
  if (localFilterTransitionTimer) window.clearTimeout(localFilterTransitionTimer)

  await Promise.resolve()
  if (selectedRunId.value && !filteredRuns.value.some((run) => run.id === selectedRunId.value)) {
    selectedRunId.value = null
    selectedRun.value = null
  }

  localFilterTransitionTimer = window.setTimeout(() => {
    if (!isListRequestInFlight) isFilterTransitioning.value = false
  }, 120)
})

let refreshTimer: number | null = null
onMounted(() => {
  void loadRuns({ initial: true })
  refreshTimer = window.setInterval(() => void loadRuns(), 3_000)
})
onBeforeUnmount(() => {
  isAgentRunPageUnmounted = true
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (localFilterTransitionTimer) window.clearTimeout(localFilterTransitionTimer)
})
</script>

<template>
  <main class="min-h-screen bg-[var(--app-bg)] p-4 text-default sm:p-6 lg:h-screen lg:overflow-hidden">
    <section class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1600px] flex-col gap-4 lg:h-full lg:min-h-0">
      <header class="app-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">PERCH / developer</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-highlighted">AgentRun 调试台</h1>
          <p class="mt-1 text-sm text-muted">
            独立观察模型调用、重试、结构化输出与失败原因。每 3 秒刷新轻量状态，详情按需加载。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="hidden text-xs text-muted sm:inline">{{
            lastUpdatedAt ? `更新于 ${formatTime(lastUpdatedAt.toISOString())}` : ''
          }}</span>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="isRefreshing"
            @click="loadRuns()"
          >
            刷新
          </UButton>
          <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="router.push('/opportunities')">
            返回工作台
          </UButton>
        </div>
      </header>

      <div v-if="errorMessage" class="app-panel-muted p-5 text-sm text-error">{{ errorMessage }}</div>

      <section class="app-toolbar flex flex-wrap items-center gap-2 p-3">
        <USelect v-model="selectedWorkflow" :items="workflowOptions" size="sm" class="w-40" aria-label="按工作流筛选" />
        <USelect v-model="selectedStatus" :items="statusOptions" size="sm" class="w-32" aria-label="按状态筛选" />
        <USelect
          v-model="selectedModel"
          :items="modelOptions"
          size="sm"
          class="min-w-40 flex-1 sm:max-w-56"
          aria-label="按模型筛选"
        />
        <USelect v-model="selectedTimeRange" :items="timeOptions" size="sm" class="w-36" aria-label="按时间筛选" />
        <span class="ml-auto text-xs text-muted">{{ filteredRuns.length }} 条记录</span>
      </section>

      <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.65fr)]">
        <section class="app-card flex min-h-96 min-w-0 flex-col overflow-hidden lg:min-h-0">
          <div class="border-b border-default px-5 py-4">
            <h2 class="text-sm font-semibold text-highlighted">最近执行</h2>
          </div>
          <div v-if="showContentSkeleton" class="min-h-0 flex-1 space-y-3 overflow-hidden p-4">
            <USkeleton v-for="index in 7" :key="index" class="h-16 w-full rounded-xl" />
          </div>
          <div
            v-else-if="filteredRuns.length === 0"
            class="flex min-h-72 flex-1 items-center justify-center px-6 text-center text-sm text-muted"
          >
            当前筛选条件下没有执行记录。
          </div>
          <div v-else class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            <button
              v-for="run in filteredRuns"
              :key="run.id"
              type="button"
              class="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-elevated"
              :class="selectedRunId === run.id ? 'bg-elevated ring-1 ring-primary/35' : ''"
              @click="selectRun(run.id)"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="truncate text-sm font-medium text-highlighted">{{ opportunityLabel(run) }}</p>
                <UBadge :color="statusColor(run.status)" variant="subtle" :label="statusLabel(run.status)" />
              </div>
              <div class="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                <span class="truncate"
                  >{{ runScopeLabel(run) }} · 第 {{ run.attemptNumber }} 次 · {{ run.modelName }}</span
                >
                <span class="shrink-0">{{ formatDuration(run.durationMs) }}</span>
              </div>
            </button>
          </div>
        </section>

        <section class="app-card min-h-96 min-w-0 overflow-hidden p-5 lg:min-h-0 lg:overflow-y-auto">
          <div v-if="showContentSkeleton || isDetailLoading" class="space-y-4">
            <USkeleton class="h-7 w-64" /><USkeleton class="h-24 w-full rounded-xl" /><USkeleton
              class="h-56 w-full rounded-xl"
            />
          </div>
          <div v-else-if="!selectedRun" class="flex min-h-80 items-center justify-center text-sm text-muted">
            从左侧选择一条执行记录，查看输入、原始输出和结构化结果。
          </div>
          <template v-else>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-highlighted">{{ opportunityLabel(selectedRun) }}</h2>
                <p class="mt-1 text-xs text-muted">
                  {{ selectedRun.modelName }} · {{ selectedRun.promptVersion }} · 第 {{ selectedRun.attemptNumber }} 次
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="outline" :label="runScopeLabel(selectedRun)" />
                <UBadge
                  :color="statusColor(selectedRun.status)"
                  variant="subtle"
                  :label="statusLabel(selectedRun.status)"
                />
              </div>
            </div>
            <div class="mt-5 grid gap-3 sm:grid-cols-3">
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">耗时</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ formatDuration(selectedRun.durationMs) }}</p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">Token</p>
                <p class="mt-1 text-sm font-medium text-highlighted">
                  {{ selectedRun.tokenUsage?.totalTokens ?? '—' }}
                </p>
              </div>
              <div class="app-panel-muted p-3">
                <p class="text-xs text-muted">完成时间</p>
                <p class="mt-1 text-sm font-medium text-highlighted">{{ formatTime(selectedRun.finishedAt) }}</p>
              </div>
            </div>
            <details class="app-panel-muted mt-4 overflow-hidden p-4">
              <summary class="cursor-pointer text-sm font-medium text-highlighted">关联上下文</summary>
              <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt class="text-muted">Run ID</dt>
                  <dd class="mt-1 break-all font-mono text-highlighted">{{ selectedRun.id }}</dd>
                </div>
                <div v-if="selectedRun.analysisId">
                  <dt class="text-muted">Analysis ID</dt>
                  <dd class="mt-1 break-all font-mono text-highlighted">{{ selectedRun.analysisId }}</dd>
                </div>
                <div v-if="selectedRun.interviewSessionId">
                  <dt class="text-muted">Session ID</dt>
                  <dd class="mt-1 break-all font-mono text-highlighted">{{ selectedRun.interviewSessionId }}</dd>
                </div>
                <div v-if="selectedRun.interviewTurnId">
                  <dt class="text-muted">Turn ID</dt>
                  <dd class="mt-1 break-all font-mono text-highlighted">{{ selectedRun.interviewTurnId }}</dd>
                </div>
              </dl>
            </details>
            <ol class="mt-5 grid gap-2 sm:grid-cols-3" aria-label="执行时间线">
              <li class="app-panel-muted p-3 text-xs">
                <p class="font-medium text-highlighted">1 · 已创建</p>
                <p class="mt-1 text-muted">{{ formatTime(selectedRun.startedAt) }}</p>
              </li>
              <li class="app-panel-muted p-3 text-xs">
                <p class="font-medium text-highlighted">2 · 模型调用</p>
                <p class="mt-1 text-muted">{{ selectedRun.status === 'pending' ? '等待开始' : '已发起请求' }}</p>
              </li>
              <li class="app-panel-muted p-3 text-xs">
                <p class="font-medium text-highlighted">3 · {{ statusLabel(selectedRun.status) }}</p>
                <p class="mt-1 text-muted">{{ formatTime(selectedRun.finishedAt) }}</p>
              </li>
            </ol>
            <div
              v-if="selectedRun.status === 'pending' || selectedRun.status === 'processing'"
              class="mt-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"
            >
              <UIcon name="i-lucide-loader-circle" class="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
              <div>
                <p class="text-sm font-medium text-highlighted">{{ processingTitle(selectedRun.workflowType) }}</p>
                <p class="mt-1 text-xs leading-5 text-muted">
                  当前使用非流式 JSON
                  请求：模型完成前不会返回可展示的原始输出或思考内容；完成后此处会自动刷新为最终响应。
                </p>
              </div>
            </div>
            <div
              v-if="selectedRun.error"
              class="mt-4 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error"
            >
              <p class="font-medium">{{ selectedRun.error.code }}</p>
              <p class="mt-1 leading-6">{{ selectedRun.error.message }}</p>
              <div v-if="selectedRun.error.validationIssues?.length" class="mt-3 grid gap-2">
                <div
                  v-for="(issue, index) in selectedRun.error.validationIssues"
                  :key="`${formatValidationPath(issue.path)}-${issue.code}-${index}`"
                  class="rounded-lg border border-error/20 bg-[var(--app-surface)] p-3 text-xs"
                >
                  <p class="flex flex-wrap items-baseline gap-2">
                    <span class="font-medium text-error">失败字段</span>
                    <code class="break-all text-highlighted">{{ formatValidationPath(issue.path) }}</code>
                  </p>
                  <p class="mt-1 flex flex-wrap items-baseline gap-2 leading-5">
                    <span class="font-medium text-error">{{ issue.code === 'custom' ? '业务约束' : '期望格式' }}</span>
                    <span class="text-muted">{{ issue.message }}</span>
                  </p>
                  <p class="mt-1 flex items-start gap-2 leading-5">
                    <span class="shrink-0 font-medium text-error">实际返回</span>
                    <code class="break-all text-muted">{{
                      formatReceivedValidationValue(issue, selectedRun.rawOutput)
                    }}</code>
                  </p>
                  <p class="mt-1 flex items-start gap-2 leading-5">
                    <span class="shrink-0 font-medium text-error">字段用途</span>
                    <span class="text-muted">{{ describeValidationField(issue.path) }}</span>
                  </p>
                </div>
              </div>
            </div>
            <div class="mt-5 grid gap-4 xl:grid-cols-2">
              <details class="app-panel-muted overflow-hidden p-4" open>
                <summary class="cursor-pointer text-sm font-medium text-highlighted">传给模型的业务输入</summary>
                <div class="mt-3 flex justify-end">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyText(formatJson(selectedRun.input), '输入已复制')"
                    >复制</UButton
                  >
                </div>
                <pre class="app-code-block mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-muted">{{
                  formatJson(selectedRun.input)
                }}</pre>
              </details>
              <details class="app-panel-muted overflow-hidden p-4" open>
                <summary class="cursor-pointer text-sm font-medium text-highlighted">原始模型输出</summary>
                <div class="mt-3 flex justify-end">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyText(selectedRun.rawOutput ?? '', '原始输出已复制')"
                    >复制</UButton
                  >
                </div>
                <pre class="app-code-block mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-muted">{{
                  selectedRun.rawOutput ?? '暂无输出'
                }}</pre>
              </details>
            </div>
            <details v-if="selectedRun.parsedOutput" class="app-panel-muted mt-4 overflow-hidden p-4">
              <summary class="cursor-pointer text-sm font-medium text-highlighted">通过校验后的结构化结果</summary>
              <div class="mt-3 flex justify-end">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyText(formatJson(selectedRun.parsedOutput), '结构化结果已复制')"
                  >复制</UButton
                >
              </div>
              <pre class="app-code-block mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-muted">{{
                formatJson(selectedRun.parsedOutput)
              }}</pre>
            </details>
          </template>
        </section>
      </div>
    </section>
  </main>
</template>
