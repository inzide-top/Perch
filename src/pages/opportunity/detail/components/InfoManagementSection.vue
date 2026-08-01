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
import InterviewReviewDrawer from './info/InterviewReviewDrawer.vue'
import RoundEditDrawer from './info/RoundEditDrawer.vue'
import WrittenTestReviewDrawer from './info/WrittenTestReviewDrawer.vue'

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
            修改 JD 信息不会自动更新现有匹配结果。如需应用最新岗位信息，请在机会列表中手动重新分析。
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

    <WrittenTestReviewDrawer
      v-model:form="writtenTestReviewForm"
      v-model:date-popover-open="writtenTestDatePopoverOpen"
      v-model:calendar-date="writtenTestCalendarDate"
      :open="isWrittenTestReviewDrawerOpen"
      :saving="isSavingWrittenTestReview"
      :date-label="writtenTestDateLabel"
      @close="emit('closeWrittenTestReviewDrawer')"
      @save="emit('saveWrittenTestReview')"
      @select-date="emit('handleWrittenTestDateSelect', $event)"
    />

    <InterviewReviewDrawer
      v-model:form="roundForm"
      v-model:date-popover-open="roundDatePopoverOpen"
      v-model:calendar-date="roundCalendarDate"
      v-model:deleting-round-id="deletingRoundId"
      :open="isInterviewReviewDrawerOpen"
      :opportunity="opportunity"
      :status="infoForm.status"
      :status-label-map="statusLabelMap"
      :round-type-options="availableInterviewRoundTypeOptions"
      :date-label="interviewRoundDateLabel"
      :adding="isAddingInterviewRound"
      :deleting-round-action-id="deletingRoundActionId"
      @close="emit('closeInterviewReviewDrawer')"
      @add="emit('addInterviewRound')"
      @select-date="emit('handleRoundDateSelect', $event)"
      @edit="emit('openRoundEditDrawer', $event)"
      @delete="emit('confirmDeleteRound', $event)"
    />

    <RoundEditDrawer
      v-model:form="roundEditForm"
      v-model:date-popover-open="editRoundDatePopoverOpen"
      v-model:calendar-date="editRoundCalendarDate"
      :open="isRoundEditDrawerOpen"
      :saving="isSavingRoundEdit"
      :changed="hasRoundEditChanged"
      :round-type-options="availableInterviewRoundTypeOptions"
      @close="emit('closeRoundEditDrawer')"
      @save="emit('saveRoundEdit')"
      @select-date="emit('handleEditRoundDateSelect', $event)"
    />
  </section>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 32px !important;
  min-height: 32px !important;
  border-color: var(--ui-border-accented);
  border-radius: calc(var(--ui-radius) * 1.5);
}
</style>
