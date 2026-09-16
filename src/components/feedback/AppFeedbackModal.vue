<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { createFeedbackInputSchema, type FeedbackType } from '@/shared/feedback/schemas'
import { feedbackApi } from '@/services/feedback'

const isOpen = defineModel<boolean>('open', { required: true })
const toast = useToast()
const feedbackType = ref<FeedbackType | undefined>()
const content = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

const feedbackTypeOptions: Array<{ label: string; value: FeedbackType }> = [
  { label: 'Bug', value: 'bug' },
  { label: '意见改进', value: 'improvement' },
  { label: '功能迭代', value: 'feature' },
]

const contentLength = computed(() => content.value.trim().length)

function resetForm() {
  feedbackType.value = undefined
  content.value = ''
  errorMessage.value = ''
}

function closeModal() {
  if (isSubmitting.value) return
  isOpen.value = false
}

async function submitFeedback() {
  errorMessage.value = ''
  if (!feedbackType.value) {
    errorMessage.value = '请选择反馈类型'
    return
  }

  const parsed = createFeedbackInputSchema.safeParse({
    type: feedbackType.value,
    content: content.value,
  })

  if (!parsed.success) {
    errorMessage.value = parsed.error.issues[0]?.message ?? '请完整填写反馈内容'
    return
  }

  isSubmitting.value = true
  try {
    await feedbackApi.create(parsed.data)
    toast.add({ title: '反馈已提交', description: '感谢你的反馈，我们已经收到。', color: 'success' })
    isOpen.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交失败，请稍后重试'
  } finally {
    isSubmitting.value = false
  }
}

watch(isOpen, (open, wasOpen) => {
  if (open && !wasOpen) resetForm()
})
</script>

<template>
  <UModal
    :open="isOpen"
    title="提交反馈"
    description="遇到问题或有改进想法，都可以在这里告诉我们。"
    :dismissible="!isSubmitting"
    :ui="{
      overlay: 'app-overlay-layer',
      content: 'app-modal-layer w-[min(34rem,calc(100vw-2rem))]',
      body: 'p-0',
    }"
    @update:open="isOpen = $event"
  >
    <template #body>
      <form class="app-panel space-y-5 p-5 sm:p-6" @submit.prevent="submitFeedback">
        <div>
          <label for="feedback-type" class="mb-2 block text-sm font-medium text-highlighted">
            反馈类型 <span class="text-error">*</span>
          </label>
          <USelect
            id="feedback-type"
            v-model="feedbackType"
            :items="feedbackTypeOptions"
            value-key="value"
            label-key="label"
            placeholder="请选择反馈类型"
            class="w-full"
            :disabled="isSubmitting"
          />
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between gap-3">
            <label for="feedback-content" class="text-sm font-medium text-highlighted">
              反馈内容 <span class="text-error">*</span>
            </label>
            <span class="text-xs text-muted">{{ contentLength }}/2000</span>
          </div>
          <UTextarea
            id="feedback-content"
            v-model="content"
            :rows="7"
            :maxlength="2000"
            autoresize
            placeholder="请描述你遇到的问题、期望的改进，或想要的新功能……"
            class="w-full"
            :disabled="isSubmitting"
          />
        </div>

        <p v-if="errorMessage" class="flex items-start gap-2 text-sm text-error" role="alert">
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>{{ errorMessage }}</span>
        </p>

        <div class="flex justify-end gap-2 border-t border-default pt-4">
          <UButton type="button" color="neutral" variant="ghost" :disabled="isSubmitting" @click="closeModal">
            取消
          </UButton>
          <UButton type="submit" icon="i-lucide-send" :loading="isSubmitting">提交反馈</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
