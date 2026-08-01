<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { capabilityProfileApi } from '@/services/capability-profile'
import { formatDateOnly } from '@/shared/formatDate'
import { useResumeStore } from '@/stores'
import type { CapabilityProfile } from '@/types/capability'
import type { DashboardAbilityInsight, DashboardHistoricalWeakness } from '@/types/dashboard'
import CapabilityProfileSkeleton from './components/CapabilityProfileSkeleton.vue'
import StrategySubnav from './components/StrategySubnav.vue'

defineOptions({ name: 'CapabilityProfilePage' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const resumeStore = useResumeStore()
const { resumes, isLoading: isResumeLoading } = storeToRefs(resumeStore)

const profile = ref<CapabilityProfile | null>(null)
const selectedResumeId = ref('')
const isInitialLoading = ref(true)
const isRefreshing = ref(false)
const errorMessage = ref<string | null>(null)
const loadSequence = ref(0)
const isTrainingExpanded = ref(false)
const maxVisibleTrainingSessions = 6

const resumeOptions = computed(() => resumes.value.map((resume) => ({ label: resume.title, value: resume.id })))
const hasResumes = computed(() => resumes.value.length > 0)
const showEmptyState = computed(
  () => !isInitialLoading.value && !isRefreshing.value && (!hasResumes.value || profile.value?.scope === null),
)
const showFatalError = computed(
  () => !isInitialLoading.value && !isRefreshing.value && !profile.value && !!errorMessage.value,
)
const visibleTrainingSessions = computed(() => {
  const sessions = profile.value?.interview.sessions ?? []
  return isTrainingExpanded.value ? sessions : sessions.slice(0, maxVisibleTrainingSessions)
})
const hasMoreTrainingSessions = computed(
  () => (profile.value?.interview.sessions.length ?? 0) > maxVisibleTrainingSessions,
)

function resolveRequestedResumeId() {
  const queryResumeId = typeof route.query.resumeId === 'string' ? route.query.resumeId : ''
  if (queryResumeId && resumes.value.some((resume) => resume.id === queryResumeId)) return queryResumeId
  if (resumeStore.currentResumeId && resumes.value.some((resume) => resume.id === resumeStore.currentResumeId)) {
    return resumeStore.currentResumeId
  }
  return resumes.value[0]?.id ?? ''
}

async function ensureResumeWorkspaceLoaded() {
  if (resumes.value.length > 0) return

  if (!isResumeLoading.value) {
    await resumeStore.loadFromApi()
    return
  }

  await new Promise<void>((resolve) => {
    const stop = watch(
      isResumeLoading,
      (loading) => {
        if (loading) return
        stop()
        resolve()
      },
      { immediate: true },
    )
  })
}

function getInsightMeta(item: DashboardAbilityInsight) {
  const confidenceLabel = { high: '高可信', medium: '中可信', low: '低可信' }[item.confidence]
  return `${item.evidenceCount} 次证据 · ${confidenceLabel}`
}

function getWeaknessMeta(item: DashboardHistoricalWeakness) {
  const confidenceLabel = { high: '高可信', medium: '中可信', low: '低可信' }[item.confidence]
  return `${item.masteryScore} 分 · ${confidenceLabel}`
}

function getStatusLabel(status: CapabilityProfile['jdSignals'][number]['opportunityStatus']) {
  return {
    pending_apply: '待投递',
    applied: '已投递',
    written_test: '笔试中',
    interviewing: '面试中',
    oc: 'OC',
    offered: '已 Offer',
    closed: '已终止',
  }[status]
}

function getRecommendationLabel(recommendation: CapabilityProfile['jdSignals'][number]['recommendation']) {
  return {
    strong_match: '强匹配',
    worth_trying: '值得投递',
    risky: '谨慎投递',
    not_recommended: '不建议',
  }[recommendation]
}

function getRecommendationClass(recommendation: CapabilityProfile['jdSignals'][number]['recommendation']) {
  return {
    strong_match:
      'border border-[color-mix(in_srgb,#8A5EED_35%,var(--app-border))] bg-[color-mix(in_srgb,#8A5EED_12%,transparent)] text-[#8A5EED]',
    worth_trying:
      'border border-[color-mix(in_srgb,var(--app-success)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-success)_12%,transparent)] text-[var(--app-success)]',
    risky:
      'border border-[color-mix(in_srgb,var(--app-warning)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-warning)_12%,transparent)] text-[var(--app-warning)]',
    not_recommended:
      'border border-[color-mix(in_srgb,var(--app-neutral)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-neutral)_12%,transparent)] text-[var(--app-text-muted)]',
  }[recommendation]
}

function getInterviewStatusLabel(status: CapabilityProfile['interview']['sessions'][number]['status']) {
  return status === 'completed' ? '已完成' : '提前结束'
}

function getEvidenceStatusLabel(status: CapabilityProfile['interview']['sessions'][number]['evidenceStatus']) {
  return status === 'sufficient' ? '证据充分' : '证据有限'
}

function scoreClass(score: number | null) {
  if (score === null) return 'text-muted'
  if (score >= 90) return 'bg-[linear-gradient(100deg,#6366f1,#dd45a4)] bg-clip-text text-transparent'
  if (score >= 60) return 'text-[var(--app-success)]'
  if (score >= 30) return 'text-[var(--app-warning)]'
  return 'text-[var(--app-neutral)]'
}

async function loadProfile(background = false) {
  const sequence = ++loadSequence.value
  if (background && profile.value) isRefreshing.value = true
  else isInitialLoading.value = true
  errorMessage.value = null

  try {
    const result = await capabilityProfileApi.getProfile(selectedResumeId.value || undefined)
    if (sequence !== loadSequence.value) return
    profile.value = result
    isTrainingExpanded.value = false
  } catch (error) {
    if (sequence !== loadSequence.value) return
    errorMessage.value = error instanceof Error ? error.message : '能力画像暂时无法加载。'
    if (!profile.value) toast.add({ title: '能力画像加载失败', description: errorMessage.value, color: 'error' })
  } finally {
    if (sequence === loadSequence.value) {
      isInitialLoading.value = false
      isRefreshing.value = false
    }
  }
}

async function bootstrap() {
  await ensureResumeWorkspaceLoaded()
  const defaultResumeId = resolveRequestedResumeId()
  selectedResumeId.value = defaultResumeId
  if (defaultResumeId && resumeStore.currentResumeId !== defaultResumeId) {
    resumeStore.selectResume(defaultResumeId)
  }
  await loadProfile()
}

async function selectResume(resumeId: string) {
  if (!resumeId || resumeId === selectedResumeId.value) return
  selectedResumeId.value = resumeId
  resumeStore.selectResume(resumeId)
  await router.replace({ query: { ...route.query, resumeId } })
  await loadProfile(Boolean(profile.value))
}

function handleResumeSelect(value: unknown) {
  void selectResume(String(value))
}

onMounted(() => {
  void bootstrap()
})

watch(
  () => route.query.resumeId,
  (value) => {
    if (typeof value !== 'string' || !value || value === selectedResumeId.value) return
    if (!resumes.value.some((resume) => resume.id === value)) return
    selectedResumeId.value = value
    void loadProfile(Boolean(profile.value))
  },
)
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-6">
    <StrategySubnav />
    <div v-if="isInitialLoading" class="space-y-5">
      <CapabilityProfileSkeleton />
    </div>

    <template v-else-if="showEmptyState">
      <div class="app-panel flex min-h-[32rem] flex-col items-center justify-center px-6 py-12 text-center">
        <span class="flex size-14 items-center justify-center rounded-2xl bg-[var(--app-accent-soft)] text-primary">
          <UIcon name="i-lucide-compass" class="size-7" />
        </span>
        <h1 class="mt-5 text-xl font-semibold text-highlighted">先建立一份简历</h1>
        <p class="mt-2 max-w-md text-sm leading-6 text-muted">
          能力画像只整理已有结构化证据，不会凭空生成结论。完成 JD 分析或模拟面试后，这里会展示可复用的能力信号。
        </p>
        <UButton to="/resumes" class="mt-5" icon="i-lucide-file-plus-2">去创建简历</UButton>
      </div>
    </template>

    <div
      v-else-if="showFatalError"
      class="app-panel flex min-h-[24rem] flex-col items-center justify-center px-6 py-12 text-center"
    >
      <span
        class="flex size-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--app-danger)_10%,transparent)] text-[var(--app-danger)]"
      >
        <UIcon name="i-lucide-circle-alert" class="size-6" />
      </span>
      <h1 class="mt-4 text-lg font-semibold text-highlighted">能力画像暂时无法加载</h1>
      <p class="mt-2 max-w-md text-sm leading-6 text-muted">{{ errorMessage }}</p>
      <UButton class="mt-5" icon="i-lucide-refresh-cw" @click="loadProfile()">重新加载</UButton>
    </div>

    <template v-else-if="profile">
      <header class="app-panel overflow-hidden p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-5">
          <div class="min-w-0 max-w-2xl">
            <p class="app-section-kicker">求职策略 / 能力画像</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">能力画像</h1>
              <span class="app-soft-badge rounded-full px-2.5 py-1 text-[11px] font-medium">证据聚合</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-muted">
              汇总已有 JD 分析和已结束的模拟面试；不会额外调用 AI，也不会把不同来源强行合并成一个分数。
            </p>
          </div>

          <div v-if="hasResumes" class="flex min-w-52 flex-col gap-1.5">
            <label for="capability-resume-select" class="text-[11px] font-medium text-muted">查看简历主线</label>
            <USelect
              id="capability-resume-select"
              :model-value="selectedResumeId"
              :items="resumeOptions"
              value-key="value"
              class="w-full"
              aria-label="选择用于能力画像的简历"
              @update:model-value="handleResumeSelect"
            />
          </div>
        </div>

        <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="app-panel-muted p-4">
            <p class="text-xs text-muted">当前范围</p>
            <p class="mt-2 truncate text-sm font-semibold text-highlighted">{{ profile.scope?.resumeTitle }}</p>
            <p class="mt-1 text-[11px] text-muted">
              V{{ profile.scope?.currentVersionNumber }} · {{ profile.scope?.targetDirection || '未设置方向' }}
            </p>
          </div>
          <div class="app-panel-muted p-4">
            <p class="text-xs text-muted">JD 分析</p>
            <p class="mt-2 text-2xl font-semibold text-highlighted">{{ profile.sourceCounts.completedJdAnalyses }}</p>
            <p class="mt-1 text-[11px] text-muted">已完成 · {{ profile.sourceCounts.pendingJdAnalyses }} 条进行中</p>
          </div>
          <div class="app-panel-muted p-4">
            <p class="text-xs text-muted">模拟面试</p>
            <p class="mt-2 text-2xl font-semibold text-highlighted">{{ profile.sourceCounts.simulatedSessions }}</p>
            <p class="mt-1 text-[11px] text-muted">已结束且有结构化评估</p>
          </div>
          <div class="app-panel-muted p-4">
            <p class="text-xs text-muted">数据状态</p>
            <p class="mt-2 text-sm font-semibold text-highlighted">
              {{
                profile.dataStatus === 'sufficient'
                  ? '证据较充分'
                  : profile.dataStatus === 'partial'
                    ? '证据较少'
                    : '等待证据'
              }}
            </p>
            <p class="mt-1 text-[11px] text-muted">更新于 {{ formatDateOnly(profile.generatedAt) }}</p>
          </div>
        </div>

        <div v-if="isRefreshing" class="mt-4 flex items-center gap-2 text-xs text-muted" role="status">
          <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />正在同步当前简历的证据…
        </div>
        <div
          v-if="errorMessage"
          class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--app-danger)_30%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-danger)_6%,var(--app-surface))] px-3 py-2.5 text-xs"
        >
          <span class="text-[var(--app-danger)]"
            >{{ errorMessage }}{{ profile ? '，当前仍展示上一次结果。' : '' }}</span
          >
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :loading="isRefreshing"
            @click="loadProfile(Boolean(profile))"
            >重试</UButton
          >
        </div>
      </header>

      <article class="app-card min-w-0 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="app-section-kicker">Interview evidence</p>
            <h2 class="mt-1 text-base font-semibold text-highlighted">模拟面试证据</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              只使用已结束且有结构化评估的面试，不把一次未完成训练当成结论。
            </p>
          </div>
          <UButton
            to="/opportunities"
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-arrow-up-right"
            class="shrink-0 whitespace-nowrap"
          >
            去训练
          </UButton>
        </div>

        <div
          v-if="profile.interview.strengths.length || profile.interview.weaknesses.length"
          class="mt-5 grid gap-4 sm:grid-cols-2"
        >
          <section>
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full bg-[var(--app-success)]" />
              <h3 class="text-xs font-semibold text-highlighted">稳定优势</h3>
              <span class="text-[11px] text-muted">最多显示 5 条</span>
            </div>
            <div class="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              <div
                v-for="item in profile.interview.strengths"
                :key="item.capabilityKey"
                class="rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5"
              >
                <p class="truncate text-sm font-medium text-highlighted">{{ item.label }}</p>
                <p class="mt-1 text-[11px] text-muted">{{ getInsightMeta(item) }}</p>
              </div>
              <p v-if="!profile.interview.strengths.length" class="text-xs text-muted">暂时没有稳定优势证据。</p>
            </div>
          </section>
          <section>
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full bg-[var(--app-warning)]" />
              <h3 class="text-xs font-semibold text-highlighted">待补强</h3>
              <span class="text-[11px] text-muted">最多显示 5 条</span>
            </div>
            <div class="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              <div
                v-for="item in profile.interview.weaknesses"
                :key="item.capabilityKey"
                class="rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5"
              >
                <p class="truncate text-sm font-medium text-highlighted">{{ item.label }}</p>
                <p class="mt-1 text-[11px] text-muted">{{ getInsightMeta(item) }}</p>
              </div>
              <p v-if="!profile.interview.weaknesses.length" class="text-xs text-muted">暂时没有稳定待补强证据。</p>
            </div>
          </section>
        </div>
        <div v-else class="app-panel-muted mt-5 border-dashed p-5 text-center">
          <p class="text-sm font-medium text-highlighted">还没有可汇总的面试证据</p>
          <p class="mt-1 text-xs leading-5 text-muted">完成一次模拟面试后，系统会把结构化评估放到这里。</p>
        </div>

        <div class="mt-6 border-t border-[var(--app-border)] pt-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-xs font-semibold text-highlighted">历史待补强</h3>
            <span class="text-[11px] text-muted">最多展示 5 个</span>
          </div>
          <div v-if="profile.interview.historicalWeaknesses.length" class="mt-3 space-y-2">
            <article
              v-for="item in profile.interview.historicalWeaknesses"
              :key="item.topicKey"
              class="rounded-xl border border-[color-mix(in_srgb,var(--app-warning)_22%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-warning)_6%,var(--app-surface-muted))] px-3 py-2.5"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="truncate text-sm font-medium text-highlighted">{{ item.topicLabel }}</p>
                <span class="shrink-0 text-[11px] font-semibold text-[var(--app-warning)]">{{
                  getWeaknessMeta(item)
                }}</span>
              </div>
              <p class="mt-1 text-xs leading-5 text-muted">{{ item.summary }}</p>
            </article>
          </div>
          <p v-else class="mt-3 text-xs leading-5 text-muted">还没有重复暴露的历史薄弱主题。</p>
        </div>
      </article>
      <article class="app-card min-w-0 p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="app-section-kicker">JD evidence</p>
            <h2 class="mt-1 text-base font-semibold text-highlighted">JD 分析信号</h2>
            <p class="mt-1 text-xs leading-5 text-muted">每条信号保留来源岗位和简历版本，不做跨岗位语义合并。</p>
          </div>
          <span
            v-if="profile.sourceCounts.failedJdAnalyses"
            class="app-soft-badge rounded-full px-2.5 py-1 text-[11px] text-muted"
          >
            {{ profile.sourceCounts.failedJdAnalyses }} 条分析失败，不纳入结论
          </span>
        </div>

        <div v-if="profile.jdSignals.length" class="mt-5 max-h-[42rem] space-y-3 overflow-y-auto pr-1">
          <article
            v-for="signal in profile.jdSignals"
            :key="signal.opportunityId"
            class="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <RouterLink
                  :to="`/opportunities/${signal.opportunityId}`"
                  class="truncate text-sm font-semibold text-highlighted hover:text-primary"
                >
                  {{ signal.company }} · {{ signal.jobTitle }}
                </RouterLink>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span>{{ formatDateOnly(signal.updatedAt) }}</span>
                  <span>·</span>
                  <span>{{ getStatusLabel(signal.opportunityStatus) }}</span>
                  <span :class="signal.isCurrentVersion ? 'text-[var(--app-success)]' : 'text-muted'"
                    >· {{ signal.isCurrentVersion ? '当前简历版本' : `基于 V${signal.versionNumber}` }}</span
                  >
                  <span v-if="signal.modelName">· {{ signal.modelName }}</span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="text-lg font-semibold" :class="scoreClass(signal.matchScore)">{{
                  signal.matchScore
                }}</span>
                <span
                  class="rounded-full px-2 py-1 text-[10px] font-medium"
                  :class="getRecommendationClass(signal.recommendation)"
                >
                  {{ getRecommendationLabel(signal.recommendation) }}
                </span>
              </div>
            </div>

            <p class="mt-3 line-clamp-2 text-xs leading-5 text-muted">{{ signal.summary }}</p>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <section>
                <div class="flex items-center gap-2">
                  <span class="size-2 rounded-full bg-[var(--app-success)]" />
                  <h3 class="text-xs font-semibold text-highlighted">优势</h3>
                </div>
                <div v-if="signal.strengths.length" class="mt-2 space-y-2">
                  <div
                    v-for="item in signal.strengths"
                    :key="item.title"
                    class="rounded-xl bg-[var(--app-surface)] px-3 py-2.5"
                  >
                    <p class="text-xs font-medium text-highlighted">{{ item.title }}</p>
                    <p class="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">{{ item.reason }}</p>
                  </div>
                </div>
                <p v-else class="mt-2 text-xs text-muted">这条分析没有记录优势项。</p>
              </section>
              <section>
                <div class="flex items-center gap-2">
                  <span class="size-2 rounded-full bg-[var(--app-warning)]" />
                  <h3 class="text-xs font-semibold text-highlighted">待补强</h3>
                </div>
                <div v-if="signal.gaps.length" class="mt-2 space-y-2">
                  <div
                    v-for="item in signal.gaps"
                    :key="item.title"
                    class="rounded-xl bg-[var(--app-surface)] px-3 py-2.5"
                  >
                    <p class="text-xs font-medium text-highlighted">{{ item.title }}</p>
                    <p class="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">{{ item.reason }}</p>
                  </div>
                </div>
                <p v-else class="mt-2 text-xs text-muted">这条分析没有记录待补强项。</p>
              </section>
            </div>

            <div v-if="signal.suggestions.length" class="mt-3 border-t border-[var(--app-border)] pt-3">
              <p class="text-[11px] font-medium text-muted">简历建议 · {{ signal.suggestions.length }} 条</p>
              <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                {{ signal.suggestions[0].title }}：{{ signal.suggestions[0].reason }}
              </p>
            </div>
          </article>
        </div>
        <div v-else class="app-panel-muted mt-5 border-dashed p-6 text-center">
          <p class="text-sm font-medium text-highlighted">还没有已完成的 JD 分析</p>
          <p class="mt-1 text-xs leading-5 text-muted">完成一条 JD 分析后，优势和待补强信号会自动出现在这里。</p>
          <UButton to="/opportunities" size="sm" variant="outline" color="neutral" class="mt-4">查看机会管理</UButton>
        </div>
      </article>

      <article class="app-card min-w-0 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="app-section-kicker">Training history</p>
            <h2 class="mt-1 text-base font-semibold text-highlighted">训练记录</h2>
            <p class="mt-1 text-xs leading-5 text-muted">点击记录回到对应机会详情，查看完整对话和最终复盘。</p>
          </div>
          <span class="text-[11px] text-muted">{{ profile.interview.sessions.length }} 场</span>
        </div>
        <div v-if="profile.interview.sessions.length" class="mt-5 grid gap-3 md:grid-cols-2">
          <RouterLink
            v-for="session in visibleTrainingSessions"
            :key="session.sessionId"
            :to="`/opportunities/${session.opportunityId}/interviews/${session.sessionId}`"
            class="group rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 outline-none transition-colors hover:border-[var(--app-accent-strong)] focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-highlighted">
                  {{ session.company }} · {{ session.jobTitle }}
                </p>
                <p class="mt-1 text-[11px] text-muted">{{ formatDateOnly(session.observedAt) }}</p>
              </div>
              <span class="text-lg font-semibold" :class="scoreClass(session.score)">{{ session.score ?? '—' }}</span>
            </div>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
              <div class="flex flex-wrap items-center gap-2">
                <span class="app-soft-badge inline-flex items-center rounded-full px-2 py-1">
                  {{ getInterviewStatusLabel(session.status) }}
                </span>
                <span class="app-soft-badge inline-flex items-center rounded-full px-2 py-1">
                  {{ getEvidenceStatusLabel(session.evidenceStatus) }}
                </span>
              </div>
              <span class="inline-flex shrink-0 items-center whitespace-nowrap"
                >{{ session.answeredQuestionCount }} 个问题</span
              >
            </div>
          </RouterLink>
        </div>
        <div v-if="hasMoreTrainingSessions" class="mt-4 flex justify-center">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="isTrainingExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            @click="isTrainingExpanded = !isTrainingExpanded"
          >
            {{ isTrainingExpanded ? '收起记录' : `展开全部（${profile.interview.sessions.length} 场）` }}
          </UButton>
        </div>
        <div v-else-if="!profile.interview.sessions.length" class="app-panel-muted mt-5 border-dashed p-6 text-center">
          <p class="text-sm font-medium text-highlighted">还没有已结束的模拟面试</p>
          <p class="mt-1 text-xs leading-5 text-muted">结束一场模拟面试后，这里会保留它的证据状态和入口。</p>
        </div>
      </article>
    </template>
  </section>
</template>
