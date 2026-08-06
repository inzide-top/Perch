<script setup lang="ts">
import type { WrittenTestReviewForm } from '../../types'
import type { ReviewDocumentSummary } from '@/types/review'

defineProps<{
  open: boolean
  saving: boolean
  dateLabel: string
  reviewDocument: ReviewDocumentSummary | null
  retryingDocumentId: string | null
}>()

const emit = defineEmits<{
  close: []
  save: []
  selectDate: [value: unknown]
  retry: [document: ReviewDocumentSummary]
}>()

const form = defineModel<WrittenTestReviewForm>('form', { required: true })
const datePopoverOpen = defineModel<boolean>('datePopoverOpen', { required: true })
const calendarDate = defineModel<unknown>('calendarDate', { required: true })

function getStatusLabel(status: ReviewDocumentSummary['status']) {
  if (status === 'pending') return '等待提取'
  if (status === 'processing') return '提取中'
  if (status === 'completed') return '已完成'
  return '提取失败'
}

function getStatusColor(status: ReviewDocumentSummary['status']) {
  if (status === 'pending') return 'neutral' as const
  if (status === 'processing') return 'warning' as const
  if (status === 'completed') return 'success' as const
  return 'error' as const
}
</script>

<template>
  <UDrawer
    :open="open"
    direction="right"
    :handle="false"
    :close="false"
    :dismissible="!saving"
    :ui="{
      overlay: 'bg-black/35 backdrop-blur-[2px]',
      content: 'app-drawer h-full w-full max-w-lg border-l border-default shadow-2xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && emit('close')"
  >
    <template #content>
      <section class="flex h-full min-h-0 w-full flex-col">
        <div class="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold text-highlighted">笔试复盘</h2>
              <UBadge
                v-if="reviewDocument"
                :color="getStatusColor(reviewDocument.status)"
                variant="subtle"
                :label="getStatusLabel(reviewDocument.status)"
              />
            </div>
            <p class="mt-1 text-xs text-muted">
              记录笔试时间和复盘内容即可。补充得越具体，后续 AI 越容易判断你在笔试阶段的卡点。
            </p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭笔试复盘抽屉"
            :disabled="saving"
            @click="emit('close')"
          />
        </div>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div
            v-if="reviewDocument?.status === 'failed'"
            class="flex items-center justify-between gap-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2"
          >
            <span class="text-xs text-error">复盘提取失败，可重试。</span>
            <UButton
              type="button"
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-refresh-cw"
              :loading="retryingDocumentId === reviewDocument.id"
              :disabled="retryingDocumentId !== null"
              @click="emit('retry', reviewDocument)"
            >
              重试提取
            </UButton>
          </div>

          <UFormField label="笔试时间">
            <UPopover v-model:open="datePopoverOpen" :portal="true" :ui="{ content: 'app-popover-layer' }">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                class="w-full justify-between"
                trailing-icon="i-lucide-calendar-days"
              >
                {{ dateLabel }}
              </UButton>
              <template #content>
                <div class="p-2">
                  <UCalendar v-model="calendarDate" @update:model-value="emit('selectDate', $event)" />
                </div>
              </template>
            </UPopover>
          </UFormField>

          <UFormField label="笔试复盘">
            <UTextarea
              v-model="form.reviewNote"
              class="w-full"
              :rows="12"
              placeholder="记录题型、难点、时间分配、未掌握知识点，以及你觉得需要继续补强的内容。"
            />
          </UFormField>
        </div>

        <div class="flex justify-end gap-2 border-t border-default px-5 py-4">
          <UButton type="button" color="neutral" variant="outline" :disabled="saving" @click="emit('close')">
            取消
          </UButton>
          <UButton type="button" icon="i-lucide-save" :loading="saving" :disabled="saving" @click="emit('save')">
            保存复盘
          </UButton>
        </div>
      </section>
    </template>
  </UDrawer>
</template>
