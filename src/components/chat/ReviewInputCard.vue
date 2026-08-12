<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatReviewInputPresentation } from '@/shared/chat/schemas'
import { toDateTimeLocalInput } from '@/shared/formatDate'

const props = defineProps<{
  presentation: ChatReviewInputPresentation
  pending?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{
  submit: [
    value: {
      roundId?: string
      occurredAt?: string
      reviewNote: string
      mode: 'append' | 'replace'
      result?: 'passed' | 'failed' | 'unknown'
    },
  ]
  cancel: []
}>()

const saveModeItems = [
  { label: '追加到已有复盘', value: 'append' },
  { label: '替换已有复盘', value: 'replace' },
]
const interviewResultItems = [
  { label: '结果未知', value: 'unknown' },
  { label: '已通过', value: 'passed' },
  { label: '未通过', value: 'failed' },
]
const roundItems = computed(() =>
  props.presentation.targetOptions
    .filter((target) => target.type === 'interview_round')
    .map((target) => ({ label: target.label, value: target.id })),
)
const selectedRoundId = ref(
  props.presentation.values.roundId ??
    (props.presentation.target?.type === 'interview_round' ? props.presentation.target.id : ''),
)
const occurredAt = ref(toDateTimeLocalInput(props.presentation.values.occurredAt))
const reviewNote = ref(props.presentation.values.reviewNote ?? '')
const saveMode = ref<'append' | 'replace'>(props.presentation.values.mode)
const interviewResult = ref<'passed' | 'failed' | 'unknown'>(props.presentation.values.result ?? 'unknown')

watch(
  () => props.presentation,
  (presentation) => {
    selectedRoundId.value =
      presentation.values.roundId ?? (presentation.target?.type === 'interview_round' ? presentation.target.id : '')
    occurredAt.value = toDateTimeLocalInput(presentation.values.occurredAt)
    reviewNote.value = presentation.values.reviewNote ?? ''
    saveMode.value = presentation.values.mode
    interviewResult.value = presentation.values.result ?? 'unknown'
  },
)

const occurredDate = computed(() => (occurredAt.value ? new Date(occurredAt.value) : null))
const timeError = computed(() => {
  if (!occurredDate.value) return ''
  if (Number.isNaN(occurredDate.value.getTime())) return '请输入有效时间'
  if (occurredDate.value.getTime() > Date.now()) return `${props.presentation.sourceLabel}时间不能晚于当前时间`
  return ''
})
const interactionPending = computed(() => Boolean(props.pending || props.cancelling))
const requiresOccurredAt = computed(() => props.presentation.missingArguments.includes('occurredAt'))
const canSubmit = computed(() =>
  Boolean(
    reviewNote.value.trim() &&
    !timeError.value &&
    (!requiresOccurredAt.value || occurredDate.value) &&
    (props.presentation.sourceType !== 'interview' || selectedRoundId.value) &&
    !interactionPending.value,
  ),
)

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    ...(props.presentation.sourceType === 'interview' ? { roundId: selectedRoundId.value } : {}),
    ...(occurredDate.value ? { occurredAt: occurredDate.value.toISOString() } : {}),
    reviewNote: reviewNote.value.trim(),
    mode: saveMode.value,
    ...(props.presentation.sourceType === 'interview' ? { result: interviewResult.value } : {}),
  })
}
</script>

<template>
  <section class="review-input-card" :aria-label="presentation.title">
    <header>
      <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
      <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
    </header>

    <form class="review-form" @submit.prevent="submit">
      <label v-if="presentation.sourceType === 'interview'" class="review-field">
        <span class="review-field__label">面试轮次 <b class="text-error">*</b></span>
        <USelect
          v-model="selectedRoundId"
          class="review-field__control"
          :items="roundItems"
          value-key="value"
          :portal="true"
          :ui="{ content: 'app-popover-layer' }"
          placeholder="选择要记录的面试轮次"
          :disabled="interactionPending"
        />
      </label>

      <label class="review-field">
        <span class="review-field__label">{{ presentation.sourceLabel }}时间</span>
        <ChatDateTimePicker
          v-model="occurredAt"
          class="review-field__control"
          :placeholder="`选择${presentation.sourceLabel}日期和时间`"
          allow-clear
          disable-future-dates
          :invalid="Boolean(timeError)"
          :disabled="interactionPending"
        />
        <span v-if="timeError" class="review-field__error">{{ timeError }}</span>
      </label>

      <label v-if="presentation.sourceType === 'interview'" class="review-field">
        <span class="review-field__label">面试结果</span>
        <USelect
          v-model="interviewResult"
          class="review-field__control"
          :items="interviewResultItems"
          value-key="value"
          :portal="true"
          :ui="{ content: 'app-popover-layer' }"
          :disabled="interactionPending"
        />
      </label>

      <label class="review-field">
        <span class="review-field__label">保存方式</span>
        <USelect
          v-model="saveMode"
          class="review-field__control"
          :items="saveModeItems"
          value-key="value"
          :portal="true"
          :ui="{ content: 'app-popover-layer' }"
          :disabled="interactionPending"
        />
      </label>

      <label class="review-field review-field--textarea">
        <span class="review-field__label">复盘内容 <b class="text-error">*</b></span>
        <UTextarea
          v-model="reviewNote"
          class="review-field__control"
          :rows="6"
          autoresize
          :maxlength="50000"
          placeholder="记录题目、回答、卡点和自己的思考；不要求固定格式。"
          :disabled="interactionPending"
        />
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
        <UButton type="submit" color="primary" size="xs" :loading="pending" :disabled="!canSubmit"> 下一步 </UButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.review-input-card {
  width: 100%;
  max-width: 30rem;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  container-name: review-input-card;
  container-type: inline-size;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.review-form {
  display: grid;
  min-width: 0;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.review-field {
  display: grid;
  min-width: 0;
  grid-template-columns: 5.75rem minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  color: var(--app-text-muted);
  font-size: 0.6875rem;
  font-weight: 500;
}

.review-field--textarea {
  align-items: start;
}

.review-field--textarea .review-field__label {
  padding-top: 0.55rem;
}

.review-field__label,
.review-field__control {
  min-width: 0;
  max-width: 100%;
}

.review-field__control {
  width: 100%;
}

.review-field__error {
  grid-column: 2;
  color: var(--app-danger);
  font-size: 0.625rem;
}

.review-field__control :deep(button),
.review-field__control :deep(input),
.review-field__control :deep(textarea) {
  max-width: 100%;
}

@container review-input-card (max-width: 22rem) {
  .review-field {
    grid-template-columns: 1fr;
    gap: 0.375rem;
  }

  .review-field--textarea .review-field__label {
    padding-top: 0;
  }

  .review-field__error {
    grid-column: 1;
  }
}
</style>
