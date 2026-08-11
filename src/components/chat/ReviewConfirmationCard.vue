<script setup lang="ts">
import { computed } from 'vue'
import type { ChatReviewSavePresentation } from '@/shared/chat/schemas'
import type {
  OpportunityIntentionConfirmationStatus as ConfirmationStatus,
  ToolConfirmationDecision,
} from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatReviewSavePresentation
  status: ConfirmationStatus
  pendingDecision?: ToolConfirmationDecision | null
}>()
const emit = defineEmits<{ approve: []; reject: [] }>()

const formattedTime = computed(() => {
  if (!props.presentation.occurredAt) return '未填写'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(props.presentation.occurredAt))
})
const modeLabel = computed(() => (props.presentation.mode === 'append' ? '追加内容' : '替换内容'))
const resultLabel = computed(() => {
  if (props.presentation.result === 'passed') return '已通过'
  if (props.presentation.result === 'failed') return '未通过'
  return '结果未知'
})
const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在保存' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '已保存' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '保存失败' }
  return { icon: 'i-lucide-clipboard-check', label: '等待你的确认' }
})
</script>

<template>
  <section class="review-confirmation-card" :aria-label="`${presentation.sourceLabel}保存确认`">
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
      <div v-if="presentation.sourceType === 'interview'" class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">面试轮次</dt>
        <dd class="text-right font-medium text-highlighted">{{ presentation.target.label }}</dd>
      </div>
      <div class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">类型</dt>
        <dd class="text-right font-medium text-highlighted">{{ presentation.sourceLabel }}</dd>
      </div>
      <div v-if="presentation.sourceType === 'interview'" class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">面试结果</dt>
        <dd class="text-right font-medium text-highlighted">{{ resultLabel }}</dd>
      </div>
      <div class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">时间</dt>
        <dd class="text-right font-medium text-highlighted">{{ formattedTime }}</dd>
      </div>
      <div class="flex items-start justify-between gap-4">
        <dt class="shrink-0 text-muted">保存方式</dt>
        <dd class="text-right font-medium text-highlighted">{{ modeLabel }}</dd>
      </div>
    </dl>

    <div class="mt-3 rounded-xl border border-default/70 bg-[var(--app-surface)] px-3 py-2.5">
      <p class="text-[10px] font-medium text-muted">{{ modeLabel }}</p>
      <p class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-highlighted">
        {{ presentation.reviewNote }}
      </p>
    </div>

    <p v-if="presentation.replacingExisting" class="mt-2 text-[10px] leading-4 text-warning">
      确认后会替换当前已有的复盘原文；历史结构化提取结果会随新版本重新生成。
    </p>
    <p v-if="presentation.completesPlannedRound" class="mt-2 text-[10px] leading-4 text-warning">
      该安排尚未标记完成；确认保存后会同时将这一轮面试更新为已完成。
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
        size="xs"
        :loading="pendingDecision === 'approved'"
        :disabled="Boolean(pendingDecision)"
        @click="emit('approve')"
      >
        确认保存
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.review-confirmation-card {
  width: min(100%, 30rem);
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}
</style>
