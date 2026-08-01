<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { actionStrategyApi } from '@/services/action-strategy'
import { useBackgroundTaskStore, useSettingsStore } from '@/stores'
import type { ActionStrategyOverview, StrategyAction, StrategyPriority } from '@/types/action-strategy'
import StrategySubnav from './components/StrategySubnav.vue'

defineOptions({ name: 'ActionStrategyPage' })

const toast = useToast()
const settingsStore = useSettingsStore()
const backgroundTaskStore = useBackgroundTaskStore()
const overview = ref<ActionStrategyOverview | null>(null)
const isLoading = ref(true)
const isRefreshing = ref(false)
const isGenerating = ref(false)
const errorMessage = ref<string | null>(null)
const isActionsExpanded = ref(false)
let pollTimer: number | null = null
let lastLoadedAt = 0
const backgroundRefreshTtlMs = 30_000

const hasModelConfig = computed(() =>
  Boolean(settingsStore.llm.baseUrl.trim() && settingsStore.llm.modelName.trim() && settingsStore.llm.apiKey.trim()),
)
const isEmpty = computed(
  () =>
    Boolean(overview.value) &&
    overview.value!.sourceSummary.opportunityCount === 0 &&
    overview.value!.actions.length === 0 &&
    overview.value!.capabilityActions.length === 0,
)
const visibleActions = computed(() => {
  const actions = overview.value?.actions ?? []
  return isActionsExpanded.value ? actions : actions.slice(0, 5)
})
const hasMoreActions = computed(() => (overview.value?.actions.length ?? 0) > 5)

function clearPoll() {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll() {
  clearPoll()
  if (overview.value?.ai.freshness !== 'generating') return
  pollTimer = window.setTimeout(() => void loadOverview(true), 5000)
}

async function loadOverview(background = false) {
  if (background) isRefreshing.value = true
  else isLoading.value = true
  errorMessage.value = null
  try {
    overview.value = await actionStrategyApi.getOverview()
    lastLoadedAt = Date.now()
    if (overview.value.ai.freshness === 'generating' && overview.value.ai.snapshotId) {
      backgroundTaskStore.register(
        { type: 'action_strategy', snapshotId: overview.value.ai.snapshotId },
        { primary: '求职策略' },
      )
    }
    schedulePoll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '行动策略暂时无法加载。'
    if (!overview.value) toast.add({ title: '行动策略加载失败', description: errorMessage.value, color: 'error' })
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

async function generate() {
  if (!hasModelConfig.value || isGenerating.value) {
    if (!hasModelConfig.value) {
      toast.add({ title: '请先配置模型', description: '行动策略只在你主动点击更新时调用模型。', color: 'warning' })
    }
    return
  }

  isGenerating.value = true
  try {
    const result = await actionStrategyApi.generate(settingsStore.llm)
    overview.value = result.overview
    if (result.snapshotId && (result.status === 'pending' || result.status === 'processing')) {
      backgroundTaskStore.register({ type: 'action_strategy', snapshotId: result.snapshotId }, { primary: '求职策略' })
    }
    toast.add({ title: '行动策略已提交', description: 'AI 文案会在后台生成，规则行动仍可立即使用。', color: 'success' })
    schedulePoll()
  } catch (error) {
    toast.add({
      title: '行动策略生成失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    isGenerating.value = false
  }
}

function priorityLabel(priority: StrategyPriority) {
  return { urgent: '紧急', high: '高优先级', medium: '中优先级', low: '低优先级' }[priority]
}

function priorityClass(priority: StrategyPriority) {
  return {
    urgent: 'border-[#E2726A]/35 bg-[#E2726A]/10 text-[#E2726A]',
    high: 'border-[#ffa235]/35 bg-[#ffa235]/10 text-[#ffa235]',
    medium: 'border-[#5E83F5]/35 bg-[#5E83F5]/10 text-[#5E83F5]',
    low: 'border-[#BFBFBF]/45 bg-[#BFBFBF]/10 text-[var(--app-text-muted)]',
  }[priority]
}

function actionDestination(action: StrategyAction) {
  return action.cta.to ?? '/opportunities'
}

onMounted(() => void loadOverview())
onActivated(() => {
  if (!overview.value) return
  if (overview.value.ai.freshness === 'generating') {
    schedulePoll()
    return
  }
  if (Date.now() - lastLoadedAt >= backgroundRefreshTtlMs) void loadOverview(true)
})
onDeactivated(clearPoll)
onBeforeUnmount(clearPoll)
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-6">
    <StrategySubnav />

    <div v-if="isLoading" class="space-y-5" aria-busy="true">
      <div class="app-panel h-44 animate-pulse bg-[var(--app-surface-muted)]" />
      <div class="grid gap-5 lg:grid-cols-2">
        <div class="app-panel h-80 animate-pulse bg-[var(--app-surface-muted)]" />
        <div class="app-panel h-80 animate-pulse bg-[var(--app-surface-muted)]" />
      </div>
    </div>

    <div
      v-else-if="errorMessage && !overview"
      class="app-panel flex min-h-[24rem] flex-col items-center justify-center px-6 text-center"
    >
      <UIcon name="i-lucide-circle-alert" class="size-8 text-[var(--app-danger)]" />
      <h1 class="mt-4 text-lg font-semibold text-highlighted">行动策略暂时无法加载</h1>
      <p class="mt-2 max-w-md text-sm text-muted">{{ errorMessage }}</p>
      <UButton class="mt-5" icon="i-lucide-refresh-cw" @click="loadOverview()">重新加载</UButton>
    </div>

    <template v-else-if="overview">
      <header class="app-panel p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-5">
          <div class="max-w-2xl">
            <p class="app-section-kicker">Job strategy</p>
            <h1 class="mt-2 text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">行动策略</h1>
            <p class="mt-3 text-sm leading-6 text-muted">
              先由规则计算可执行行动，再由 AI 在有边界的候选集合中生成解释。不会自动投递、自动终止机会，也不会因为 AI
              失败而隐藏规则建议。
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span v-if="isRefreshing" class="text-xs text-muted" role="status">
              <UIcon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" />同步中
            </span>
            <UButton
              icon="i-lucide-sparkles"
              :loading="isGenerating"
              :disabled="!hasModelConfig || overview.ai.freshness === 'generating'"
              @click="generate"
            >
              {{ overview.ai.freshness === 'fresh' ? '更新 AI 建议' : '生成 AI 建议' }}
            </UButton>
          </div>
        </div>

        <div
          v-if="overview.ai.freshness === 'generating'"
          class="mt-5 flex items-center gap-2 rounded-xl bg-[var(--app-accent-soft)] px-3 py-2.5 text-xs text-primary"
          role="status"
        >
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />AI 文案正在后台生成，规则行动已可使用。
        </div>
        <div
          v-else-if="overview.ai.freshness === 'failed'"
          class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2726A]/30 bg-[#E2726A]/8 px-3 py-2.5 text-xs"
        >
          <span class="text-[var(--app-danger)]"
            >AI 文案生成失败：{{ overview.ai.error?.message ?? '可稍后重试。' }}</span
          >
          <UButton size="xs" color="neutral" variant="outline" :disabled="!hasModelConfig" @click="generate"
            >重试</UButton
          >
        </div>
        <div
          v-else-if="!hasModelConfig"
          class="mt-5 flex items-center gap-2 rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5 text-xs text-muted"
        >
          <UIcon name="i-lucide-info" class="size-4" />尚未配置模型；规则行动仍然可用，配置模型后可生成解释性建议。
        </div>
      </header>

      <div v-if="isEmpty" class="app-panel flex min-h-[26rem] flex-col items-center justify-center px-6 text-center">
        <UIcon name="i-lucide-compass" class="size-9 text-primary" />
        <h2 class="mt-4 text-lg font-semibold text-highlighted">还没有可执行的求职行动</h2>
        <p class="mt-2 max-w-md text-sm leading-6 text-muted">
          新增机会、完成 JD 分析或完成模拟面试后，这里会根据已有证据给出下一步建议。
        </p>
        <UButton to="/opportunities" class="mt-5" icon="i-lucide-briefcase-business">去查看机会</UButton>
      </div>

      <template v-else>
        <section
          v-if="overview.ai.summary"
          class="app-panel border-[color-mix(in_srgb,var(--app-accent-strong)_35%,var(--app-border))] p-6"
        >
          <div class="flex items-start gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-accent-soft)] text-primary"
            >
              <UIcon name="i-lucide-sparkles" class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-primary">AI 当前总结</p>
              <h2 class="mt-1 text-lg font-semibold text-highlighted">{{ overview.ai.summary.headline }}</h2>
              <p class="mt-2 text-sm leading-6 text-muted">{{ overview.ai.summary.summary }}</p>
            </div>
          </div>
        </section>

        <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <section class="app-card min-w-0 p-5 sm:p-6">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="app-section-kicker">Next actions</p>
                <h2 class="mt-1 text-base font-semibold text-highlighted">优先行动</h2>
                <p class="mt-1 text-xs leading-5 text-muted">这些行动由当前机会状态、时间和已有分析确定生成。</p>
              </div>
              <span class="text-[11px] text-muted">{{ overview.actions.length }} 条</span>
            </div>

            <div v-if="visibleActions.length" class="mt-5 space-y-3">
              <article
                v-for="action in visibleActions"
                :key="action.key"
                class="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="mt-0.5 rounded-full border px-2 py-1 text-[10px] font-semibold"
                    :class="priorityClass(action.priority)"
                    >{{ priorityLabel(action.priority) }}</span
                  >
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <h3 class="text-sm font-semibold text-highlighted">{{ action.title }}</h3>
                      <RouterLink
                        :to="actionDestination(action)"
                        class="shrink-0 text-xs font-medium text-primary hover:underline"
                        >{{ action.cta.label }} →</RouterLink
                      >
                    </div>
                    <p class="mt-1 text-xs leading-5 text-muted">{{ action.company }} · {{ action.jobTitle }}</p>
                    <p class="mt-3 text-sm leading-6 text-highlighted">{{ action.reason }}</p>
                    <p class="mt-2 text-xs leading-5 text-muted">下一步：{{ action.suggestedStep }}</p>
                  </div>
                </div>
              </article>
            </div>
            <p v-else class="app-panel-muted mt-5 border-dashed p-6 text-center text-sm text-muted">
              目前没有需要立即处理的机会行动。
            </p>
            <div v-if="hasMoreActions" class="mt-4 flex justify-center">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="isActionsExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click="isActionsExpanded = !isActionsExpanded"
              >
                {{ isActionsExpanded ? '收起行动' : `展开全部（${overview.actions.length} 条）` }}
              </UButton>
            </div>
          </section>

          <section class="app-card min-w-0 p-5 sm:p-6">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="app-section-kicker">Capability focus</p>
                <h2 class="mt-1 text-base font-semibold text-highlighted">训练重点</h2>
                <p class="mt-1 text-xs leading-5 text-muted">来自历史薄弱项和模拟面试证据。</p>
              </div>
              <span class="text-[11px] text-muted">{{ overview.capabilityActions.length }} 项</span>
            </div>
            <div v-if="overview.capabilityActions.length" class="mt-5 space-y-3">
              <article
                v-for="action in overview.capabilityActions"
                :key="action.key"
                class="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="truncate text-sm font-semibold text-highlighted">{{ action.capabilityLabel }}</h3>
                    <p class="mt-2 text-xs leading-5 text-muted">{{ action.reason }}</p>
                  </div>
                  <RouterLink
                    :to="actionDestination(action)"
                    class="shrink-0 text-xs font-medium text-primary hover:underline"
                    >去训练 →</RouterLink
                  >
                </div>
              </article>
            </div>
            <p v-else class="app-panel-muted mt-5 border-dashed p-6 text-center text-sm text-muted">
              还没有稳定的能力补强信号。
            </p>
          </section>
        </div>
      </template>
    </template>
  </section>
</template>
