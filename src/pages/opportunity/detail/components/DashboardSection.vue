<script setup lang="ts">
import type { JobAnalysis } from '@/types/opportunity'

defineProps<{
  analysis: JobAnalysis | null
}>()

function getRecommendationLabel(value: string | undefined) {
  const map: Record<string, string> = {
    strong_match: '强匹配',
    worth_trying: '值得投递',
    risky: '谨慎投递',
    not_recommended: '不建议',
  }

  return value ? (map[value] ?? value) : '待分析'
}

function getRecommendationBadgeClass(value: string | undefined) {
  const map: Record<string, string> = {
    strong_match: 'is-strong-match',
    worth_trying: 'is-worth-trying',
    risky: 'is-risky',
    not_recommended: 'is-not-recommended',
  }

  return `app-recommendation-badge ${value ? (map[value] ?? 'is-not-recommended') : 'is-not-recommended'}`
}

function getRecommendationTextClass(value: string | undefined) {
  const map: Record<string, string> = {
    strong_match: 'is-strong-match',
    worth_trying: 'is-worth-trying',
    risky: 'is-risky',
    not_recommended: 'is-not-recommended',
  }

  return `app-recommendation-text ${value ? (map[value] ?? 'is-not-recommended') : 'is-not-recommended'}`
}

function getLevelLabel(value: string) {
  const map: Record<string, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
  }

  return map[value] ?? value
}

function getRiskColor(value: string) {
  const map: Record<string, 'error' | 'warning' | 'neutral'> = {
    high: 'error',
    medium: 'warning',
    low: 'neutral',
  }

  return map[value] ?? 'neutral'
}

function getPriorityLabel(value: string) {
  const map: Record<string, string> = {
    high: '高优先级',
    medium: '中优先级',
    low: '低优先级',
  }

  return map[value] ?? value
}

function getPriorityColor(value: string) {
  const map: Record<string, 'success' | 'warning' | 'neutral'> = {
    high: 'success',
    medium: 'warning',
    low: 'neutral',
  }

  return map[value] ?? 'neutral'
}

function getScoreMetricClass(score: number) {
  if (score >= 90) return 'app-score-metric is-score-excellent'
  if (score > 60) return 'app-score-metric is-score-good'
  if (score > 30) return 'app-score-metric is-score-medium'

  return 'app-score-metric is-score-low'
}
</script>

<template>
  <section class="space-y-5">
    <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div class="app-panel p-5">
        <p class="text-sm text-muted">匹配度评分</p>
        <p
          class="mt-3 text-5xl font-semibold tracking-tight"
          :class="getRecommendationTextClass(analysis?.recommendation)"
        >
          {{ analysis?.matchScore ?? '--' }}
        </p>
        <UBadge
          class="mt-3"
          variant="subtle"
          :class="getRecommendationBadgeClass(analysis?.recommendation)"
          :label="getRecommendationLabel(analysis?.recommendation)"
        />
        <p class="mt-4 text-xs leading-5 text-muted">
          当前评分来自 mock 分析结果。后续接入后端 AI 后，这里会展示真实生成结果。
        </p>
      </div>

      <div class="app-panel p-5">
        <h2 class="app-section-title">匹配结论</h2>
        <p class="mt-3 text-sm leading-7 text-muted">{{ analysis?.summary ?? '暂无分析结果' }}</p>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div v-for="item in analysis?.scoreBreakdown ?? []" :key="item.key" class="app-card p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
          <span class="text-sm font-semibold" :class="getScoreMetricClass(item.score)">{{ item.score }}</span>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            class="h-full rounded-full"
            :class="getScoreMetricClass(item.score)"
            :style="{ width: `${item.score}%` }"
          />
        </div>
        <p class="mt-3 text-xs leading-5 text-muted">{{ item.reason }}</p>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="app-panel p-5">
        <h2 class="app-section-title">优势</h2>
        <div class="mt-4 space-y-3">
          <article v-for="item in analysis?.strengths ?? []" :key="item.title" class="app-panel-muted p-3">
            <p class="text-sm font-medium text-highlighted">{{ item.title }}</p>
            <p class="mt-1 text-xs leading-5 text-muted">{{ item.reason }}</p>
          </article>
        </div>
      </section>

      <section class="app-panel p-5">
        <h2 class="app-section-title">风险与短板</h2>
        <div class="mt-4 space-y-3">
          <article v-for="item in analysis?.gaps ?? []" :key="item.title" class="app-panel-muted p-3">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-medium text-highlighted">{{ item.title }}</p>
              <UBadge :color="getRiskColor(item.level)" variant="subtle" :label="getLevelLabel(item.level)" />
            </div>
            <p class="mt-1 text-xs leading-5 text-muted">{{ item.reason }}</p>
          </article>
        </div>
      </section>
    </div>

    <section class="app-panel p-5">
      <h2 class="app-section-title">简历优化建议</h2>
      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <article v-for="suggestion in analysis?.resumeSuggestions ?? []" :key="suggestion.title" class="app-card p-4">
          <div class="flex items-start justify-between gap-3">
            <p class="text-sm font-medium text-highlighted">{{ suggestion.title }}</p>
            <UBadge
              :color="getPriorityColor(suggestion.priority)"
              variant="subtle"
              :label="getPriorityLabel(suggestion.priority)"
            />
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">{{ suggestion.reason }}</p>
        </article>
      </div>
    </section>
  </section>
</template>
