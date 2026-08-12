<script setup lang="ts">
import { computed } from 'vue'
import type { ChatOpportunityProfileChangePresentation } from '@/shared/chat/schemas'
import type {
  OpportunityIntentionConfirmationStatus as OpportunityConfirmationStatus,
  ToolConfirmationDecision,
} from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatOpportunityProfileChangePresentation
  status: OpportunityConfirmationStatus
  pendingDecision?: ToolConfirmationDecision | null
}>()

const emit = defineEmits<{ approve: []; reject: [] }>()

const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在执行修改', tone: 'primary' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '已完成', tone: 'success' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消', tone: 'neutral' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '修改失败', tone: 'error' }
  return { icon: 'i-lucide-shield-check', label: '等待你的确认', tone: 'warning' }
})
</script>

<template>
  <section class="opportunity-confirmation-card" aria-label="修改机会资料确认">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
        <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
      </div>
      <span class="confirmation-status" :class="`is-${statusCopy.tone}`">
        <UIcon :name="statusCopy.icon" class="size-3.5" :class="status === 'approving' ? 'animate-spin' : ''" />
        {{ statusCopy.label }}
      </span>
    </header>

    <div class="mt-3 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl bg-[var(--app-surface-muted)]">
      <div v-for="change in presentation.changes" :key="change.field" class="px-3 py-2.5">
        <p class="text-[10px] font-medium text-muted">{{ change.label }}</p>
        <div class="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
          <span class="break-words text-muted">{{ change.before }}</span>
          <UIcon name="i-lucide-arrow-right" class="size-3.5 text-muted" />
          <span class="break-words text-right font-medium text-primary">{{ change.after }}</span>
        </div>
      </div>
    </div>

    <div v-if="status === 'waiting'" class="mt-3 flex justify-end gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="pendingDecision === 'rejected'"
        :disabled="Boolean(pendingDecision)"
        @click="emit('reject')"
      >
        取消
      </UButton>
      <UButton
        type="button"
        color="primary"
        variant="solid"
        size="xs"
        :loading="pendingDecision === 'approved'"
        :disabled="Boolean(pendingDecision)"
        @click="emit('approve')"
      >
        确认修改
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.opportunity-confirmation-card {
  width: min(100%, 26rem);
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.confirmation-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.3rem;
  border-radius: 9999px;
  padding: 0.2rem 0.45rem;
  font-size: 0.625rem;
  line-height: 0.875rem;
}

.confirmation-status.is-primary,
.confirmation-status.is-success {
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  color: var(--ui-primary);
}

.confirmation-status.is-warning {
  background: color-mix(in srgb, var(--ui-warning) 12%, transparent);
  color: var(--ui-warning);
}

.confirmation-status.is-error {
  background: color-mix(in srgb, var(--ui-error) 10%, transparent);
  color: var(--ui-error);
}

.confirmation-status.is-neutral {
  background: var(--app-surface-muted);
  color: var(--ui-text-muted);
}
</style>
