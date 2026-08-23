<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatOpportunityTargetInputPresentation } from '@/shared/chat/schemas'

const props = defineProps<{
  requestId: string
  presentation: ChatOpportunityTargetInputPresentation
  pending?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{
  submit: [value: { opportunityId: string }]
  cancel: []
}>()

const selectedOpportunityId = ref<string | null>(null)

watch(
  () => props.requestId,
  () => {
    selectedOpportunityId.value = null
  },
)

const interactionPending = computed(() => Boolean(props.pending || props.cancelling))
const description = computed(() => {
  if (props.presentation.description) return props.presentation.description
  if (props.presentation.reason === 'ambiguous_reference') {
    return `找到了多个与“${props.presentation.reference ?? ''}”匹配的机会，请选择这次要读取的记录。`
  }
  if (props.presentation.reason === 'not_found') {
    return `没有唯一找到“${props.presentation.reference ?? ''}”，你可以从已保存机会中选择。`
  }
  return '这次问题还没有明确指向哪一个机会，请选择后继续。'
})

const sectionLabels: Record<ChatOpportunityTargetInputPresentation['sections'][number], string> = {
  profile: '机会资料',
  job_analysis: 'JD 分析',
  real_interviews: '真实复盘',
  mock_interviews: '模拟面试',
}

function submit() {
  if (!selectedOpportunityId.value || interactionPending.value) return
  emit('submit', { opportunityId: selectedOpportunityId.value })
}
</script>

<template>
  <section class="opportunity-target-card" aria-label="选择目标机会">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
        <p class="mt-1 text-[11px] leading-5 text-muted">{{ description }}</p>
      </div>
      <UIcon name="i-lucide-list-filter" class="mt-0.5 size-4 shrink-0 text-primary" />
    </header>

    <div v-if="presentation.sections.length > 0" class="mt-2 flex flex-wrap gap-1" aria-label="操作涉及的内容范围">
      <UBadge v-for="section in presentation.sections" :key="section" color="neutral" variant="soft" size="sm">
        {{ sectionLabels[section] }}
      </UBadge>
    </div>

    <div class="opportunity-target-list mt-3" role="radiogroup" aria-label="候选机会">
      <button
        v-for="candidate in presentation.candidates"
        :key="candidate.opportunityId"
        type="button"
        class="opportunity-target-option"
        :class="{ 'is-selected': selectedOpportunityId === candidate.opportunityId }"
        :aria-checked="selectedOpportunityId === candidate.opportunityId"
        :disabled="interactionPending"
        role="radio"
        @click="selectedOpportunityId = candidate.opportunityId"
      >
        <span class="min-w-0 flex-1 text-left">
          <strong class="block truncate text-xs font-semibold text-highlighted">{{ candidate.company }}</strong>
          <span class="mt-0.5 block truncate text-[11px] text-muted">{{ candidate.jobTitle }}</span>
          <span v-if="candidate.address.length" class="mt-0.5 block truncate text-[10px] text-dimmed">
            {{ candidate.address.join('、') }}
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <UBadge color="neutral" variant="soft" size="sm">{{ candidate.statusLabel }}</UBadge>
          <UBadge :color="candidate.intentionLevel ? 'primary' : 'neutral'" variant="subtle" size="sm">
            {{ candidate.intentionLevel ?? '未设置' }}
          </UBadge>
          <UIcon
            :name="selectedOpportunityId === candidate.opportunityId ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
            class="size-4"
            :class="selectedOpportunityId === candidate.opportunityId ? 'text-primary' : 'text-dimmed'"
          />
        </span>
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
        :disabled="interactionPending || !selectedOpportunityId"
        @click="submit"
      >
        继续
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.opportunity-target-card {
  width: min(100%, 32rem);
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.opportunity-target-list {
  display: grid;
  max-height: min(19rem, 42vh);
  gap: 0.45rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.15rem;
}

.opportunity-target-option {
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

.opportunity-target-option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ui-primary) 38%, var(--app-border));
}

.opportunity-target-option.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--app-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-primary) 10%, transparent);
}
</style>
