<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMockInterviewCreatePresentation } from '@/shared/chat/schemas'
import type {
  OpportunityIntentionConfirmationStatus as ConfirmationStatus,
  ToolConfirmationDecision,
} from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatMockInterviewCreatePresentation
  status: ConfirmationStatus
  pendingDecision?: ToolConfirmationDecision | null
  sessionId?: string | null
}>()
const emit = defineEmits<{ approve: []; reject: [] }>()

const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在创建' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '蓝图生成中' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '创建失败' }
  return { icon: 'i-lucide-message-square-code', label: '等待你的确认' }
})
</script>

<template>
  <section class="mock-interview-confirmation-card" aria-label="创建模拟面试确认">
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

    <dl class="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5 text-xs">
      <div>
        <dt class="text-[10px] text-muted">类型</dt>
        <dd class="mt-0.5 font-medium text-highlighted">{{ presentation.typeLabel }}</dd>
      </div>
      <div>
        <dt class="text-[10px] text-muted">规模</dt>
        <dd class="mt-0.5 font-medium text-highlighted">
          {{ presentation.scaleLabel }} · 约 {{ presentation.configuration.budget.totalQuestionBudget }} 题
        </dd>
      </div>
      <div>
        <dt class="text-[10px] text-muted">难度</dt>
        <dd class="mt-0.5 font-medium text-highlighted">{{ presentation.difficultyLabel }}</dd>
      </div>
      <div>
        <dt class="text-[10px] text-muted">历史薄弱项</dt>
        <dd class="mt-0.5 font-medium text-highlighted">
          {{ presentation.configuration.referenceHistoricalWeaknesses ? '参考' : '不参考' }}
        </dd>
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

    <div v-else-if="status === 'completed'" class="mt-3 flex justify-end">
      <UButton
        :to="
          sessionId
            ? { name: 'opportunity-interview-session', params: { id: presentation.opportunityId, sessionId } }
            : { name: 'opportunity-interviews', params: { id: presentation.opportunityId } }
        "
        color="primary"
        variant="soft"
        size="xs"
        trailing-icon="i-lucide-arrow-up-right"
      >
        查看模拟面试
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.mock-interview-confirmation-card {
  width: min(100%, 30rem);
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}
</style>
