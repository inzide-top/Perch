<script setup lang="ts">
import { computed } from 'vue'
import type { ChatInterviewScheduleCreatePresentation } from '@/shared/chat/schemas'
import type {
  OpportunityIntentionConfirmationStatus as ConfirmationStatus,
  ToolConfirmationDecision,
} from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatInterviewScheduleCreatePresentation
  status: ConfirmationStatus
  pendingDecision?: ToolConfirmationDecision | null
}>()
const emit = defineEmits<{ approve: []; reject: [] }>()

const formattedTime = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(props.presentation.scheduledAt)),
)
const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在创建' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '已创建' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '创建失败' }
  return { icon: 'i-lucide-calendar-check', label: '等待你的确认' }
})
</script>

<template>
  <section class="schedule-confirmation-card" aria-label="创建面试安排确认">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
        <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
      </div>
      <span
        class="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/8 px-2 py-1 text-[10px] text-primary"
      >
        <UIcon :name="statusCopy.icon" class="size-3.5" :class="status === 'approving' ? 'animate-spin' : ''" />
        {{ statusCopy.label }}
      </span>
    </header>

    <dl class="mt-3 grid gap-2 rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5 text-xs">
      <div class="flex items-start justify-between gap-4">
        <dt class="text-muted">面试类型</dt>
        <dd class="text-right font-medium text-highlighted">{{ presentation.roundTypeLabel }}</dd>
      </div>
      <div class="flex items-start justify-between gap-4">
        <dt class="text-muted">时间</dt>
        <dd class="text-right font-medium text-highlighted">{{ formattedTime }}</dd>
      </div>
      <div class="flex items-start justify-between gap-4">
        <dt class="text-muted">标题</dt>
        <dd class="text-right font-medium text-highlighted">{{ presentation.roundTitle }}</dd>
      </div>
      <div v-if="presentation.note" class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">备注</dt>
        <dd class="break-words text-right text-highlighted">{{ presentation.note }}</dd>
      </div>
    </dl>

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
        size="xs"
        :loading="pendingDecision === 'approved'"
        :disabled="Boolean(pendingDecision)"
        @click="emit('approve')"
      >
        确认创建
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.schedule-confirmation-card {
  width: min(100%, 28rem);
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}
</style>
