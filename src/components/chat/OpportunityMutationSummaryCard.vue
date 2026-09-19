<script setup lang="ts">
import { getUserErrorMessage } from '@/services/error-presentation'
import { computed, ref } from 'vue'
import type { OpportunityMutationSummaryItem } from './opportunity-mutation-summary'

const props = defineProps<{ items: OpportunityMutationSummaryItem[] }>()

const expanded = ref(false)
const visibleItems = computed(() => (expanded.value ? props.items : props.items.slice(0, 5)))
const successCount = computed(() => props.items.filter((item) => item.status === 'completed').length)
const failedCount = computed(() => props.items.filter((item) => item.status === 'failed').length)
const skippedCount = computed(() => props.items.filter((item) => item.status === 'skipped').length)
const rejectedCount = computed(() => props.items.filter((item) => item.status === 'rejected').length)

const statusPresentation = {
  completed: { icon: 'i-lucide-circle-check', label: '已完成', className: 'is-success' },
  skipped: { icon: 'i-lucide-forward', label: '已跳过', className: 'is-neutral' },
  rejected: { icon: 'i-lucide-circle-x', label: '已取消', className: 'is-neutral' },
  failed: { icon: 'i-lucide-circle-alert', label: '失败', className: 'is-error' },
} as const
</script>

<template>
  <section class="mutation-summary-card" aria-label="批量机会操作结果">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">批量操作结果</p>
        <p class="mt-0.5 text-[11px] text-muted">
          共 {{ items.length }} 项 · 成功 {{ successCount }}
          <template v-if="skippedCount"> · 跳过 {{ skippedCount }}</template>
          <template v-if="rejectedCount"> · 取消 {{ rejectedCount }}</template>
          <template v-if="failedCount"> · 失败 {{ failedCount }}</template>
        </p>
      </div>
      <span class="summary-badge" :class="failedCount ? 'is-warning' : 'is-success'">
        <UIcon :name="failedCount ? 'i-lucide-triangle-alert' : 'i-lucide-list-checks'" class="size-3.5" />
        {{ failedCount ? '部分完成' : '处理完成' }}
      </span>
    </header>

    <div class="mt-3 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl border border-[var(--app-border)]">
      <article v-for="item in visibleItems" :key="item.toolActionId" class="bg-[var(--app-surface-muted)] px-3 py-2.5">
        <div class="flex items-start gap-2.5">
          <UIcon
            :name="statusPresentation[item.status].icon"
            class="mt-0.5 size-3.5 shrink-0"
            :class="statusPresentation[item.status].className"
          />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <p class="truncate text-xs font-medium text-highlighted">{{ item.company }} · {{ item.jobTitle }}</p>
              <span class="shrink-0 text-[10px] text-muted">{{ item.operationLabel }}</span>
            </div>
            <p
              v-for="change in item.changes.slice(0, 2)"
              :key="`${item.toolActionId}-${change.label}`"
              class="mt-1 truncate text-[10px] text-muted"
            >
              {{ change.label }}：{{ change.before }} →
              <span class="font-medium text-highlighted">{{ change.after }}</span>
            </p>
            <p v-if="item.changes.length > 2" class="mt-1 text-[10px] text-muted">
              另有 {{ item.changes.length - 2 }} 项修改
            </p>
            <p v-if="item.errorMessage" class="mt-1 line-clamp-2 text-[10px] leading-4 text-error">
              {{ getUserErrorMessage(item.errorMessage, '操作失败，请稍后重试。') }}
            </p>
          </div>
          <span class="shrink-0 text-[10px]" :class="statusPresentation[item.status].className">
            {{ statusPresentation[item.status].label }}
          </span>
        </div>
      </article>
    </div>

    <UButton
      v-if="items.length > 5"
      class="mt-2 ml-auto"
      type="button"
      color="neutral"
      variant="ghost"
      size="xs"
      :icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : `查看全部 ${items.length} 项` }}
    </UButton>
  </section>
</template>

<style scoped>
.mutation-summary-card {
  width: min(100%, 30rem);
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 97%, var(--ui-primary) 3%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.summary-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.3rem;
  border-radius: 9999px;
  padding: 0.2rem 0.45rem;
  font-size: 0.625rem;
  line-height: 0.875rem;
}

.summary-badge.is-success,
.is-success {
  color: var(--ui-success);
}

.summary-badge.is-success {
  background: color-mix(in srgb, var(--ui-success) 10%, transparent);
}

.summary-badge.is-warning {
  background: color-mix(in srgb, var(--ui-warning) 10%, transparent);
  color: var(--ui-warning);
}

.is-neutral {
  color: var(--ui-text-muted);
}

.is-error {
  color: var(--ui-error);
}
</style>
