<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useInterviewStore, useOpportunityStore, useResumeStore } from '@/stores'
import { dashboardApi } from '@/services/dashboard'
import type { DashboardOverview, DashboardWidgetKey, DashboardWidgetVisibility } from '@/types/dashboard'
import type { JobOpportunityStatus } from '@/types/opportunity'
import DashboardAbilityCard from './components/DashboardAbilityCard.vue'
import DashboardActivityCard from './components/DashboardActivityCard.vue'
import DashboardRingChart from './components/DashboardRingChart.vue'

const resumeStore = useResumeStore()
const opportunityStore = useOpportunityStore()
const interviewStore = useInterviewStore()
const { resumes, currentResume, currentVersion, isLoading: isResumeLoading } = storeToRefs(resumeStore)
const { opportunities, analysisTasks, isInitialLoading: isOpportunityLoading } = storeToRefs(opportunityStore)

const dashboardOverview = ref<DashboardOverview | null>(null)
const isDashboardLoading = ref(true)
const dashboardError = ref<string | null>(null)
const dashboardLoadSequence = ref(0)
const dashboardWidgetStorageKey = 'agent-seek-employment:dashboard-widgets'

const defaultWidgetVisibility: DashboardWidgetVisibility = {
  ability_insights: true,
  opportunity_pipeline: true,
  match_distribution: true,
  recent_activities: true,
}

const widgetOptions: Array<{ key: DashboardWidgetKey; label: string }> = [
  { key: 'ability_insights', label: '能力证据摘要' },
  { key: 'opportunity_pipeline', label: '求职流程分布' },
  { key: 'match_distribution', label: 'JD 匹配分布' },
  { key: 'recent_activities', label: '最近动态' },
]

const widgetVisibility = ref<DashboardWidgetVisibility>(readWidgetVisibility())

const isLoading = computed(() => isResumeLoading.value || isOpportunityLoading.value)
const analyzingCount = computed(
  () => analysisTasks.value.filter((task) => task.status === 'pending' || task.status === 'processing').length,
)
const followUpCount = computed(
  () =>
    opportunities.value.filter((item) => ['applied', 'written_test', 'interviewing', 'oc'].includes(item.status))
      .length,
)
const interviewCount = computed(() => Object.keys(interviewStore.sessionsById).length)
const latestResumeLabel = computed(() => {
  if (!currentResume.value || !currentVersion.value) return '尚未创建简历'
  return `${currentResume.value.title} · V${currentVersion.value.versionNumber}`
})
const stats = computed(() => [
  {
    label: '正在分析',
    value: analyzingCount.value,
    hint: '后台持续生成匹配结论',
    icon: 'i-lucide-sparkles',
    to: '/opportunities',
  },
  {
    label: '需要跟进',
    value: followUpCount.value,
    hint: '投递、笔试、面试与 OC 阶段',
    icon: 'i-lucide-route',
    to: '/opportunities',
  },
  {
    label: '模拟面试',
    value: interviewCount.value,
    hint: '在机会详情中开始训练',
    icon: 'i-lucide-messages-square',
    to: '/opportunities',
  },
])

const pipelineColors: Record<JobOpportunityStatus, string> = {
  // ECharts 在 Canvas 中无法解析 CSS var()，这里必须传入具体颜色值。
  pending_apply: '#BFBFBF',
  applied: '#5E83F5',
  written_test: '#ffa235',
  interviewing: '#8A5EED',
  oc: '#fdd845',
  offered: '#22c55e',
  closed: '#ef4444',
}

const matchColors = {
  not_recommended: '#BFBFBF',
  risky: '#ffa235',
  worth_trying: '#22c55e',
  strong_match: '#8A5EED',
}

const pipelineSegments = computed(() =>
  (dashboardOverview.value?.opportunityPipeline.stages ?? []).map((item) => ({
    ...item,
    color: pipelineColors[item.key],
  })),
)

const matchSegments = computed(() =>
  (dashboardOverview.value?.matchDistribution.buckets ?? []).map((item) => ({
    ...item,
    color: matchColors[item.key],
  })),
)

const visibleWidgetCount = computed(() => Object.values(widgetVisibility.value).filter(Boolean).length)

function readWidgetVisibility(): DashboardWidgetVisibility {
  if (typeof localStorage === 'undefined') return { ...defaultWidgetVisibility }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(dashboardWidgetStorageKey) ?? '{}',
    ) as Partial<DashboardWidgetVisibility>
    return Object.fromEntries(
      Object.keys(defaultWidgetVisibility).map((key) => [
        key,
        typeof parsed[key as DashboardWidgetKey] === 'boolean'
          ? parsed[key as DashboardWidgetKey]
          : defaultWidgetVisibility[key as DashboardWidgetKey],
      ]),
    ) as DashboardWidgetVisibility
  } catch {
    return { ...defaultWidgetVisibility }
  }
}

function setWidgetVisibility(key: DashboardWidgetKey, event: Event) {
  const input = event.target as HTMLInputElement
  widgetVisibility.value = { ...widgetVisibility.value, [key]: input.checked }
}

async function loadDashboard() {
  const sequence = ++dashboardLoadSequence.value
  isDashboardLoading.value = true
  dashboardError.value = null

  try {
    const overview = await dashboardApi.getOverview()
    if (sequence === dashboardLoadSequence.value) dashboardOverview.value = overview
  } catch {
    if (sequence === dashboardLoadSequence.value) dashboardError.value = '首页概览暂时无法加载，请稍后重试。'
  } finally {
    if (sequence === dashboardLoadSequence.value) isDashboardLoading.value = false
  }
}

watch(
  widgetVisibility,
  (value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(dashboardWidgetStorageKey, JSON.stringify(value))
  },
  { deep: true },
)

onMounted(() => {
  void resumeStore.loadFromApi()
  void opportunityStore.loadOpportunities()
  void loadDashboard()
})
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-6">
    <div class="app-panel overflow-hidden p-6 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="max-w-2xl">
          <p class="app-section-kicker">今日工作台</p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
            让每一次求职准备，都有下一步
          </h1>
          <p class="mt-3 text-sm leading-6 text-muted">
            查看简历版本、岗位分析和训练记录，再决定今天最值得推进的一件事。
          </p>
        </div>
        <UButton to="/opportunities" icon="i-lucide-plus" class="shrink-0">新增 JD 分析</UButton>
      </div>

      <div class="app-panel-muted mt-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div class="min-w-0">
          <p class="text-xs font-medium text-muted">当前简历版本</p>
          <p class="mt-1 truncate text-sm font-semibold text-highlighted">{{ latestResumeLabel }}</p>
        </div>
        <UButton to="/resumes" color="neutral" variant="outline" size="sm" icon="i-lucide-file-pen-line"
          >管理简历</UButton
        >
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <article v-for="stat in stats" :key="stat.label" class="app-card p-5">
        <div class="flex items-start justify-between gap-3">
          <span class="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"
            ><UIcon :name="stat.icon" class="size-4"
          /></span>
          <RouterLink
            :to="stat.to"
            class="rounded-md text-xs text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60"
            >查看</RouterLink
          >
        </div>
        <p class="mt-5 text-sm text-muted">{{ stat.label }}</p>
        <USkeleton v-if="isLoading" class="mt-2 h-9 w-16 rounded-lg" />
        <p v-else class="mt-2 text-3xl font-semibold tracking-tight text-highlighted">{{ stat.value }}</p>
        <p class="mt-2 text-xs leading-5 text-muted">{{ stat.hint }}</p>
      </article>
    </div>

    <section class="space-y-4" aria-live="polite">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="app-section-kicker">数据概览</p>
          <h2 class="mt-1 text-lg font-semibold tracking-tight text-highlighted">把下一步放在证据上</h2>
          <p class="mt-1 text-sm text-muted">用 ECharts 展示求职流程和 JD 匹配的聚合分布。</p>
        </div>

        <UPopover :portal="true" :ui="{ content: 'app-popover-layer' }">
          <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-sliders-horizontal">显示模块</UButton>
          <template #content>
            <div class="w-64 p-3">
              <p class="text-xs font-semibold text-highlighted">首页模块</p>
              <p class="mt-1 text-xs leading-5 text-muted">可以隐藏暂时不想看的统计区块。</p>
              <div class="mt-3 space-y-2.5">
                <label
                  v-for="option in widgetOptions"
                  :key="option.key"
                  class="flex cursor-pointer items-center gap-2.5 text-sm text-highlighted"
                >
                  <input
                    type="checkbox"
                    class="size-4 rounded border-[var(--app-border-strong)] accent-[var(--app-accent-deep)]"
                    :checked="widgetVisibility[option.key]"
                    @change="setWidgetVisibility(option.key, $event)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>
          </template>
        </UPopover>
      </div>

      <div v-if="dashboardError" class="app-panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex items-start gap-3">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--app-danger)_12%,transparent)] text-[var(--app-danger)]"
          >
            <UIcon name="i-lucide-alert-circle" class="size-4" aria-hidden="true" />
          </span>
          <div>
            <p class="text-sm font-medium text-highlighted">首页概览加载失败</p>
            <p class="mt-1 text-xs text-muted">{{ dashboardError }}</p>
          </div>
        </div>
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" @click="loadDashboard"
          >重试</UButton
        >
      </div>

      <div v-else-if="isDashboardLoading" class="grid gap-4 lg:grid-cols-2">
        <div class="app-card min-h-[280px] p-5">
          <USkeleton class="h-5 w-32 rounded" /><USkeleton class="mt-3 h-4 w-64 rounded" /><USkeleton
            class="mt-8 h-36 rounded-2xl"
          />
        </div>
        <div class="app-card min-h-[280px] p-5">
          <USkeleton class="h-5 w-32 rounded" /><USkeleton class="mt-3 h-4 w-56 rounded" /><USkeleton
            class="mt-8 h-36 rounded-2xl"
          />
        </div>
      </div>

      <template v-else-if="dashboardOverview">
        <DashboardAbilityCard v-if="widgetVisibility.ability_insights" :ability="dashboardOverview.ability" />

        <div
          v-if="widgetVisibility.opportunity_pipeline || widgetVisibility.match_distribution"
          class="grid gap-4 lg:grid-cols-2"
        >
          <DashboardRingChart
            v-if="widgetVisibility.opportunity_pipeline"
            title="求职流程分布"
            subtitle="按当前机会所处阶段统计。"
            :total="dashboardOverview.opportunityPipeline.total"
            :segments="pipelineSegments"
            empty-label="暂无机会"
          />
          <DashboardRingChart
            v-if="widgetVisibility.match_distribution"
            title="JD 匹配分布"
            subtitle="只统计已完成分析的机会，避免把待分析记录混入分布。"
            :total="dashboardOverview.matchDistribution.completedCount"
            :segments="matchSegments"
            empty-label="暂无完成分析"
          />
        </div>

        <DashboardActivityCard
          v-if="widgetVisibility.recent_activities"
          :activities="dashboardOverview.recentActivities"
        />

        <div v-if="visibleWidgetCount === 0" class="app-empty-state p-6 text-center">
          <UIcon name="i-lucide-panels-top-left" class="size-6 text-muted" aria-hidden="true" />
          <p class="mt-2 text-sm font-medium text-highlighted">所有模块已隐藏</p>
          <p class="mt-1 text-xs text-muted">打开“显示模块”即可恢复首页概览。</p>
        </div>
      </template>
    </section>

    <section class="app-panel p-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="app-section-title">下一步行动</h2>
          <p class="mt-1 text-sm text-muted">从当前最需要处理的一项开始。</p>
        </div>
        <RouterLink
          :to="analyzingCount ? '/opportunities' : resumes.length ? '/opportunities' : '/resumes'"
          class="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-primary outline-none hover:text-[var(--app-accent-deep)] focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {{ analyzingCount ? '查看分析进度' : resumes.length ? '添加一个 JD' : '创建第一份简历' }}
          <UIcon name="i-lucide-arrow-right" class="size-4" />
        </RouterLink>
      </div>
    </section>
  </section>
</template>
