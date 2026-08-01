<script setup lang="ts">
import type { DashboardAbilityInsight, DashboardAbilitySummary } from '@/types/dashboard'

defineProps<{
  ability: DashboardAbilitySummary
}>()

const confidenceLabels: Record<DashboardAbilityInsight['confidence'], string> = {
  low: '初步证据',
  medium: '有限证据',
  high: '重复证据',
}

function formatSourceCount(insight: DashboardAbilityInsight) {
  return `${insight.sourceCount} 场面试 · ${confidenceLabels[insight.confidence]}`
}

const historicalWeaknessConfidenceLabels: Record<
  DashboardAbilitySummary['historicalWeaknesses'][number]['confidence'],
  string
> = {
  low: '初步证据',
  medium: '有限证据',
  high: '重复证据',
}

function formatWeaknessMeta(weakness: DashboardAbilitySummary['historicalWeaknesses'][number]) {
  return `${weakness.masteryScore} 分 · ${historicalWeaknessConfidenceLabels[weakness.confidence]}`
}
</script>

<template>
  <article class="app-card min-w-0 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="app-section-title">能力证据摘要</h3>
        <p class="mt-1 text-xs leading-5 text-muted">首页只保留概览，完整证据和训练记录请进入能力画像查看。</p>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium"
          :class="{
            'border-[var(--app-border)] text-muted': ability.dataStatus === 'empty',
            'border-[color-mix(in_srgb,var(--app-warning)_38%,transparent)] bg-[color-mix(in_srgb,var(--app-warning)_10%,transparent)] text-[var(--app-warning)]':
              ability.dataStatus === 'partial',
            'border-[color-mix(in_srgb,var(--app-success)_38%,transparent)] bg-[color-mix(in_srgb,var(--app-success)_10%,transparent)] text-[var(--app-success)]':
              ability.dataStatus === 'sufficient',
          }"
        >
          {{
            ability.dataStatus === 'empty' ? '暂无证据' : ability.dataStatus === 'partial' ? '证据有限' : '证据较充分'
          }}
        </span>
        <UButton
          to="/strategy"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-up-right"
          class="shrink-0 whitespace-nowrap"
        >
          查看完整画像
        </UButton>
      </div>
    </div>

    <div v-if="ability.dataStatus === 'empty'" class="app-empty-state mt-5 p-5">
      <p class="text-sm font-medium text-highlighted">还没有可汇总的面试证据</p>
      <p class="mt-1 text-xs leading-5 text-muted">完成一次模拟面试或录入真实复盘后，首页会显示简要概览。</p>
      <RouterLink
        to="/opportunities"
        class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-[var(--app-accent-deep)]"
      >
        开始一次模拟面试
        <UIcon name="i-lucide-arrow-up-right" class="size-3.5" />
      </RouterLink>
    </div>

    <div v-else class="mt-5 grid gap-4 sm:grid-cols-2">
      <section class="app-panel-muted min-w-0 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-muted">优势证据</p>
            <p class="mt-2 text-2xl font-semibold text-highlighted">{{ ability.strengths.length }}</p>
          </div>
          <span class="text-[11px] text-muted">个主题</span>
        </div>
        <div v-if="ability.strengths.length" class="mt-3 space-y-1.5">
          <div
            v-for="item in ability.strengths.slice(0, 3)"
            :key="item.capabilityKey"
            class="flex min-w-0 items-center justify-between gap-3 text-xs"
          >
            <span class="truncate font-medium text-highlighted">{{ item.label }}</span>
            <span class="shrink-0 text-[11px] text-muted">{{ formatSourceCount(item) }}</span>
          </div>
          <p v-if="ability.strengths.length > 3" class="pt-1 text-[11px] text-muted">
            还有 {{ ability.strengths.length - 3 }} 个主题，进入能力画像查看。
          </p>
        </div>
        <p v-else class="mt-3 text-xs text-muted">暂时没有稳定的优势证据。</p>
      </section>

      <section class="app-panel-muted min-w-0 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-muted">待补强证据</p>
            <p class="mt-2 text-2xl font-semibold text-highlighted">{{ ability.weaknesses.length }}</p>
          </div>
          <span class="text-[11px] text-muted">个主题</span>
        </div>
        <div v-if="ability.weaknesses.length" class="mt-3 space-y-1.5">
          <div
            v-for="item in ability.weaknesses.slice(0, 3)"
            :key="item.capabilityKey"
            class="flex min-w-0 items-center justify-between gap-3 text-xs"
          >
            <span class="truncate font-medium text-highlighted">{{ item.label }}</span>
            <span class="shrink-0 text-[11px] text-muted">{{ formatSourceCount(item) }}</span>
          </div>
          <p v-if="ability.weaknesses.length > 3" class="pt-1 text-[11px] text-muted">
            还有 {{ ability.weaknesses.length - 3 }} 个主题，进入能力画像查看。
          </p>
        </div>
        <p v-else class="mt-3 text-xs text-muted">暂时没有稳定的待补强证据。</p>
      </section>
    </div>

    <section v-if="ability.dataStatus !== 'empty'" class="app-panel-muted mt-4 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs font-medium text-highlighted">历史待补强</p>
        <span class="text-[11px] text-muted">{{ ability.historicalWeaknesses.length }} 个主题</span>
      </div>
      <p class="mt-1 text-xs leading-5 text-muted">完整历史主题和每条证据，已收纳到能力画像页面。</p>
      <div v-if="ability.historicalWeaknesses.length" class="mt-3 space-y-1.5">
        <div
          v-for="weakness in ability.historicalWeaknesses.slice(0, 2)"
          :key="weakness.topicKey"
          class="flex min-w-0 items-center justify-between gap-3 text-xs"
        >
          <span class="truncate text-highlighted">{{ weakness.topicLabel }}</span>
          <span class="shrink-0 text-[11px] text-muted">{{ formatWeaknessMeta(weakness) }}</span>
        </div>
      </div>
    </section>

    <div class="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--app-border)] pt-3 text-[11px] text-muted">
      <span>模拟面试 {{ ability.sourceCounts.simulatedSessions }} 场</span>
      <span>笔试复盘 {{ ability.sourceCounts.writtenTestReviews }} 条</span>
      <span>真实面试复盘 {{ ability.sourceCounts.interviewReviews }} 轮</span>
    </div>
  </article>
</template>
