<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatOpportunityTerminationInputPresentation } from '@/shared/chat/schemas'
import type { OpportunityIntentionConfirmationStatus } from './OpportunityIntentionConfirmationCard.vue'

const props = defineProps<{
  presentation: ChatOpportunityTerminationInputPresentation
  status: OpportunityIntentionConfirmationStatus
  pending?: boolean
  cancelling?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  submit: [value: { reasonNote: string }]
  cancel: []
}>()

const reasonNote = ref(props.presentation.values.reasonNote)
watch(
  () => props.presentation.values.reasonNote,
  (value) => {
    reasonNote.value = value
  },
)

const interactionPending = computed(() => Boolean(props.pending || props.cancelling || props.status === 'approving'))
const statusCopy = computed(() => {
  if (props.status === 'approving') return { icon: 'i-lucide-loader-circle', label: '正在终止', tone: 'primary' }
  if (props.status === 'completed') return { icon: 'i-lucide-circle-check', label: '已终止', tone: 'success' }
  if (props.status === 'rejected') return { icon: 'i-lucide-circle-x', label: '已取消', tone: 'neutral' }
  if (props.status === 'failed') return { icon: 'i-lucide-circle-alert', label: '终止失败', tone: 'error' }
  return { icon: 'i-lucide-triangle-alert', label: '等待你确认', tone: 'warning' }
})

function submit() {
  if (interactionPending.value || props.status !== 'waiting') return
  emit('submit', { reasonNote: reasonNote.value.trim() })
}
</script>

<template>
  <section class="termination-card" aria-label="终止机会流程确认">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
        <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
      </div>
      <span class="termination-status" :class="`is-${statusCopy.tone}`">
        <UIcon :name="statusCopy.icon" class="size-3.5" :class="status === 'approving' ? 'animate-spin' : ''" />
        {{ statusCopy.label }}
      </span>
    </header>

    <div class="mt-3 flex items-center gap-2 rounded-xl bg-[var(--app-surface-muted)] px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <p class="text-[10px] text-muted">当前阶段</p>
        <p class="mt-0.5 text-sm font-semibold text-highlighted">{{ presentation.fromStatusLabel }}</p>
      </div>
      <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-muted" />
      <div class="min-w-0 flex-1 text-right">
        <p class="text-[10px] text-muted">修改为</p>
        <p class="mt-0.5 text-sm font-semibold text-error">已终止</p>
      </div>
    </div>

    <label class="mt-3 block">
      <span class="mb-1.5 block text-[11px] font-medium text-muted">终止原因（可选）</span>
      <UTextarea
        v-if="status === 'waiting'"
        v-model="reasonNote"
        class="w-full"
        :rows="3"
        autoresize
        maxlength="1000"
        placeholder="例如：已接受其他 offer、薪资不匹配"
        :disabled="interactionPending"
      />
      <p v-else class="rounded-lg bg-[var(--app-surface-muted)] px-3 py-2 text-xs leading-5 text-toned">
        {{ presentation.values.reasonNote || '未填写终止原因' }}
      </p>
    </label>

    <p class="mt-2 flex items-start gap-1.5 rounded-lg bg-error/8 px-2.5 py-2 text-[11px] leading-5 text-error">
      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
      {{ presentation.warning }}
    </p>
    <p v-if="status === 'failed'" class="mt-2 text-[11px] leading-5 text-error">
      {{ errorMessage || '当前修改失败，请根据最新机会状态重试。' }}
    </p>

    <div v-if="status === 'waiting'" class="mt-3 flex justify-end gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="cancelling"
        :disabled="interactionPending"
        @click="emit('cancel')"
      >
        取消
      </UButton>
      <UButton
        type="button"
        color="error"
        variant="solid"
        size="xs"
        :loading="pending"
        :disabled="interactionPending"
        @click="submit"
      >
        确认终止
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.termination-card {
  width: min(100%, 28rem);
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ui-error) 20%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 97%, var(--ui-error) 3%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.termination-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.3rem;
  border-radius: 9999px;
  padding: 0.2rem 0.45rem;
  font-size: 0.625rem;
  line-height: 0.875rem;
}

.termination-status.is-primary,
.termination-status.is-success {
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  color: var(--ui-primary);
}

.termination-status.is-warning,
.termination-status.is-error {
  background: color-mix(in srgb, var(--ui-error) 10%, transparent);
  color: var(--ui-error);
}

.termination-status.is-neutral {
  background: var(--app-surface-muted);
  color: var(--ui-text-muted);
}
</style>
