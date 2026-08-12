<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatMockInterviewInputPresentation } from '@/shared/chat/schemas'

const props = defineProps<{
  presentation: ChatMockInterviewInputPresentation
  pending?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{
  submit: [
    value: {
      type: 'foundation' | 'project'
      scale: 'quick' | 'standard' | 'deep'
      difficulty: 'basic' | 'standard' | 'advanced' | 'adaptive'
      referenceHistoricalWeaknesses: boolean
    },
  ]
  cancel: []
}>()

const typeOptions = [
  { label: '基础面', description: '侧重岗位基础与通用能力', value: 'foundation' as const },
  { label: '项目面', description: '侧重项目经历与技术决策', value: 'project' as const },
]
const scaleOptions = [
  { label: '快速', description: '约 5 题', value: 'quick' as const },
  { label: '标准', description: '约 9 题', value: 'standard' as const },
  { label: '深度', description: '约 14 题', value: 'deep' as const },
]
const difficultyOptions = [
  { label: '简单', value: 'basic' as const },
  { label: '标准', value: 'standard' as const },
  { label: '进阶', value: 'advanced' as const },
  { label: '自适应', value: 'adaptive' as const },
]

const interviewType = ref(props.presentation.values.type ?? 'foundation')
const scale = ref(props.presentation.values.scale ?? 'standard')
const difficulty = ref(props.presentation.values.difficulty ?? 'adaptive')
const referenceHistoricalWeaknesses = ref(props.presentation.values.referenceHistoricalWeaknesses ?? true)

watch(
  () => props.presentation,
  (presentation) => {
    interviewType.value = presentation.values.type ?? 'foundation'
    scale.value = presentation.values.scale ?? 'standard'
    difficulty.value = presentation.values.difficulty ?? 'adaptive'
    referenceHistoricalWeaknesses.value = presentation.values.referenceHistoricalWeaknesses ?? true
  },
)

const interactionPending = computed(() => Boolean(props.pending || props.cancelling))

function submit() {
  if (interactionPending.value) return
  emit('submit', {
    type: interviewType.value,
    scale: scale.value,
    difficulty: difficulty.value,
    referenceHistoricalWeaknesses: referenceHistoricalWeaknesses.value,
  })
}
</script>

<template>
  <section class="mock-interview-input-card" aria-label="配置模拟面试">
    <header>
      <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
      <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
    </header>

    <form class="mt-3 grid gap-3" @submit.prevent="submit">
      <fieldset class="mock-config-field">
        <legend>面试类型</legend>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            type="button"
            class="mock-option mock-option--described"
            :class="{ 'is-selected': interviewType === option.value }"
            :aria-pressed="interviewType === option.value"
            :disabled="interactionPending"
            @click="interviewType = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>
      </fieldset>

      <fieldset class="mock-config-field">
        <legend>面试规模</legend>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="option in scaleOptions"
            :key="option.value"
            type="button"
            class="mock-option mock-option--described"
            :class="{ 'is-selected': scale === option.value }"
            :aria-pressed="scale === option.value"
            :disabled="interactionPending"
            @click="scale = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>
      </fieldset>

      <fieldset class="mock-config-field">
        <legend>面试难度</legend>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="option in difficultyOptions"
            :key="option.value"
            type="button"
            class="mock-option"
            :class="{ 'is-selected': difficulty === option.value }"
            :aria-pressed="difficulty === option.value"
            :disabled="interactionPending"
            @click="difficulty = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <label class="history-switch">
        <span>
          <strong>参考历史薄弱项</strong>
          <small>根据历史面试与真实复盘调整考点</small>
        </span>
        <USwitch v-model="referenceHistoricalWeaknesses" :disabled="interactionPending" />
      </label>

      <div class="flex justify-end gap-2">
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
        <UButton type="submit" color="primary" size="xs" :loading="pending" :disabled="interactionPending">
          下一步
        </UButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.mock-interview-input-card {
  width: min(100%, 32rem);
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.mock-config-field {
  min-width: 0;
}

.mock-config-field legend {
  margin-bottom: 0.375rem;
  color: var(--app-text-muted);
  font-size: 0.6875rem;
  font-weight: 600;
}

.mock-option {
  min-width: 0;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-surface);
  padding: 0.5rem 0.4rem;
  color: var(--app-text-muted);
  font-size: 0.6875rem;
  line-height: 1.2;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.mock-option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ui-primary) 40%, var(--app-border));
}

.mock-option.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--app-border));
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--app-surface));
  color: var(--ui-primary);
}

.mock-option--described {
  display: grid;
  gap: 0.2rem;
  text-align: left;
}

.mock-option--described strong {
  color: var(--app-text);
  font-size: 0.75rem;
}

.mock-option--described span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-radius: 0.75rem;
  background: var(--app-surface-muted);
  padding: 0.625rem 0.75rem;
}

.history-switch > span {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.history-switch strong {
  color: var(--app-text);
  font-size: 0.6875rem;
}

.history-switch small {
  overflow: hidden;
  color: var(--app-text-muted);
  font-size: 0.625rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 420px) {
  .mock-config-field .grid-cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
