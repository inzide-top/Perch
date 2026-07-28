<script setup lang="ts">
import type { MockInterviewMessage, OverallInterviewScore } from '../types'

defineProps<{
  messages: MockInterviewMessage[]
  overallScore: OverallInterviewScore
}>()
</script>

<template>
  <section class="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_22rem]">
    <div class="app-panel p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold text-highlighted">模拟面试</h2>
        <div class="flex gap-2">
          <UBadge color="neutral" variant="subtle" label="基础面" />
          <UBadge color="neutral" variant="subtle" label="项目面" />
        </div>
      </div>

      <div class="space-y-4">
        <div
          v-for="(message, index) in messages"
          :key="index"
          class="flex"
          :class="message.role === 'candidate' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[82%] rounded-2xl border p-4"
            :class="
              message.role === 'candidate'
                ? 'border-primary/30 bg-primary/10'
                : 'border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_72%,transparent)]'
            "
          >
            <p class="whitespace-pre-line text-sm leading-6 text-highlighted">{{ message.content }}</p>
            <div v-if="message.role === 'candidate'" class="app-panel-muted mt-3 p-3">
              <div class="flex items-center gap-2">
                <UBadge color="primary" variant="subtle" :label="`${message.score} 分`" />
                <span class="text-xs text-muted">单回答评分</span>
              </div>
              <p class="mt-2 text-xs leading-5 text-muted">{{ message.feedback }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="app-panel-muted mt-5 border-dashed p-4 text-sm text-muted">
        后续这里会接真实 AI：生成问题、流式输出、逐条回答评分、结束后冻结整轮评分。
      </div>
    </div>

    <aside class="app-panel p-5 xl:sticky xl:top-6">
      <p class="text-sm text-muted">当前模拟面试总评</p>
      <p class="mt-3 text-4xl font-semibold text-primary">{{ overallScore.score }}</p>
      <p class="mt-3 text-sm leading-6 text-muted">{{ overallScore.summary }}</p>
      <div class="mt-5 space-y-3">
        <div v-for="item in overallScore.dimensions" :key="item.label">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted">{{ item.label }}</span>
            <span class="font-medium text-highlighted">{{ item.score }}</span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div class="h-full rounded-full bg-primary" :style="{ width: `${item.score}%` }" />
          </div>
        </div>
      </div>
    </aside>
  </section>
</template>
