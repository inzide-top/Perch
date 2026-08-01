<script setup lang="ts">
import { computed } from 'vue'
import type { JobAnalysis } from '@/types/opportunity'
import {
  getRecommendationClass,
  getRecommendationLabel,
  getScoreClass,
  getScoreDimensionLabel,
} from '@/shared/opportunity/analysisPresentation'

const props = defineProps<{
  analysis: JobAnalysis | null
}>()

const levelOrder = { high: 0, medium: 1, low: 2 } as const
const sortedGaps = computed(() => {
  return [...(props.analysis?.gaps ?? [])].sort((current, next) => {
    return levelOrder[current.level] - levelOrder[next.level]
  })
})
const sortedResumeSuggestions = computed(() => {
  return [...(props.analysis?.resumeSuggestions ?? [])].sort((current, next) => {
    return levelOrder[current.priority] - levelOrder[next.priority]
  })
})

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
</script>

<template>
  <section class="space-y-5">
    <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div class="app-panel p-5">
        <p class="text-sm text-muted">匹配度评分</p>
        <p
          class="mt-3 text-5xl font-semibold tracking-tight"
          :class="`app-recommendation-text ${getRecommendationClass(analysis?.recommendation)}`"
        >
          {{ analysis?.matchScore ?? '--' }}
        </p>
        <UBadge
          class="mt-3"
          variant="subtle"
          :class="`app-recommendation-badge ${getRecommendationClass(analysis?.recommendation)}`"
          :label="getRecommendationLabel(analysis?.recommendation)"
        />
        <p class="mt-4 text-xs leading-5 text-muted">
          评分根据当前简历版本与岗位要求综合计算，建议结合各维度证据一并判断。
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
          <p class="text-sm font-medium text-highlighted">{{ getScoreDimensionLabel(item.key) }}</p>
          <span class="app-score-text text-sm font-semibold" :class="getScoreClass(item.score)">
            {{ item.score }}
          </span>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            class="app-score-bar h-full rounded-full"
            :class="getScoreClass(item.score)"
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
          <article v-for="item in sortedGaps" :key="item.title" class="app-panel-muted p-3">
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
        <article v-for="suggestion in sortedResumeSuggestions" :key="suggestion.title" class="app-card p-4">
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
