<script setup lang="ts">
import { computed } from 'vue'
import type { ChatOpportunityStatusTransitionPresentation } from '@/shared/chat/schemas'
import type {
  OpportunityIntentionConfirmationStatus as OpportunityConfirmationStatus,
  ToolConfirmationDecision,
} from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatOpportunityStatusTransitionPresentation
  status: OpportunityConfirmationStatus
  pendingDecision?: ToolConfirmationDecision | null
  errorMessage?: string | null
}>()

const emit = defineEmits<{ approve: []; reject: [] }>()

const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在流转', tone: 'primary' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '已完成', tone: 'success' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消', tone: 'neutral' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '流转失败', tone: 'error' }
  return { icon: 'i-lucide-shield-check', label: '等待你的确认', tone: 'warning' }
})
</script>

<template>
  <section class="status-confirmation-card" aria-label="修改机会阶段确认">
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

    <div class="mt-3 flex items-center gap-2 rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <p class="text-[10px] text-muted">当前阶段</p>
        <p class="mt-0.5 text-sm font-semibold text-highlighted">{{ presentation.beforeLabel }}</p>
      </div>
      <UIcon
        :name="presentation.direction === 'backward' ? 'i-lucide-undo-2' : 'i-lucide-arrow-right'"
        class="size-4 shrink-0 text-muted"
      />
      <div class="min-w-0 flex-1 text-right">
        <p class="text-[10px] text-muted">修改为</p>
        <p class="mt-0.5 text-sm font-semibold text-primary">{{ presentation.afterLabel }}</p>
      </div>
    </div>

    <p
      v-if="presentation.warning"
      class="mt-2 flex items-start gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--ui-warning)_10%,transparent)] px-2.5 py-2 text-[11px] leading-5 text-warning"
    >
      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
      {{ presentation.warning }}
    </p>

    <p v-if="status === 'failed'" class="mt-2 text-[11px] leading-5 text-error">
      {{ errorMessage || '当前流转失败，请根据最新机会状态重试。' }}
    </p>

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
        确认流转
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.status-confirmation-card {
  width: min(100%, 24rem);
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
