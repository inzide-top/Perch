<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InterviewRound, InterviewRoundResult, InterviewRoundType, JobOpportunity } from '@/types/opportunity'
import type { ReviewDocumentSummary } from '@/types/review'
import { formatDateOnly } from '@/shared/formatDate'
import type { InterviewManagementTab, InterviewRoundForm } from '../../types'

const props = defineProps<{
  open: boolean
  opportunity: JobOpportunity
  roundTypeOptions: { label: string; value: InterviewRoundType }[]
  dateLabel: string
  adding: boolean
  completingRoundId: string | null
  cancelingRoundId: string | null
  canCreateSchedule: boolean
  deletingRoundActionId: string | null
  reviewDocuments: ReviewDocumentSummary[]
  retryingDocumentId: string | null
}>()

const emit = defineEmits<{
  close: []
  add: [mode: InterviewManagementTab]
  selectDate: [value: unknown]
  edit: [round: InterviewRound]
  complete: [round: InterviewRound]
  cancel: [round: InterviewRound]
  delete: [roundId: string]
  retry: [document: ReviewDocumentSummary]
}>()

const form = defineModel<InterviewRoundForm>('form', { required: true })
const activeTab = defineModel<InterviewManagementTab>('activeTab', { required: true })
const datePopoverOpen = defineModel<boolean>('datePopoverOpen', { required: true })
const calendarDate = defineModel<unknown>('calendarDate', { required: true })
const deletingRoundId = defineModel<string | null>('deletingRoundId', { required: true })
const cancelingPopoverRoundId = ref<string | null>(null)

const selectContent = {
  align: 'start' as const,
  sideOffset: 8,
  class: '!z-[160]',
}
const resultOptions: { label: string; value: Exclude<InterviewRoundResult, 'pending'> }[] = [
  { label: '结果未知', value: 'unknown' },
  { label: '已通过', value: 'passed' },
  { label: '未通过', value: 'failed' },
]

const isTransitioning = computed(() => Boolean(props.completingRoundId || props.cancelingRoundId))
const isBusy = computed(() => props.adding || isTransitioning.value || Boolean(props.deletingRoundActionId))
const plannedRounds = computed(() =>
  props.opportunity.interviewRounds
    .filter((round) => round.status === 'planned')
    .sort((current, next) => {
      if (!current.scheduledAt) return 1
      if (!next.scheduledAt) return -1
      return current.scheduledAt.localeCompare(next.scheduledAt)
    }),
)
const completedRounds = computed(() =>
  props.opportunity.interviewRounds
    .filter((round) => round.status === 'completed')
    .sort((current, next) => next.updatedAt.localeCompare(current.updatedAt)),
)
const canceledRounds = computed(() =>
  props.opportunity.interviewRounds
    .filter((round) => round.status === 'canceled')
    .sort((current, next) => next.updatedAt.localeCompare(current.updatedAt)),
)

function getInterviewRoundTypeLabel(type: InterviewRoundType) {
  return props.roundTypeOptions.find((item) => item.value === type)?.label ?? '其他'
}

function getReviewDocument(roundId: string) {
  return props.reviewDocuments.find((document) => document.interviewRoundId === roundId) ?? null
}

function getReviewStatusLabel(round: InterviewRound) {
  const document = getReviewDocument(round.id)
  if (!round.reviewNote.trim()) return '待复盘'
  if (!document) return '已记录'
  if (document.status === 'pending') return '等待提取'
  if (document.status === 'processing') return '提取中'
  if (document.status === 'completed') return '已提取'
  return '提取失败'
}

function getReviewStatusColor(round: InterviewRound) {
  const document = getReviewDocument(round.id)
  if (!round.reviewNote.trim()) return 'warning' as const
  if (document?.status === 'failed') return 'error' as const
  if (document?.status === 'completed') return 'success' as const
  return 'neutral' as const
}

function getResultLabel(result: InterviewRoundResult) {
  if (result === 'passed') return '已通过'
  if (result === 'failed') return '未通过'
  return '结果未知'
}
</script>

<template>
  <UDrawer
    :open="open"
    direction="right"
    :handle="false"
    :close="false"
    :dismissible="!isBusy"
    :ui="{
      overlay: '!z-[150] bg-black/35 backdrop-blur-[2px]',
      content: '!z-[151] app-drawer h-full w-full max-w-4xl border-l border-default shadow-2xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && emit('close')"
  >
    <template #content>
      <section class="flex h-full min-h-0 w-full flex-col">
        <header class="border-b border-default px-5 pt-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-highlighted">面试管理</h2>
              <p class="mt-1 text-xs text-muted">先安排面试，完成后在同一轮次补充复盘，不会生成重复记录。</p>
            </div>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="关闭面试管理抽屉"
              :disabled="isBusy"
              @click="emit('close')"
            />
          </div>

          <div class="mt-4 flex gap-6" role="tablist" aria-label="面试管理分类">
            <button
              v-for="tab in [
                { value: 'schedule', label: '面试安排', icon: 'i-lucide-calendar-clock' },
                { value: 'review', label: '面试复盘', icon: 'i-lucide-clipboard-pen' },
              ] as const"
              :key="tab.value"
              type="button"
              role="tab"
              class="relative flex items-center gap-2 pb-3 text-sm font-medium transition-colors"
              :class="activeTab === tab.value ? 'text-primary' : 'text-muted hover:text-highlighted'"
              :aria-selected="activeTab === tab.value"
              :disabled="adding"
              @click="activeTab = tab.value"
            >
              <UIcon :name="tab.icon" class="size-4" />
              {{ tab.label }}
              <span
                v-if="activeTab === tab.value"
                class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
              />
            </button>
          </div>
        </header>

        <div class="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          <section class="app-panel-muted self-start p-4">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-highlighted">
                  {{ activeTab === 'schedule' ? '新增面试安排' : '补录已完成面试' }}
                </h3>
                <p class="mt-1 text-xs text-muted">
                  {{ activeTab === 'schedule' ? '记录下一轮时间和类型。' : '用于补录历史面试与复盘。' }}
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
                :label="
                  activeTab === 'schedule' ? `${plannedRounds.length} 场待进行` : `${completedRounds.length} 场已完成`
                "
              />
            </div>

            <div
              v-if="activeTab === 'schedule' && !canCreateSchedule"
              class="mb-4 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2.5 text-xs leading-5 text-warning"
            >
              当前机会已离开面试阶段，不能新增安排；历史复盘仍可继续补充。
            </div>

            <div class="space-y-3">
              <UFormField label="轮次类型">
                <USelect
                  v-model="form.type"
                  class="w-full"
                  :items="roundTypeOptions"
                  value-key="value"
                  :content="selectContent"
                  :disabled="activeTab === 'schedule' && !canCreateSchedule"
                />
              </UFormField>
              <UFormField label="轮次名称">
                <UInput
                  v-model="form.title"
                  class="w-full"
                  placeholder="一面 / 项目面 / HR 面"
                  :disabled="activeTab === 'schedule' && !canCreateSchedule"
                />
              </UFormField>
              <UFormField :label="activeTab === 'schedule' ? '面试时间' : '面试日期'">
                <UPopover v-model:open="datePopoverOpen" :portal="true" :ui="{ content: '!z-[160]' }">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="outline"
                    class="w-full justify-between"
                    trailing-icon="i-lucide-calendar-days"
                    :disabled="activeTab === 'schedule' && !canCreateSchedule"
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
              <UFormField v-if="activeTab === 'schedule'" label="安排备注">
                <UTextarea
                  v-model="form.note"
                  class="w-full"
                  :rows="5"
                  placeholder="例如：线上面试、提前准备项目架构说明"
                  :disabled="!canCreateSchedule"
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
                    :rows="7"
                    placeholder="记录问题、回答、反馈和你认为需要补强的地方"
                  />
                </UFormField>
              </template>
              <UButton
                type="button"
                :icon="activeTab === 'schedule' ? 'i-lucide-calendar-plus' : 'i-lucide-plus'"
                class="w-full justify-center"
                :loading="adding"
                :disabled="!form.title.trim() || adding || (activeTab === 'schedule' && !canCreateSchedule)"
                @click="emit('add', activeTab)"
              >
                {{ activeTab === 'schedule' ? '创建面试安排' : '添加已完成面试' }}
              </UButton>
            </div>
          </section>

          <section v-if="activeTab === 'schedule'" class="min-w-0">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-highlighted">待进行安排</h3>
              <span class="text-xs text-muted">按面试时间排序</span>
            </div>

            <div class="space-y-3">
              <article v-for="round in plannedRounds" :key="round.id" class="app-card p-4">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-sm font-semibold text-highlighted">{{ round.title }}</p>
                      <UBadge color="primary" variant="subtle" label="待进行" />
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{{ getInterviewRoundTypeLabel(round.type) }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ formatDateOnly(round.scheduledAt) || '时间待定' }}</span>
                    </div>
                    <p v-if="round.note" class="mt-3 whitespace-pre-line text-xs leading-5 text-muted">
                      {{ round.note }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="project-card-edit shrink-0"
                    :disabled="isTransitioning"
                    aria-label="编辑面试安排"
                    title="编辑面试安排"
                    @click="emit('edit', round)"
                  >
                    <UIcon name="i-lucide-pencil" class="size-4" />
                  </button>
                </div>

                <div class="mt-4 flex items-center justify-end gap-2 border-t border-default pt-3">
                  <UPopover
                    :open="cancelingPopoverRoundId === round.id"
                    :portal="true"
                    :ui="{ content: '!z-[160]' }"
                    @update:open="cancelingPopoverRoundId = $event ? round.id : null"
                  >
                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-calendar-x"
                      :loading="cancelingRoundId === round.id"
                      :disabled="isTransitioning"
                    >
                      取消安排
                    </UButton>
                    <template #content>
                      <div class="w-60 p-3">
                        <p class="text-sm font-medium text-highlighted">确认取消这场面试？</p>
                        <p class="mt-1 text-xs leading-5 text-muted">取消后会保留历史记录，但不能再转为已完成。</p>
                        <div class="mt-3 flex justify-end gap-2">
                          <UButton
                            type="button"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            @click="cancelingPopoverRoundId = null"
                            >返回</UButton
                          >
                          <UButton
                            type="button"
                            color="error"
                            size="sm"
                            :loading="cancelingRoundId === round.id"
                            :disabled="isTransitioning"
                            @click="emit('cancel', round)"
                          >
                            确认取消
                          </UButton>
                        </div>
                      </div>
                    </template>
                  </UPopover>
                  <UButton
                    type="button"
                    size="sm"
                    icon="i-lucide-circle-check"
                    :loading="completingRoundId === round.id"
                    :disabled="isTransitioning"
                    @click="emit('complete', round)"
                  >
                    标记完成
                  </UButton>
                </div>
              </article>

              <div v-if="plannedRounds.length === 0" class="app-panel-muted border-dashed p-8 text-center">
                <UIcon name="i-lucide-calendar-clock" class="mx-auto size-6 text-muted" />
                <p class="mt-2 text-xs leading-5 text-muted">暂无待进行的面试安排。</p>
              </div>

              <details v-if="canceledRounds.length" class="rounded-xl border border-default px-4 py-3">
                <summary class="cursor-pointer text-xs font-medium text-muted">
                  已取消安排（{{ canceledRounds.length }}）
                </summary>
                <div class="mt-3 space-y-2 border-t border-default pt-3">
                  <div
                    v-for="round in canceledRounds"
                    :key="round.id"
                    class="flex items-center justify-between gap-3 text-xs text-muted"
                  >
                    <span class="min-w-0 truncate"
                      >{{ round.title }} · {{ formatDateOnly(round.scheduledAt) || '时间待定' }}</span
                    >
                    <UPopover
                      :open="deletingRoundId === round.id"
                      :portal="true"
                      :ui="{ content: '!z-[160]' }"
                      @update:open="deletingRoundId = $event ? round.id : null"
                    >
                      <UButton
                        type="button"
                        color="error"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-trash-2"
                        :loading="deletingRoundActionId === round.id"
                        :disabled="Boolean(deletingRoundActionId)"
                        aria-label="删除已取消安排"
                      />
                      <template #content>
                        <div class="w-56 p-3">
                          <p class="text-sm font-medium text-highlighted">删除这条已取消安排？</p>
                          <p class="mt-1 text-xs leading-5 text-muted">删除后无法恢复。</p>
                          <div class="mt-3 flex justify-end gap-2">
                            <UButton
                              type="button"
                              color="neutral"
                              variant="ghost"
                              size="sm"
                              @click="deletingRoundId = null"
                              >返回</UButton
                            >
                            <UButton
                              type="button"
                              color="error"
                              size="sm"
                              icon="i-lucide-trash-2"
                              :loading="deletingRoundActionId === round.id"
                              :disabled="Boolean(deletingRoundActionId)"
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
              </details>
            </div>
          </section>

          <section v-else class="min-w-0">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-highlighted">已完成面试</h3>
              <span class="text-xs text-muted">复盘提取不会阻塞其他功能</span>
            </div>

            <div class="space-y-3">
              <article v-for="round in completedRounds" :key="round.id" class="app-card p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-highlighted">{{ round.title }}</p>
                    <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <UBadge color="neutral" variant="subtle" :label="getInterviewRoundTypeLabel(round.type)" />
                      <UBadge
                        :color="getReviewStatusColor(round)"
                        variant="subtle"
                        :label="getReviewStatusLabel(round)"
                      />
                      <span>{{ getResultLabel(round.result) }}</span>
                      <span v-if="round.scheduledAt">{{ formatDateOnly(round.scheduledAt) }}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="project-card-edit"
                      :disabled="deletingRoundActionId === round.id"
                      :aria-label="round.reviewNote ? '编辑面试复盘' : '填写面试复盘'"
                      :title="round.reviewNote ? '编辑面试复盘' : '填写面试复盘'"
                      @click="emit('edit', round)"
                    >
                      <UIcon :name="round.reviewNote ? 'i-lucide-pencil' : 'i-lucide-clipboard-plus'" class="size-4" />
                    </button>
                    <UPopover
                      :open="deletingRoundId === round.id"
                      :portal="true"
                      :ui="{ content: '!z-[160]' }"
                      @update:open="deletingRoundId = $event ? round.id : null"
                    >
                      <button
                        type="button"
                        class="project-card-remove"
                        :disabled="deletingRoundActionId === round.id"
                        aria-label="删除面试记录"
                        title="删除面试记录"
                      >
                        <UIcon name="i-lucide-trash-2" class="size-4" />
                      </button>
                      <template #content>
                        <div class="w-56 p-3">
                          <p class="text-sm font-medium text-highlighted">删除这条面试记录？</p>
                          <p class="mt-1 text-xs leading-5 text-muted">关联复盘和结构化提取结果也会一并删除。</p>
                          <div class="mt-3 flex justify-end gap-2">
                            <UButton
                              type="button"
                              color="neutral"
                              variant="ghost"
                              size="sm"
                              @click="deletingRoundId = null"
                              >取消</UButton
                            >
                            <UButton
                              type="button"
                              color="error"
                              size="sm"
                              icon="i-lucide-trash-2"
                              :loading="deletingRoundActionId === round.id"
                              :disabled="Boolean(deletingRoundActionId)"
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

                <div
                  v-if="getReviewDocument(round.id)?.status === 'failed'"
                  class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2"
                >
                  <span class="text-xs text-error">复盘提取失败，可重试。</span>
                  <UButton
                    type="button"
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-refresh-cw"
                    :loading="retryingDocumentId === getReviewDocument(round.id)!.id"
                    :disabled="retryingDocumentId !== null"
                    @click="emit('retry', getReviewDocument(round.id)!)"
                  >
                    重试
                  </UButton>
                </div>
                <p v-if="round.reviewNote" class="mt-3 line-clamp-4 whitespace-pre-line text-xs leading-5 text-muted">
                  {{ round.reviewNote }}
                </p>
                <button
                  v-else
                  type="button"
                  class="mt-3 text-xs font-medium text-primary hover:underline"
                  @click="emit('edit', round)"
                >
                  填写本轮复盘
                </button>
              </article>

              <div v-if="completedRounds.length === 0" class="app-panel-muted border-dashed p-8 text-center">
                <UIcon name="i-lucide-clipboard-pen" class="mx-auto size-6 text-muted" />
                <p class="mt-2 text-xs leading-5 text-muted">
                  暂无已完成的面试。完成安排或补录历史面试后，会在这里继续复盘。
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </template>
  </UDrawer>
</template>
