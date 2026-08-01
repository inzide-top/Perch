<script setup lang="ts">
import type { WrittenTestReviewForm } from '../../types'

defineProps<{
  open: boolean
  saving: boolean
  dateLabel: string
}>()

const emit = defineEmits<{
  close: []
  save: []
  selectDate: [value: unknown]
}>()

const form = defineModel<WrittenTestReviewForm>('form', { required: true })
const datePopoverOpen = defineModel<boolean>('datePopoverOpen', { required: true })
const calendarDate = defineModel<unknown>('calendarDate', { required: true })
</script>

<template>
  <Transition name="project-edit-drawer">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex justify-end bg-black/35 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="笔试复盘"
      @click.self="emit('close')"
    >
      <section class="app-drawer flex h-full w-full max-w-lg flex-col border-l border-default shadow-2xl">
        <div class="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">笔试复盘</h2>
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
          <UFormField label="笔试时间">
            <UPopover v-model:open="datePopoverOpen" :portal="true" :ui="{ content: 'z-[100]' }">
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
    </div>
  </Transition>
</template>
