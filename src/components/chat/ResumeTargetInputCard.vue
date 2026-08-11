<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatResumeTargetInputPresentation } from '@/shared/chat/schemas'

const props = defineProps<{
  requestId: string
  presentation: ChatResumeTargetInputPresentation
  pending?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{
  submit: [value: { resumeId: string }]
  cancel: []
}>()

const selectedResumeId = ref<string | null>(null)

watch(
  () => props.requestId,
  () => {
    selectedResumeId.value = null
  },
)

const interactionPending = computed(() => Boolean(props.pending || props.cancelling))
const description = computed(() => {
  if (props.presentation.description) return props.presentation.description
  if (props.presentation.reason === 'ambiguous_reference') {
    return `找到了多份与“${props.presentation.reference ?? ''}”匹配的简历，请选择本次能力画像使用的主线。`
  }
  if (props.presentation.reason === 'not_found') {
    return `没有唯一找到“${props.presentation.reference ?? ''}”，你可以从已保存简历中选择。`
  }
  return '当前存在多份简历，请选择本次能力画像使用的简历主线。'
})

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function submit() {
  if (!selectedResumeId.value || interactionPending.value) return
  emit('submit', { resumeId: selectedResumeId.value })
}
</script>

<template>
  <section class="resume-target-card" aria-label="选择能力画像使用的简历">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
        <p class="mt-1 text-[11px] leading-5 text-muted">{{ description }}</p>
      </div>
      <UIcon name="i-lucide-file-user" class="mt-0.5 size-4 shrink-0 text-primary" />
    </header>

    <div class="resume-target-list mt-3" role="radiogroup" aria-label="候选简历">
      <button
        v-for="candidate in presentation.candidates"
        :key="candidate.resumeId"
        type="button"
        class="resume-target-option"
        :class="{ 'is-selected': selectedResumeId === candidate.resumeId }"
        :aria-checked="selectedResumeId === candidate.resumeId"
        :disabled="interactionPending"
        role="radio"
        @click="selectedResumeId = candidate.resumeId"
      >
        <span class="min-w-0 flex-1 text-left">
          <strong class="block truncate text-xs font-semibold text-highlighted">{{ candidate.title }}</strong>
          <span class="mt-0.5 block text-[11px] text-muted">更新于 {{ formatUpdatedAt(candidate.updatedAt) }}</span>
        </span>
        <UIcon
          :name="selectedResumeId === candidate.resumeId ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
          class="size-4 shrink-0"
          :class="selectedResumeId === candidate.resumeId ? 'text-primary' : 'text-dimmed'"
        />
      </button>
    </div>

    <div class="mt-3 flex justify-end gap-2">
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
        color="primary"
        size="xs"
        :loading="pending"
        :disabled="interactionPending || !selectedResumeId"
        @click="submit"
      >
        继续
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.resume-target-card {
  width: min(100%, 32rem);
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.resume-target-list {
  display: grid;
  max-height: min(19rem, 42vh);
  gap: 0.45rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.15rem;
}

.resume-target-option {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: 0.75rem;
  background: var(--app-surface);
  padding: 0.625rem 0.7rem;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.resume-target-option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ui-primary) 38%, var(--app-border));
}

.resume-target-option.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--app-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-primary) 10%, transparent);
}
</style>
