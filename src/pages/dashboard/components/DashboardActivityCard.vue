<script setup lang="ts">
import type { DashboardRecentActivity } from '@/types/dashboard'

defineProps<{
  activities: DashboardRecentActivity[]
}>()

function formatActivityTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<template>
  <article class="app-card min-w-0 p-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="app-section-title">最近动态</h3>
        <p class="mt-1 text-xs leading-5 text-muted">快速回到最近处理过的机会和训练记录。</p>
      </div>
      <UIcon name="i-lucide-history" class="mt-0.5 size-4 text-muted" aria-hidden="true" />
    </div>

    <div v-if="activities.length" class="mt-4 divide-y divide-[var(--app-border)]">
      <RouterLink
        v-for="activity in activities"
        :key="`${activity.type}-${activity.sessionId ?? activity.opportunityId}-${activity.occurredAt}`"
        :to="
          activity.sessionId
            ? `/opportunities/${activity.opportunityId}?section=mock-interview&sessionId=${activity.sessionId}`
            : `/opportunities/${activity.opportunityId}`
        "
        class="group flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0 focus:outline-none"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--app-accent-soft)] text-[var(--app-accent-deep)] transition-colors group-hover:bg-[var(--app-accent-subtle)]"
        >
          <UIcon
            :name="activity.type === 'interview_session' ? 'i-lucide-messages-square' : 'i-lucide-briefcase-business'"
            class="size-4"
          />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-highlighted">{{ activity.title }}</span>
          <span class="mt-0.5 block truncate text-xs text-muted">{{ activity.detail }}</span>
        </span>
        <time class="shrink-0 text-[11px] text-muted" :datetime="activity.occurredAt">{{
          formatActivityTime(activity.occurredAt)
        }}</time>
      </RouterLink>
    </div>
    <p v-else class="mt-5 rounded-xl bg-[var(--app-surface-muted)] p-4 text-xs leading-5 text-muted">
      还没有最近动态。
    </p>
  </article>
</template>
