<script setup lang="ts">
import type { InterviewRoundType } from '@/types/opportunity'
import type { InterviewRoundForm } from '../../types'

defineProps<{
  open: boolean
  saving: boolean
  changed: boolean
  roundTypeOptions: { label: string; value: InterviewRoundType }[]
}>()

const emit = defineEmits<{
  close: []
  save: []
  selectDate: [value: unknown]
}>()

const form = defineModel<InterviewRoundForm>('form', { required: true })
const datePopoverOpen = defineModel<boolean>('datePopoverOpen', { required: true })
const calendarDate = defineModel<unknown>('calendarDate', { required: true })

const selectContent = {
  align: 'start' as const,
  sideOffset: 8,
  class: 'z-[80]',
}
</script>

<template>
  <Transition name="project-edit-drawer">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="编辑测评记录"
      @click.self="emit('close')"
    >
      <section class="app-drawer flex h-full w-full max-w-xl flex-col border-l border-default shadow-2xl">
        <div class="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">编辑测评记录</h2>
            <p class="mt-1 text-xs text-muted">调整类型、名称、日期和复盘内容。</p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭编辑抽屉"
            :disabled="saving"
            @click="emit('close')"
          />
        </div>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <UFormField label="轮次类型">
            <USelect
              v-model="form.type"
              class="w-full"
              :items="roundTypeOptions"
              value-key="value"
              :content="selectContent"
            />
          </UFormField>
          <UFormField label="轮次名称">
            <UInput v-model="form.title" class="w-full" placeholder="一面 / 项目面 / HR 面" />
          </UFormField>
          <UFormField label="日期">
            <UPopover v-model:open="datePopoverOpen" :portal="true" :ui="{ content: 'z-[100]' }">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                class="w-full justify-between"
                trailing-icon="i-lucide-calendar-days"
              >
                {{ form.date || '请输入日期' }}
              </UButton>
              <template #content>
                <div class="p-2">
                  <UCalendar v-model="calendarDate" @update:model-value="emit('selectDate', $event)" />
                </div>
              </template>
            </UPopover>
          </UFormField>
          <UFormField label="复盘备注">
            <UTextarea
              v-model="form.note"
              class="w-full"
              :rows="8"
              placeholder="记录真实面试复盘，后续可以作为 AI 分析输入。"
            />
          </UFormField>
        </div>

        <div class="flex justify-end gap-2 border-t border-default px-5 py-4">
          <UButton type="button" color="neutral" variant="outline" :disabled="saving" @click="emit('close')">
            取消
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!form.title.trim() || !changed || saving"
            @click="emit('save')"
          >
            保存修改
          </UButton>
        </div>
      </section>
    </div>
  </Transition>
</template>
