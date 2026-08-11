<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatInterviewScheduleInputPresentation } from '@/shared/chat/schemas'
import { toDateTimeLocalInput } from '@/shared/formatDate'

const props = defineProps<{
  presentation: ChatInterviewScheduleInputPresentation
  pending?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{
  submit: [value: { type: string; scheduledAt: string; title?: string; note?: string }]
  cancel: []
}>()

const typeItems = [
  { label: '基础面', value: 'technical_basic' },
  { label: '项目面', value: 'project' },
  { label: '业务面', value: 'business' },
  { label: 'HR 面', value: 'hr' },
  { label: '主管面', value: 'manager' },
  { label: '其他', value: 'other' },
]

const selectContent = {
  align: 'start' as const,
  sideOffset: 6,
  collisionPadding: 12,
}

const roundType = ref(props.presentation.values.type ?? '')
const scheduledAt = ref(toDateTimeLocalInput(props.presentation.values.scheduledAt))
const title = ref(props.presentation.values.title ?? '')
const note = ref(props.presentation.values.note ?? '')

watch(
  () => props.presentation,
  (presentation) => {
    roundType.value = presentation.values.type ?? ''
    scheduledAt.value = toDateTimeLocalInput(presentation.values.scheduledAt)
    title.value = presentation.values.title ?? ''
    note.value = presentation.values.note ?? ''
  },
)

const scheduledDate = computed(() => (scheduledAt.value ? new Date(scheduledAt.value) : null))
const timeError = computed(() => {
  if (!scheduledDate.value) return ''
  if (Number.isNaN(scheduledDate.value.getTime())) return '请输入有效时间'
  if (scheduledDate.value.getTime() <= Date.now()) return '面试时间需要晚于当前时间'
  return ''
})
const interactionPending = computed(() => Boolean(props.pending || props.cancelling))
const canSubmit = computed(() =>
  Boolean(roundType.value && scheduledDate.value && !timeError.value && !interactionPending.value),
)

function submit() {
  if (!canSubmit.value || !scheduledDate.value) return
  emit('submit', {
    type: roundType.value,
    scheduledAt: scheduledDate.value.toISOString(),
    ...(title.value.trim() ? { title: title.value.trim() } : {}),
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
  })
}
</script>

<template>
  <section class="schedule-input-card" aria-label="补全面试安排">
    <header>
      <p class="text-xs font-semibold text-highlighted">{{ presentation.title }}</p>
      <p class="mt-0.5 truncate text-[11px] text-muted">{{ presentation.company }} · {{ presentation.jobTitle }}</p>
    </header>

    <form class="schedule-form" @submit.prevent="submit">
      <div class="schedule-form__fields">
        <label class="schedule-field">
          <span class="schedule-field__label">面试类型 <b class="text-error">*</b></span>
          <USelect
            v-model="roundType"
            class="schedule-field__control"
            :items="typeItems"
            value-key="value"
            placeholder="请选择面试类型"
            :portal="true"
            :content="selectContent"
            :ui="{ content: 'app-popover-layer' }"
            :disabled="interactionPending"
          />
        </label>
        <label class="schedule-field">
          <span class="schedule-field__label">面试时间 <b class="text-error">*</b></span>
          <ChatDateTimePicker
            v-model="scheduledAt"
            class="schedule-field__control"
            placeholder="选择面试日期和时间"
            disable-past-dates
            :default-time-offset-minutes="30"
            :invalid="Boolean(timeError)"
            :disabled="interactionPending"
          />
          <span v-if="timeError" class="schedule-field__error">{{ timeError }}</span>
        </label>
      </div>

      <label class="schedule-field">
        <span class="schedule-field__label">标题（可选）</span>
        <UInput
          v-model="title"
          class="schedule-field__control"
          maxlength="100"
          placeholder="例如：二面 · 项目面"
          :disabled="interactionPending"
        />
      </label>
      <label class="schedule-field schedule-field--textarea">
        <span class="schedule-field__label">备注（可选）</span>
        <UTextarea
          v-model="note"
          class="schedule-field__control"
          :rows="2"
          autoresize
          maxlength="500"
          placeholder="会议方式、准备事项等"
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
.schedule-input-card {
  width: 100%;
  max-width: 28rem;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  container-name: schedule-card;
  container-type: inline-size;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--app-border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--ui-primary) 4%);
  padding: 0.875rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 6%);
}

.schedule-form {
  display: grid;
  min-width: 0;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.schedule-form__fields {
  display: grid;
  min-width: 0;
  gap: 0.75rem;
}

.schedule-field {
  display: grid;
  min-width: 0;
  grid-template-columns: 5.75rem minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  color: var(--app-text-muted);
  font-size: 0.6875rem;
  font-weight: 500;
}

.schedule-field--textarea {
  align-items: start;
}

.schedule-field--textarea .schedule-field__label {
  padding-top: 0.55rem;
}

.schedule-field__label,
.schedule-field__control {
  min-width: 0;
  max-width: 100%;
}

.schedule-field__control {
  width: 100%;
}

.schedule-field__error {
  grid-column: 2;
  color: var(--app-danger);
  font-size: 0.625rem;
}

.schedule-field__control :deep(button),
.schedule-field__control :deep(input),
.schedule-field__control :deep(textarea) {
  max-width: 100%;
}

@container schedule-card (max-width: 22rem) {
  .schedule-field {
    grid-template-columns: 1fr;
    gap: 0.375rem;
  }

  .schedule-field--textarea .schedule-field__label {
    padding-top: 0;
  }

  .schedule-field__error {
    grid-column: 1;
  }
}
</style>
