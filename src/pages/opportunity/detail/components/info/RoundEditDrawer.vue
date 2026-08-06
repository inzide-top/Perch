<script setup lang="ts">
import type { InterviewRound, InterviewRoundResult, InterviewRoundType } from '@/types/opportunity'
import { formatDateOnly } from '@/shared/formatDate'
import type { InterviewRoundForm } from '../../types'

const props = defineProps<{
  open: boolean
  saving: boolean
  changed: boolean
  round: InterviewRound | null
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
  class: '!z-[180]',
}
const resultOptions: { label: string; value: Exclude<InterviewRoundResult, 'pending'> }[] = [
  { label: '结果未知', value: 'unknown' },
  { label: '已通过', value: 'passed' },
  { label: '未通过', value: 'failed' },
]
</script>

<template>
  <UDrawer
    :open="open"
    direction="right"
    :handle="false"
    :close="false"
    :dismissible="!saving"
    :ui="{
      overlay: '!z-[170] bg-black/35 backdrop-blur-[2px]',
      content: '!z-[171] app-drawer h-full w-full max-w-xl border-l border-default shadow-2xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && emit('close')"
  >
    <template #content>
      <section class="flex h-full min-h-0 w-full flex-col">
        <div class="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              {{ props.round?.status === 'planned' ? '编辑面试安排' : '编辑面试复盘' }}
            </h2>
            <p class="mt-1 text-xs text-muted">
              {{
                props.round?.status === 'planned'
                  ? '调整面试类型、名称、时间和准备备注。'
                  : '补充本轮结果与真实复盘，保存后会异步提取能力证据。'
              }}
            </p>
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
          <UFormField :label="props.round?.status === 'planned' ? '面试时间' : '面试日期'">
            <UPopover v-model:open="datePopoverOpen" :portal="true" :ui="{ content: '!z-[180]' }">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                class="w-full justify-between"
                trailing-icon="i-lucide-calendar-days"
              >
                {{ formatDateOnly(form.date) || '请输入日期' }}
              </UButton>
              <template #content>
                <div class="p-2">
                  <UCalendar v-model="calendarDate" @update:model-value="emit('selectDate', $event)" />
                </div>
              </template>
            </UPopover>
          </UFormField>

          <UFormField v-if="props.round?.status === 'planned'" label="安排备注">
            <UTextarea
              v-model="form.note"
              class="w-full"
              :rows="6"
              placeholder="例如：线上面试、提前准备项目架构说明"
            />
          </UFormField>
          <template v-else>
            <UFormField label="面试结果">
              <USelect
                v-model="form.result"
                class="w-full"
                :items="resultOptions"
                value-key="value"
                :content="selectContent"
              />
            </UFormField>
            <UFormField label="复盘内容">
              <UTextarea
                v-model="form.reviewNote"
                class="w-full"
                :rows="10"
                placeholder="记录真实面试问题、回答、反馈与需要补强的地方。"
              />
            </UFormField>
          </template>
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
    </template>
  </UDrawer>
</template>
