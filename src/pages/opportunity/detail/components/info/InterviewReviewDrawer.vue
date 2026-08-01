<script setup lang="ts">
import type { InterviewRound, InterviewRoundType, JobOpportunity, JobOpportunityStatus } from '@/types/opportunity'
import type { InterviewRoundForm } from '../../types'

const props = defineProps<{
  open: boolean
  opportunity: JobOpportunity
  status: JobOpportunityStatus
  statusLabelMap: Record<JobOpportunityStatus, string>
  roundTypeOptions: { label: string; value: InterviewRoundType }[]
  dateLabel: string
  adding: boolean
  deletingRoundActionId: string | null
}>()

const emit = defineEmits<{
  close: []
  add: []
  selectDate: [value: unknown]
  edit: [round: InterviewRound]
  delete: [roundId: string]
}>()

const form = defineModel<InterviewRoundForm>('form', { required: true })
const datePopoverOpen = defineModel<boolean>('datePopoverOpen', { required: true })
const calendarDate = defineModel<unknown>('calendarDate', { required: true })
const deletingRoundId = defineModel<string | null>('deletingRoundId', { required: true })

const selectContent = {
  align: 'start' as const,
  sideOffset: 8,
  class: 'z-[80]',
}

function getInterviewRoundTypeLabel(type: InterviewRoundType) {
  return props.roundTypeOptions.find((item) => item.value === type)?.label ?? '其他'
}
</script>

<template>
  <Transition name="project-edit-drawer">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex justify-end bg-black/35 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="测评记录"
      @click.self="emit('close')"
    >
      <section class="app-drawer flex h-full w-full max-w-3xl flex-col border-l border-default shadow-2xl">
        <div class="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-highlighted">测评记录</h2>
            <p class="mt-1 text-xs text-muted">
              补充面试复盘越完整，后续 AI 越能判断你卡在基础面、项目面、业务面还是 HR 面。
            </p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭测评记录抽屉"
            :disabled="adding"
            @click="emit('close')"
          />
        </div>

        <div class="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section class="app-panel-muted p-4">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-highlighted">新增记录</h3>
              <UBadge color="neutral" variant="subtle" :label="statusLabelMap[status]" />
            </div>

            <div class="space-y-3">
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
                    {{ dateLabel }}
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
                  placeholder="记录题目、表现、追问和你觉得卡住的地方"
                />
              </UFormField>
              <UButton
                type="button"
                icon="i-lucide-plus"
                class="w-full justify-center"
                :loading="adding"
                :disabled="!form.title.trim() || adding"
                @click="emit('add')"
              >
                添加测评记录
              </UButton>
            </div>
          </section>

          <section class="min-w-0">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-highlighted">已有记录</h3>
              <UBadge color="neutral" variant="subtle" :label="`${opportunity.interviewRounds.length} 条`" />
            </div>

            <div class="space-y-3">
              <article v-for="round in opportunity.interviewRounds" :key="round.id" class="app-card p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-highlighted">{{ round.title }}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <UBadge color="neutral" variant="subtle" :label="getInterviewRoundTypeLabel(round.type)" />
                      <span v-if="round.scheduledAt">{{ round.scheduledAt }}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="project-card-edit"
                      :disabled="deletingRoundActionId === round.id"
                      aria-label="编辑测评记录"
                      title="编辑测评记录"
                      @click="emit('edit', round)"
                    >
                      <UIcon name="i-lucide-pencil" class="size-4" />
                    </button>
                    <UPopover
                      :open="deletingRoundId === round.id"
                      :portal="true"
                      :ui="{ content: 'z-[110]' }"
                      @update:open="deletingRoundId = $event ? round.id : null"
                    >
                      <button
                        type="button"
                        class="project-card-remove"
                        :disabled="deletingRoundActionId === round.id"
                        aria-label="删除测评记录"
                        title="删除测评记录"
                      >
                        <UIcon name="i-lucide-trash-2" class="size-4" />
                      </button>
                      <template #content>
                        <div class="w-56 p-3">
                          <p class="text-sm font-medium text-highlighted">删除这条测评记录？</p>
                          <p class="mt-1 text-xs leading-5 text-muted">删除后这条复盘记录不会再展示。</p>
                          <div class="mt-3 flex justify-end gap-2">
                            <UButton
                              type="button"
                              color="neutral"
                              variant="ghost"
                              size="sm"
                              :disabled="deletingRoundActionId === round.id"
                              @click="deletingRoundId = null"
                            >
                              取消
                            </UButton>
                            <UButton
                              type="button"
                              color="error"
                              size="sm"
                              icon="i-lucide-trash-2"
                              :loading="deletingRoundActionId === round.id"
                              :disabled="deletingRoundActionId === round.id"
                              @click="emit('delete', round.id)"
                            >
                              删除
                            </UButton>
                          </div>
                        </div>
                      </template>
                    </UPopover>
                  </div>
                </div>
                <p v-if="round.note" class="mt-3 whitespace-pre-line text-xs leading-5 text-muted">
                  {{ round.note }}
                </p>
              </article>
              <div
                v-if="opportunity.interviewRounds.length === 0"
                class="app-panel-muted border-dashed p-8 text-center text-xs leading-5 text-muted"
              >
                暂无面试复盘。建议在每轮面试后补充题目、表现和卡点，后续 AI 会基于这些内容做复盘。
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </Transition>
</template>
