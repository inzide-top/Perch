<script setup lang="ts">
import { computed, ref } from 'vue'
import { interviewAnswerContentMaxLength } from '@/shared/interview/schemas'
import type { InterviewQuestion, SkipReason } from '@/types/interview'

const props = defineProps<{
  question: InterviewQuestion | null
  modelValue: string
  disabled: boolean
  submitting: boolean
  cancellable: boolean
  cancelling: boolean
  cancellationPending: boolean
  skipping: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  cancelSubmit: []
  requestHint: [level: 'level_1' | 'level_2']
  skip: [reason: SkipReason]
}>()

const isSkipPopoverOpen = ref(false)
const skipReason = ref<SkipReason>('unspecified')

const canSubmit = computed(
  () =>
    Boolean(props.modelValue.trim()) &&
    props.modelValue.length <= interviewAnswerContentMaxLength &&
    !props.disabled &&
    !props.submitting &&
    !props.cancellationPending &&
    !props.skipping,
)
const answerLength = computed(() => props.modelValue.length)
const hasRevealedHint = computed(() => Boolean(props.question && props.question.revealedHintLevel !== 'none'))
const hasFirstHint = computed(
  () => props.question?.revealedHintLevel === 'level_1' || props.question?.revealedHintLevel === 'level_2',
)
const hasSecondHint = computed(() => props.question?.revealedHintLevel === 'level_2')
const nextHintLevel = computed<'level_1' | 'level_2' | null>(() => {
  if (props.question?.revealedHintLevel === 'none') return 'level_1'
  if (props.question?.revealedHintLevel === 'level_1') return 'level_2'
  return null
})
const hintButtonLabel = computed(() => {
  if (nextHintLevel.value === 'level_1') return '获取提示'
  if (nextHintLevel.value === 'level_2') return '更具体的提示'
  return '已显示全部提示'
})
const skipReasonOptions: Array<{ label: string; value: SkipReason }> = [
  { label: '不说明原因', value: 'unspecified' },
  { label: '不会回答', value: 'unknown' },
  { label: '难度太高', value: 'too_hard' },
  { label: '问题不清楚', value: 'unclear' },
  { label: '与岗位无关', value: 'irrelevant' },
  { label: '暂不想回答', value: 'declined' },
]

function requestNextHint() {
  if (!nextHintLevel.value || props.disabled || props.submitting || props.cancellationPending || props.skipping) return
  emit('requestHint', nextHintLevel.value)
}

function skip() {
  if (props.disabled || props.submitting || props.cancellationPending || props.skipping) return
  isSkipPopoverOpen.value = false
  emit('skip', skipReason.value)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return

  event.preventDefault()
  if (canSubmit.value) emit('submit')
}
</script>

<template>
  <section class="interview-composer" aria-label="回答当前问题">
    <Transition name="interview-hint-first">
      <section
        v-if="question && hasFirstHint"
        class="interview-hint-panel interview-hint-panel-first"
        role="status"
        aria-live="polite"
      >
        <div class="interview-hint-header">
          <UIcon name="i-lucide-lightbulb" class="size-3.5" />
          <span>辅助提示</span>
        </div>
        <div class="interview-hint-content">
          <span class="interview-hint-level">提示</span>
          <p>{{ question.hintLevel1 }}</p>
        </div>
      </section>
    </Transition>

    <Transition name="interview-hint-second">
      <section
        v-if="question && hasSecondHint"
        class="interview-hint-panel interview-hint-content interview-hint-panel-second"
        role="status"
        aria-live="polite"
      >
        <span class="interview-hint-level">具体</span>
        <p>{{ question.hintLevel2 }}</p>
      </section>
    </Transition>

    <UTextarea
      :model-value="modelValue"
      class="w-full"
      :rows="4"
      :maxlength="interviewAnswerContentMaxLength"
      :ui="{ base: hasRevealedHint ? 'rounded-t-none border-t-0' : undefined }"
      :disabled="disabled || submitting || skipping"
      placeholder="结合真实经历回答。评估完成前可中止并撤回编辑。"
      @keydown="handleKeydown"
      @update:model-value="emit('update:modelValue', String($event ?? ''))"
    />

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-lightbulb"
          :disabled="disabled || submitting || cancellationPending || skipping || !nextHintLevel"
          @click="requestNextHint"
        >
          {{ hintButtonLabel }}
        </UButton>

        <UPopover v-model:open="isSkipPopoverOpen" :portal="true" :ui="{ content: 'z-[160]' }">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-forward"
            :disabled="disabled || submitting || cancellationPending || skipping"
          >
            跳过问题
          </UButton>
          <template #content>
            <div class="w-64 p-3">
              <p class="text-sm font-medium text-highlighted">跳过当前问题？</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                无关或不清楚的问题不会消耗题目额度；其他跳过会计入本轮练习。
              </p>
              <div class="mt-3 grid grid-cols-2 gap-1.5">
                <button
                  v-for="option in skipReasonOptions"
                  :key="option.value"
                  type="button"
                  class="interview-skip-reason"
                  :class="{ 'is-selected': skipReason === option.value }"
                  @click="skipReason = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
              <div class="mt-3 flex justify-end gap-2">
                <UButton type="button" color="neutral" variant="ghost" size="sm" @click="isSkipPopoverOpen = false"
                  >取消</UButton
                >
                <UButton
                  type="button"
                  color="warning"
                  size="sm"
                  :loading="skipping"
                  :disabled="disabled || submitting || cancellationPending || skipping"
                  @click="skip"
                  >确认跳过</UButton
                >
              </div>
            </div>
          </template>
        </UPopover>
      </div>

      <button
        v-if="cancellable"
        type="button"
        class="interview-stop-button"
        :disabled="cancelling"
        aria-label="中止并撤回当前回答"
        title="中止并撤回当前回答"
        @click="emit('cancelSubmit')"
      >
        <UIcon v-if="cancelling" name="i-lucide-loader-circle" class="size-4 animate-spin" />
        <span v-else class="interview-stop-glyph" aria-hidden="true" />
      </button>
      <UButton
        v-else
        type="button"
        icon="i-lucide-send"
        class="app-primary-button"
        :loading="submitting || cancellationPending || skipping"
        :disabled="!canSubmit"
        @click="emit('submit')"
      >
        {{ cancellationPending ? '正在恢复编辑…' : skipping ? '正在跳过…' : '发送回答' }}
      </UButton>
    </div>
    <div class="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 text-muted">
      <p>Enter 发送 · Shift + Enter 换行。使用提示会降低本题能力证据权重；AI 输出期间操作会保留但不可点击。</p>
      <span class="shrink-0 tabular-nums">{{ answerLength }} / {{ interviewAnswerContentMaxLength }}</span>
    </div>
  </section>
</template>
