<script setup lang="ts">
import type { InterviewOverview } from '@/types/interview'
import { getScoreClass } from '@/shared/opportunity/analysisPresentation'

defineProps<{
  overview: InterviewOverview | null
  loading: boolean
}>()

function getScoreTone(score: number | null) {
  return score === null ? '' : getScoreClass(score)
}
</script>

<template>
  <section class="app-panel p-5 sm:p-6">
    <div v-if="loading" class="space-y-5 animate-pulse" aria-label="正在加载训练概览">
      <div class="h-6 w-28 rounded bg-elevated" />
      <div class="h-20 rounded-2xl bg-elevated" />
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="item in 4" :key="item" class="h-20 rounded-2xl bg-elevated" />
      </div>
      <div class="h-28 rounded-2xl bg-elevated" />
    </div>

    <template v-else>
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">训练概览</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          用已完成的面试记录，观察当前机会下的训练覆盖、稳定表现与下一步重点。
        </p>
      </div>

      <div class="interview-overview-dashboard mt-6">
        <section class="interview-overview-score-card">
          <span class="text-xs text-muted">最近综合表现</span>
          <div class="mt-3 flex items-end gap-2">
            <strong
              class="interview-overview-score-value text-5xl font-semibold tracking-tight"
              :class="getScoreTone(overview?.recentScore ?? null)"
              >{{ overview?.recentScore ?? '--' }}</strong
            >
            <span v-if="overview?.recentScore !== null" class="mb-1 text-sm text-muted">分</span>
          </div>
          <p class="mt-4 text-xs leading-5 text-muted">分数会在累积足够有效回答后出现，完成后固定为本轮记录。</p>
        </section>

        <section class="interview-overview-metrics" aria-label="训练数据">
          <div class="interview-overview-metric">
            <span>完成轮次</span><strong>{{ overview?.completedCount ?? 0 }}</strong>
          </div>
          <div class="interview-overview-metric">
            <span>进行中</span><strong class="text-primary">{{ overview?.activeCount ?? 0 }}</strong>
          </div>
          <div class="interview-overview-metric">
            <span>基础面</span><strong>{{ overview?.foundationCount ?? 0 }}</strong>
          </div>
          <div class="interview-overview-metric">
            <span>项目面</span><strong>{{ overview?.projectCount ?? 0 }}</strong>
          </div>
        </section>
      </div>

      <div class="mt-5 grid gap-3 lg:grid-cols-2">
        <article class="interview-overview-insight">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">当前优势</p>
            <p class="mt-1 text-sm leading-6 text-muted">
              {{ overview?.primaryStrength ?? '完成一轮面试后，系统会从真实回答中提取可复用优势。' }}
            </p>
          </div>
        </article>
        <article class="interview-overview-insight">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <UIcon name="i-lucide-triangle-alert" class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">优先练习项</p>
            <p class="mt-1 text-sm leading-6 text-muted">
              {{ overview?.primaryGap ?? '系统会优先关注多次暴露、且尚未通过后续回答充分验证的薄弱项。' }}
            </p>
          </div>
        </article>
      </div>

      <div class="interview-overview-note mt-5">
        <UIcon name="i-lucide-route" class="mt-0.5 size-4 shrink-0 text-primary" />
        <p>每一轮训练会保留问题、回答、提示使用情况与最终复盘，便于后续针对薄弱项再练一次。</p>
      </div>
    </template>
  </section>
</template>
