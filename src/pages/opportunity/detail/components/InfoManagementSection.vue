<script setup lang="ts">
import type {
  InterviewRoundType,
  InterviewRound,
  JobAnalysis,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
} from '@/types/opportunity'
import CityPicker from '@/components/CityPicker.vue'
import { industryOptions } from '@/data/industryOptions'
import type { InterviewRoundForm, OpportunityInfoForm, WrittenTestReviewForm } from '../types'

type StatusFlowItem = {
  label: string
  value: JobOpportunityStatus
}

type IntentionOption = {
  label: string
  value: OpportunityIntentionLevel
  description: string
}

const props = defineProps<{
  opportunity: JobOpportunity
  analysis: JobAnalysis | null
  statusLabelMap: Record<JobOpportunityStatus, string>
  statusFlow: StatusFlowItem[]
  currentStatusIndex: number
  statusMotionKey: number
  previousStatus: StatusFlowItem | null
  nextStatus: StatusFlowItem | null
  intentionOptions: IntentionOption[]
  hasOpportunityMetaChanged: boolean
  hasRoundEditChanged: boolean
  isSavingOpportunityInfo: boolean
  isSavingOpportunityMeta: boolean
  isStatusTransitioning: boolean
  isTogglingWrittenTestFlow: boolean
  canChangeWrittenTestFlow: boolean
  isTerminatingOpportunity: boolean
  isAddingInterviewRound: boolean
  isSavingWrittenTestReview: boolean
  isSavingRoundEdit: boolean
  deletingRoundActionId: string | null
  canOpenWrittenTestReview: boolean
  canOpenInterviewReview: boolean
  terminationRoundOptions: { label: string; value: string }[]
  availableInterviewRoundTypeOptions: { label: string; value: InterviewRoundType }[]
  interviewRoundDateLabel: string
  writtenTestDateLabel: string
}>()

const emit = defineEmits<{
  goToPreviousStatus: []
  advanceOpportunityStatus: []
  closeOpportunity: []
  toggleIncludeWrittenTest: []
  saveInfo: []
  saveOpportunityMeta: []
  openReviewPanelFromStatus: [status: JobOpportunityStatus]
  openWrittenTestReviewDrawer: []
  closeWrittenTestReviewDrawer: []
  saveWrittenTestReview: []
  openInterviewReviewDrawer: []
  closeInterviewReviewDrawer: []
  addInterviewRound: []
  handleRoundDateSelect: [value: unknown]
  openRoundEditDrawer: [round: InterviewRound]
  confirmDeleteRound: [roundId: string]
  closeRoundEditDrawer: []
  handleEditRoundDateSelect: [value: unknown]
  handleWrittenTestDateSelect: [value: unknown]
  saveRoundEdit: []
}>()

const infoForm = defineModel<OpportunityInfoForm>('infoForm', { required: true })
const isOpportunityInfoEditing = defineModel<boolean>('isOpportunityInfoEditing', { required: true })
const isTerminatePopoverOpen = defineModel<boolean>('isTerminatePopoverOpen', { required: true })
const terminationTarget = defineModel<'none' | 'new' | string>('terminationTarget', { required: true })
const terminationNewRoundType = defineModel<InterviewRoundType>('terminationNewRoundType', { required: true })
const terminationNewRoundTitle = defineModel<string>('terminationNewRoundTitle', { required: true })
const terminationReasonNote = defineModel<string>('terminationReasonNote', { required: true })
const isWrittenTestReviewDrawerOpen = defineModel<boolean>('isWrittenTestReviewDrawerOpen', { required: true })
const writtenTestReviewForm = defineModel<WrittenTestReviewForm>('writtenTestReviewForm', { required: true })
const writtenTestDatePopoverOpen = defineModel<boolean>('writtenTestDatePopoverOpen', { required: true })
const writtenTestCalendarDate = defineModel<unknown>('writtenTestCalendarDate', { required: true })
const isInterviewReviewDrawerOpen = defineModel<boolean>('isInterviewReviewDrawerOpen', { required: true })
const roundForm = defineModel<InterviewRoundForm>('roundForm', { required: true })
const roundDatePopoverOpen = defineModel<boolean>('roundDatePopoverOpen', { required: true })
const roundCalendarDate = defineModel<unknown>('roundCalendarDate', { required: true })
const deletingRoundId = defineModel<string | null>('deletingRoundId', { required: true })
const isRoundEditDrawerOpen = defineModel<boolean>('isRoundEditDrawerOpen', { required: true })
const roundEditForm = defineModel<InterviewRoundForm>('roundEditForm', { required: true })
const editRoundDatePopoverOpen = defineModel<boolean>('editRoundDatePopoverOpen', { required: true })
const editRoundCalendarDate = defineModel<unknown>('editRoundCalendarDate', { required: true })

const industrySelectItems = industryOptions.map((industry) => ({ label: industry, value: industry }))
const drawerSelectContent = {
  align: 'start' as const,
  sideOffset: 8,
  class: 'z-[80]',
}

function canOpenReviewFromStatus(status: JobOpportunityStatus) {
  if (status === 'written_test') return props.canOpenWrittenTestReview
  if (status === 'interviewing') return props.canOpenInterviewReview

  return false
}

function getReviewStatusCtaLabel(status: JobOpportunityStatus) {
  if (status === 'written_test') return '笔试复盘'
  if (status === 'interviewing') return '面试复盘'

  return '复盘'
}

function getInterviewRoundTypeLabel(type: InterviewRoundType) {
  return props.availableInterviewRoundTypeOptions.find((item) => item.value === type)?.label ?? '其他'
}
</script>

<template>
  <section
    class="space-y-4"
    :class="{ 'pointer-events-none': isTerminatingOpportunity }"
    :aria-busy="isTerminatingOpportunity"
  >
    <div class="app-panel p-4 lg:p-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <h2 class="text-base font-semibold text-highlighted">机会状态</h2>
            <Transition name="opportunity-status-pop" mode="out-in">
              <UBadge
                :key="`${infoForm.status}-${statusMotionKey}`"
                :color="infoForm.status === 'closed' ? 'error' : 'primary'"
                variant="subtle"
                :label="statusLabelMap[infoForm.status]"
              />
            </Transition>
          </div>
          <p class="mt-1 text-xs text-muted">按真实求职流程向前或向后调整阶段；终止流程放在更多操作里。</p>
        </div>

        <div class="-mr-1 ml-auto flex min-w-[12.5rem] shrink-0 items-center justify-end gap-2 overflow-x-auto pb-1">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-arrow-left"
            :disabled="
              !previousStatus || isStatusTransitioning || isTogglingWrittenTestFlow || isTerminatingOpportunity
            "
            class="app-interactive-button"
            aria-label="回到上一阶段"
            title="回到上一阶段"
            @click="emit('goToPreviousStatus')"
          />
          <UButton
            type="button"
            icon="i-lucide-arrow-right"
            :loading="isStatusTransitioning"
            :disabled="!nextStatus || isStatusTransitioning || isTogglingWrittenTestFlow || isTerminatingOpportunity"
            class="app-interactive-button app-primary-button"
            @click="emit('advanceOpportunityStatus')"
          >
            {{ nextStatus ? '前往下一阶段' : '已到最终阶段' }}
          </UButton>
          <UPopover v-model:open="isTerminatePopoverOpen">
            <UButton
              type="button"
              color="error"
              variant="subtle"
              icon="i-lucide-x"
              :loading="isTerminatingOpportunity"
              :disabled="
                infoForm.status === 'closed' ||
                isStatusTransitioning ||
                isTogglingWrittenTestFlow ||
                isTerminatingOpportunity
              "
              class="app-interactive-button rounded-full"
              aria-label="终止流程"
              title="终止流程"
            />
            <template #content>
              <div class="w-80 p-3">
                <p class="text-sm font-medium text-highlighted">终止这条机会？</p>
                <p class="mt-1 text-xs leading-5 text-muted">
                  补充终止发生的位置，后续 AI 才能判断你卡在简历筛选、笔试还是某一轮面试。
                </p>
                <div v-if="infoForm.status === 'interviewing'" class="mt-3 space-y-3">
                  <UFormField label="终止发生在哪个环节">
                    <USelect
                      v-model="terminationTarget"
                      class="w-full"
                      :items="terminationRoundOptions"
                      value-key="value"
                      placeholder="选择轮次或不绑定"
                      :content="drawerSelectContent"
                    />
                  </UFormField>

                  <div v-if="terminationTarget === 'new'" class="app-panel-muted space-y-3 p-3">
                    <UFormField label="轮次类型">
                      <USelect
                        v-model="terminationNewRoundType"
                        class="w-full"
                        :items="availableInterviewRoundTypeOptions"
                        value-key="value"
                        :content="drawerSelectContent"
                      />
                    </UFormField>
                    <UFormField label="轮次名称">
                      <UInput
                        v-model="terminationNewRoundTitle"
                        class="w-full"
                        placeholder="例如：三面 / 业务面 / 笔试"
                      />
                    </UFormField>
                  </div>
                </div>
                <UFormField label="备注" class="mt-3">
                  <UTextarea
                    v-model="terminationReasonNote"
                    class="w-full"
                    :rows="3"
                    placeholder="可选。比如：二面业务理解不足，或者薪资未谈拢。"
                  />
                </UFormField>
                <div class="mt-3 flex justify-end gap-2">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="isTerminatePopoverOpen = false"
                  >
                    取消
                  </UButton>
                  <UButton
                    type="button"
                    color="error"
                    size="sm"
                    icon="i-lucide-circle-x"
                    :loading="isTerminatingOpportunity"
                    :disabled="isTerminatingOpportunity"
                    @click="emit('closeOpportunity')"
                  >
                    确认终止
                  </UButton>
                </div>
              </div>
            </template>
          </UPopover>
        </div>
      </div>

      <div class="mt-5 overflow-x-auto pb-1">
        <div class="flex min-w-[46rem] items-center">
          <template v-for="(status, index) in statusFlow" :key="status.value">
            <button
              type="button"
              class="group flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 transition-colors"
              :class="
                canOpenReviewFromStatus(status.value)
                  ? 'cursor-pointer border-primary/30 bg-primary/10 hover:border-primary/50 hover:bg-primary/15'
                  : 'cursor-default border-transparent'
              "
              :aria-label="canOpenReviewFromStatus(status.value) ? `打开${status.label}复盘` : status.label"
              @click="emit('openReviewPanelFromStatus', status.value)"
            >
              <div
                class="flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-200"
                :class="
                  index <= currentStatusIndex && infoForm.status !== 'closed'
                    ? 'border-primary bg-primary text-white'
                    : 'border-default bg-[var(--app-surface)] text-muted'
                "
              >
                {{ index + 1 }}
              </div>
              <span
                class="text-sm transition-colors"
                :class="
                  index <= currentStatusIndex && infoForm.status !== 'closed'
                    ? 'font-medium text-highlighted'
                    : 'text-muted'
                "
              >
                {{ status.label }}
              </span>
              <Transition name="interview-review-status-cta">
                <span
                  v-if="canOpenReviewFromStatus(status.value)"
                  class="inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-[var(--app-surface)] px-2 py-0.5 text-[10px] text-primary shadow-sm"
                >
                  {{ getReviewStatusCtaLabel(status.value) }}
                  <UIcon name="i-lucide-chevron-right" class="size-3" />
                </span>
              </Transition>
            </button>
            <div
              v-if="index < statusFlow.length - 1"
              class="mx-3 h-px flex-1 transition-colors"
              :class="
                index < currentStatusIndex && infoForm.status !== 'closed' ? 'bg-primary/60' : 'bg-[var(--ui-border)]'
              "
            />
          </template>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1fr)]">
      <div class="app-panel p-5">
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-highlighted">岗位原文</h2>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-pencil"
            @click="isOpportunityInfoEditing = !isOpportunityInfoEditing"
          >
            {{ isOpportunityInfoEditing ? '收起' : '编辑' }}
          </UButton>
        </div>

        <div v-if="!isOpportunityInfoEditing" class="space-y-4">
          <section class="app-panel-muted p-4">
            <p class="text-xs font-medium text-muted">岗位介绍</p>
            <p class="mt-3 whitespace-pre-line text-xs leading-6 text-muted">
              {{ opportunity.introduction || '未填写' }}
            </p>
          </section>

          <section class="app-panel-muted p-4">
            <p class="text-xs font-medium text-muted">岗位要求</p>
            <p class="mt-3 whitespace-pre-line text-xs leading-6 text-muted">
              {{ opportunity.description }}
            </p>
          </section>
        </div>

        <div v-else class="space-y-4">
          <div class="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5 text-warning">
            修改 JD 信息后，当前 mock 分析不会自动重跑。后续我们会单独做“重新分析”动作。
          </div>

          <div class="grid gap-x-5 gap-y-3 md:grid-cols-3">
            <UFormField label="公司名称">
              <UInput v-model="infoForm.company" class="w-full" />
            </UFormField>
            <UFormField label="岗位名称">
              <UInput v-model="infoForm.jobTitle" class="w-full" />
            </UFormField>
            <UFormField label="Base 地址">
              <CityPicker v-model="infoForm.address" :max="5" panel-height-class="h-52" />
            </UFormField>
          </div>

          <div class="space-y-3">
            <UFormField label="岗位介绍">
              <UTextarea v-model="infoForm.introduction" class="w-full" :rows="5" />
            </UFormField>
            <UFormField label="岗位要求">
              <UTextarea v-model="infoForm.description" class="w-full" :rows="7" />
            </UFormField>
          </div>

          <div class="flex justify-end">
            <UButton
              type="button"
              icon="i-lucide-save"
              :loading="isSavingOpportunityInfo"
              :disabled="isSavingOpportunityInfo"
              @click="emit('saveInfo')"
            >
              保存 JD 信息
            </UButton>
          </div>
        </div>
      </div>

      <aside class="space-y-4 xl:sticky xl:top-20">
        <section class="app-panel p-5">
          <div class="mb-4">
            <button
              type="button"
              class="app-card flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors"
              :class="
                canChangeWrittenTestFlow &&
                !isTogglingWrittenTestFlow &&
                !isStatusTransitioning &&
                !isTerminatingOpportunity
                  ? 'app-interactive-button hover:bg-elevated'
                  : 'cursor-not-allowed opacity-55'
              "
              :disabled="
                !canChangeWrittenTestFlow ||
                isTogglingWrittenTestFlow ||
                isStatusTransitioning ||
                isTerminatingOpportunity
              "
              @click="emit('toggleIncludeWrittenTest')"
            >
              <span>
                <span class="block text-sm font-medium text-highlighted">包含笔试流程</span>
                <span class="mt-0.5 block text-xs text-muted">
                  {{
                    canChangeWrittenTestFlow
                      ? '独立保存。关闭笔试时，笔试中会自动回退到已投递。'
                      : '已进入面试或后续阶段，流程结构不再允许修改。'
                  }}
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <UIcon
                  v-if="isTogglingWrittenTestFlow || isStatusTransitioning || isTerminatingOpportunity"
                  name="i-lucide-loader-circle"
                  class="size-4 animate-spin text-muted"
                />
                <span v-if="isStatusTransitioning || isTerminatingOpportunity" class="text-[11px] text-muted">
                  {{ isTerminatingOpportunity ? '终止处理中' : '状态流转中' }}
                </span>
                <span
                  class="relative inline-flex h-5 w-9 rounded-full border transition-colors"
                  :class="opportunity.includeWrittenTest ? 'border-primary bg-primary' : 'border-default bg-default'"
                >
                  <span
                    class="absolute top-0.5 size-3.5 rounded-full bg-white transition-transform"
                    :class="opportunity.includeWrittenTest ? 'translate-x-4' : 'translate-x-0.5'"
                  />
                </span>
              </span>
            </button>
          </div>

          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-highlighted">求职偏好</h2>
          </div>

          <div class="space-y-4">
            <div class="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div class="app-panel-muted p-3">
                <p class="preference-field-label">意向等级</p>
                <div class="grid grid-cols-4 gap-1.5">
                  <button
                    v-for="item in intentionOptions"
                    :key="item.value"
                    type="button"
                    :disabled="infoForm.status === 'closed'"
                    class="app-interactive-button rounded-md border px-2 py-1.5 text-center"
                    :class="
                      infoForm.intentionLevel === item.value
                        ? 'border-primary bg-primary/10 text-highlighted'
                        : 'border-default text-muted hover:bg-elevated hover:text-highlighted'
                    "
                    :title="item.description"
                    @click="infoForm.intentionLevel = item.value"
                  >
                    <span class="block text-sm font-semibold leading-5">{{ item.label }}</span>
                  </button>
                </div>
              </div>

              <div class="app-panel-muted p-3">
                <p class="preference-field-label">公司行业</p>
                <USelect
                  v-model="infoForm.industry"
                  class="w-full"
                  :items="industrySelectItems"
                  value-key="value"
                  placeholder="选择公司行业"
                  :disabled="infoForm.status === 'closed'"
                  :content="{ align: 'start', sideOffset: 8 }"
                />
              </div>
            </div>

            <div>
              <p class="preference-field-label">备注</p>
              <UTextarea
                v-model="infoForm.note"
                class="w-full"
                :rows="3"
                placeholder="例如：上海 base 可沟通，面试重点准备 RAG 和 AgentRun。"
                :disabled="infoForm.status === 'closed'"
              />
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-default pt-3">
              <p class="text-xs text-muted">
                {{ hasOpportunityMetaChanged ? '有未保存的偏好改动' : '当前偏好已保存' }}
              </p>
              <UButton
                type="button"
                icon="i-lucide-save"
                :loading="isSavingOpportunityMeta"
                :disabled="!hasOpportunityMetaChanged || infoForm.status === 'closed' || isSavingOpportunityMeta"
                :class="
                  !hasOpportunityMetaChanged || infoForm.status === 'closed'
                    ? 'cursor-not-allowed opacity-45 saturate-50'
                    : ''
                "
                @click="emit('saveOpportunityMeta')"
              >
                保存
              </UButton>
            </div>
          </div>
        </section>

        <section class="app-panel p-5">
          <div class="mb-4 flex min-h-8 items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-highlighted">跟进建议</h2>
            <div class="flex min-h-8 min-w-[11.5rem] items-center justify-end gap-2">
              <UButton
                v-if="canOpenInterviewReview"
                type="button"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-clipboard-pen"
                class="interview-review-action-appear app-interactive-button"
                @click="emit('openInterviewReviewDrawer')"
              >
                面试复盘
              </UButton>
              <UButton
                v-if="canOpenWrittenTestReview"
                type="button"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-file-pen-line"
                class="interview-review-action-appear app-interactive-button"
                @click="emit('openWrittenTestReviewDrawer')"
              >
                笔试复盘
              </UButton>
            </div>
          </div>

          <section class="app-panel-muted border-dashed p-4">
            <p class="text-xs font-medium text-muted">准备建议</p>
            <ul class="mt-3 space-y-2">
              <li
                v-for="item in analysis?.interviewFocus.slice(0, 4) ?? []"
                :key="item.topic"
                class="text-xs leading-5 text-muted"
              >
                · {{ item.topic }}
              </li>
            </ul>
          </section>
        </section>
      </aside>
    </div>

    <Transition name="project-edit-drawer">
      <div
        v-if="isWrittenTestReviewDrawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/35 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="笔试复盘"
        @click.self="emit('closeWrittenTestReviewDrawer')"
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
              :disabled="isSavingWrittenTestReview"
              @click="emit('closeWrittenTestReviewDrawer')"
            />
          </div>

          <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <UFormField label="笔试时间">
              <UPopover v-model:open="writtenTestDatePopoverOpen" :portal="true" :ui="{ content: 'z-[100]' }">
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  class="w-full justify-between"
                  trailing-icon="i-lucide-calendar-days"
                >
                  {{ writtenTestDateLabel }}
                </UButton>
                <template #content>
                  <div class="p-2">
                    <UCalendar
                      v-model="writtenTestCalendarDate"
                      @update:model-value="emit('handleWrittenTestDateSelect', $event)"
                    />
                  </div>
                </template>
              </UPopover>
            </UFormField>

            <UFormField label="笔试复盘">
              <UTextarea
                v-model="writtenTestReviewForm.reviewNote"
                class="w-full"
                :rows="12"
                placeholder="记录题型、难点、时间分配、未掌握知识点，以及你觉得需要继续补强的内容。"
              />
            </UFormField>
          </div>

          <div class="flex justify-end gap-2 border-t border-default px-5 py-4">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :disabled="isSavingWrittenTestReview"
              @click="emit('closeWrittenTestReviewDrawer')"
            >
              取消
            </UButton>
            <UButton
              type="button"
              icon="i-lucide-save"
              :loading="isSavingWrittenTestReview"
              :disabled="isSavingWrittenTestReview"
              @click="emit('saveWrittenTestReview')"
            >
              保存复盘
            </UButton>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="project-edit-drawer">
      <div
        v-if="isInterviewReviewDrawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/35 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="测评记录"
        @click.self="emit('closeInterviewReviewDrawer')"
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
              :disabled="isAddingInterviewRound"
              @click="emit('closeInterviewReviewDrawer')"
            />
          </div>

          <div class="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section class="app-panel-muted p-4">
              <div class="mb-4 flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-highlighted">新增记录</h3>
                <UBadge color="neutral" variant="subtle" :label="statusLabelMap[infoForm.status]" />
              </div>

              <div class="space-y-3">
                <UFormField label="轮次类型">
                  <USelect
                    v-model="roundForm.type"
                    class="w-full"
                    :items="availableInterviewRoundTypeOptions"
                    value-key="value"
                    :content="drawerSelectContent"
                  />
                </UFormField>
                <UFormField label="轮次名称">
                  <UInput v-model="roundForm.title" class="w-full" placeholder="一面 / 项目面 / HR 面" />
                </UFormField>
                <UFormField label="日期">
                  <UPopover v-model:open="roundDatePopoverOpen" :portal="true" :ui="{ content: 'z-[100]' }">
                    <UButton
                      type="button"
                      color="neutral"
                      variant="outline"
                      class="w-full justify-between"
                      trailing-icon="i-lucide-calendar-days"
                    >
                      {{ interviewRoundDateLabel }}
                    </UButton>
                    <template #content>
                      <div class="p-2">
                        <UCalendar
                          v-model="roundCalendarDate"
                          @update:model-value="emit('handleRoundDateSelect', $event)"
                        />
                      </div>
                    </template>
                  </UPopover>
                </UFormField>
                <UFormField label="复盘备注">
                  <UTextarea
                    v-model="roundForm.note"
                    class="w-full"
                    :rows="8"
                    placeholder="记录题目、表现、追问和你觉得卡住的地方"
                  />
                </UFormField>
                <UButton
                  type="button"
                  icon="i-lucide-plus"
                  class="w-full justify-center"
                  :loading="isAddingInterviewRound"
                  :disabled="!roundForm.title.trim() || isAddingInterviewRound"
                  @click="emit('addInterviewRound')"
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
                        @click="emit('openRoundEditDrawer', round)"
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
                                @click="emit('confirmDeleteRound', round.id)"
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

    <Transition name="project-edit-drawer">
      <div
        v-if="isRoundEditDrawerOpen"
        class="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="编辑测评记录"
        @click.self="emit('closeRoundEditDrawer')"
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
              :disabled="isSavingRoundEdit"
              @click="emit('closeRoundEditDrawer')"
            />
          </div>

          <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <UFormField label="轮次类型">
              <USelect
                v-model="roundEditForm.type"
                class="w-full"
                :items="availableInterviewRoundTypeOptions"
                value-key="value"
                :content="drawerSelectContent"
              />
            </UFormField>

            <UFormField label="轮次名称">
              <UInput v-model="roundEditForm.title" class="w-full" placeholder="一面 / 项目面 / HR 面" />
            </UFormField>

            <UFormField label="日期">
              <UPopover v-model:open="editRoundDatePopoverOpen" :portal="true" :ui="{ content: 'z-[100]' }">
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  class="w-full justify-between"
                  trailing-icon="i-lucide-calendar-days"
                >
                  {{ roundEditForm.date || '请输入日期' }}
                </UButton>
                <template #content>
                  <div class="p-2">
                    <UCalendar
                      v-model="editRoundCalendarDate"
                      @update:model-value="emit('handleEditRoundDateSelect', $event)"
                    />
                  </div>
                </template>
              </UPopover>
            </UFormField>

            <UFormField label="复盘备注">
              <UTextarea
                v-model="roundEditForm.note"
                class="w-full"
                :rows="8"
                placeholder="记录真实面试复盘，后续可以作为 AI 分析输入。"
              />
            </UFormField>
          </div>

          <div class="flex justify-end gap-2 border-t border-default px-5 py-4">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :disabled="isSavingRoundEdit"
              @click="emit('closeRoundEditDrawer')"
              >取消</UButton
            >
            <UButton
              type="button"
              icon="i-lucide-save"
              :loading="isSavingRoundEdit"
              :disabled="!roundEditForm.title.trim() || !hasRoundEditChanged || isSavingRoundEdit"
              @click="emit('saveRoundEdit')"
            >
              保存修改
            </UButton>
          </div>
        </section>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 33px !important;
  min-height: 33px !important;
}
</style>
