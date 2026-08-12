<script setup lang="ts">
import { CalendarDate, Time, type DateValue } from '@internationalized/date'
import { computed, ref, shallowRef, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    allowClear?: boolean
    disablePastDates?: boolean
    disableFutureDates?: boolean
    defaultTimeOffsetMinutes?: number
  }>(),
  {
    placeholder: '选择日期和时间',
    disabled: false,
    invalid: false,
    allowClear: false,
    disablePastDates: false,
    disableFutureDates: false,
    defaultTimeOffsetMinutes: 0,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const selectedDate = shallowRef<DateValue>()
const selectedTime = shallowRef<Time>()

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toCalendarDate(date: Date) {
  return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function createDefaultTime() {
  const date = new Date(Date.now() + props.defaultTimeOffsetMinutes * 60_000)
  const roundedMinute = Math.ceil(date.getMinutes() / 5) * 5
  if (roundedMinute === 60) {
    date.setHours(date.getHours() + 1, 0, 0, 0)
  } else {
    date.setMinutes(roundedMinute, 0, 0)
  }
  return new Time(date.getHours(), date.getMinutes())
}

function syncPartsFromModel(value: string) {
  if (!value) {
    selectedDate.value = undefined
    selectedTime.value = undefined
    return
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return
  selectedDate.value = toCalendarDate(date)
  selectedTime.value = new Time(date.getHours(), date.getMinutes())
}

watch(() => props.modelValue, syncPartsFromModel, { immediate: true })

const todayDate = computed(() => toCalendarDate(new Date()))
const minimumDate = computed(() => (props.disablePastDates ? todayDate.value : undefined))
const maximumDate = computed(() => (props.disableFutureDates ? todayDate.value : undefined))
const displayValue = computed(() => {
  if (!props.modelValue) return props.placeholder
  const date = new Date(props.modelValue)
  if (Number.isNaN(date.getTime())) return props.placeholder

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
})

function emitCombinedValue() {
  if (!selectedDate.value) return
  selectedTime.value ??= createDefaultTime()

  emit(
    'update:modelValue',
    `${selectedDate.value.year}-${pad(selectedDate.value.month)}-${pad(selectedDate.value.day)}T${pad(selectedTime.value.hour)}:${pad(selectedTime.value.minute)}`,
  )
}

function selectDate(value: DateValue | undefined) {
  selectedDate.value = value
  if (!value) return
  emitCombinedValue()
}

function selectTime(value: Time | undefined) {
  selectedTime.value = value
  if (!value || !selectedDate.value) return
  emitCombinedValue()
}

function clearValue() {
  selectedDate.value = undefined
  selectedTime.value = undefined
  emit('update:modelValue', '')
}
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'app-popover-layer overflow-hidden p-0' }">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      icon="i-lucide-calendar-clock"
      trailing-icon="i-lucide-chevron-down"
      class="date-time-trigger w-full min-w-0 justify-between text-left"
      :class="{ 'date-time-trigger--invalid': invalid }"
      :disabled="disabled"
      :aria-label="displayValue"
    >
      <span class="min-w-0 flex-1 truncate" :class="modelValue ? 'text-highlighted' : 'text-muted'">
        {{ displayValue }}
      </span>
    </UButton>

    <template #content>
      <div class="date-time-panel">
        <UCalendar
          :model-value="selectedDate"
          locale="zh-CN"
          size="sm"
          :min-value="minimumDate"
          :max-value="maximumDate"
          @update:model-value="selectDate"
        />

        <div class="date-time-panel__footer">
          <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-clock-3" class="size-4 shrink-0 text-muted" />
            <UInputTime
              :model-value="selectedTime"
              class="min-w-0 flex-1"
              locale="zh-CN"
              :hour-cycle="24"
              granularity="minute"
              :step="{ minute: 5 }"
              :disabled="!selectedDate"
              @update:model-value="selectTime"
            />
          </div>

          <div class="flex items-center justify-end gap-1.5">
            <UButton
              v-if="allowClear && modelValue"
              type="button"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="clearValue"
            >
              清空
            </UButton>
            <UButton type="button" color="primary" size="xs" :disabled="!selectedDate" @click="open = false">
              完成
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>

<style scoped>
.date-time-trigger {
  overflow: hidden;
}

.date-time-trigger--invalid {
  box-shadow: 0 0 0 1px var(--ui-error);
}

.date-time-panel {
  width: min(19rem, calc(100vw - 2rem));
  background: var(--app-surface);
}

.date-time-panel :deep([data-slot='root']) {
  width: 100%;
}

.date-time-panel__footer {
  display: grid;
  gap: 0.75rem;
  border-top: 1px solid var(--app-border);
  padding: 0.75rem;
}
</style>
