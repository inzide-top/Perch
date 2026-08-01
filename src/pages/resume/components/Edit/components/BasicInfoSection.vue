<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import CityPicker from '@/components/CityPicker.vue'
import { industryOptions } from '@/data/industryOptions'
import type {
  CurrentStatusOption,
  EducationLevelOption,
  JobSearchIdentityOption,
  LanguageAbility,
  LanguageAbilityForm,
  LanguageLevelOption,
  ResumeErrors,
  ResumeFormState,
  ResumeRequiredField,
  WorkExperience,
  WorkExperienceErrors,
  WorkExperienceForm,
  WorkExperienceRequiredField,
} from '../types'

defineProps<{
  resumeErrors: ResumeErrors
  educationLevelOptions: EducationLevelOption[]
  currentStatusOptions: CurrentStatusOption[]
  jobSearchIdentityOptions: JobSearchIdentityOption[]
  languageLevelOptions: LanguageLevelOption[]
}>()

const emit = defineEmits<{
  clearResumeError: [field: ResumeRequiredField]
}>()

const form = defineModel<ResumeFormState>('form', { required: true })
const workExperiences = defineModel<WorkExperience[]>('workExperiences', { required: true })
const portfolioLinksText = defineModel<string>('portfolioLinksText', { required: true })
const languages = defineModel<LanguageAbility[]>('languages', { required: true })

const allLanguageOptions = ['英语', '西班牙语', '葡萄牙语', '法语', '日语', '其他'].map((language) => ({
  label: language,
  value: language,
}))
const industrySelectItems = industryOptions.map((industry) => ({ label: industry, value: industry }))

const languageForm = reactive<LanguageAbilityForm>({
  language: '英语',
  level: 'reading_writing',
})
const workExperienceForm = reactive<WorkExperienceForm>({
  companyName: '',
  industry: '',
  department: '',
  jobTitle: '',
  period: {
    start: '',
    end: '',
  },
})
const workExperienceErrors = reactive<WorkExperienceErrors>({
  companyName: '',
  jobTitle: '',
  period: '',
})

const graduationDatePopoverOpen = ref(false)
const graduationCalendarDate = ref<unknown>()
const isWorkExperienceModalOpen = ref(false)
const workExperiencePeriodPopoverOpen = ref(false)
const workExperienceCalendarRange = ref<unknown>()
const pendingDeleteWorkExperienceIndex = ref<number | null>(null)
const originalBodyOverflow = ref('')

const availableLanguageOptions = computed(() => {
  const selectedLanguageSet = new Set(languages.value.map((language) => language.language))

  return allLanguageOptions.filter((language) => !selectedLanguageSet.has(language.value))
})
const canAddLanguage = computed(
  () => Boolean(languageForm.language.trim()) && availableLanguageOptions.value.length > 0,
)
const graduationTimeLabel = computed(() => {
  return form.value.graduationYear || '选择毕业年月'
})
const workExperiencePeriodLabel = computed(() => {
  const { start, end } = workExperienceForm.period

  if (start && end) return `${start} 至 ${end}`
  if (start) return `${start} 至 结束时间`
  if (end) return `开始时间 至 ${end}`

  return '请选择工作时间范围'
})

function formatCalendarMonth(value: unknown) {
  if (!value) return ''

  const maybeDateValue = value as { year?: number; month?: number }

  if (typeof maybeDateValue.year === 'number' && typeof maybeDateValue.month === 'number') {
    return `${maybeDateValue.year}-${String(maybeDateValue.month).padStart(2, '0')}`
  }

  return String(value).slice(0, 7)
}

function getCalendarRangeValue(value: unknown, key: 'start' | 'end') {
  if (!value || typeof value !== 'object') return undefined

  return (value as Record<'start' | 'end', unknown>)[key]
}

function resetLanguageForm() {
  Object.assign(languageForm, { language: availableLanguageOptions.value[0]?.value ?? '', level: 'reading_writing' })
}

function resetWorkExperienceForm() {
  Object.assign(workExperienceForm, {
    companyName: '',
    industry: '',
    department: '',
    jobTitle: '',
    period: {
      start: '',
      end: '',
    },
  })
  workExperienceErrors.companyName = ''
  workExperienceErrors.jobTitle = ''
  workExperienceErrors.period = ''
  workExperienceCalendarRange.value = undefined
  workExperiencePeriodPopoverOpen.value = false
}

function addLanguage() {
  if (!canAddLanguage.value) return

  languages.value.push({
    id: crypto.randomUUID(),
    language: languageForm.language.trim(),
    level: languageForm.level,
  })
  resetLanguageForm()
}

function removeLanguage(languageId: string) {
  languages.value = languages.value.filter((language) => language.id !== languageId)
  resetLanguageForm()
}

function validateWorkExperienceForm() {
  workExperienceErrors.companyName = workExperienceForm.companyName.trim() ? '' : '请填写公司名称'
  workExperienceErrors.jobTitle = workExperienceForm.jobTitle.trim() ? '' : '请填写岗位名称'
  workExperienceErrors.period =
    workExperienceForm.period.start && workExperienceForm.period.end ? '' : '请选择工作时间范围'

  return !Object.values(workExperienceErrors).some(Boolean)
}

function openWorkExperienceModal() {
  resetWorkExperienceForm()
  pendingDeleteWorkExperienceIndex.value = null
  isWorkExperienceModalOpen.value = true
}

function closeWorkExperienceModal() {
  isWorkExperienceModalOpen.value = false
  resetWorkExperienceForm()
}

function addWorkExperience() {
  if (!validateWorkExperienceForm()) return false

  workExperiences.value.push({
    id: crypto.randomUUID(),
    companyName: workExperienceForm.companyName.trim(),
    industry: workExperienceForm.industry?.trim() ?? '',
    department: workExperienceForm.department?.trim() ?? '',
    jobTitle: workExperienceForm.jobTitle.trim(),
    period: {
      start: workExperienceForm.period.start,
      end: workExperienceForm.period.end,
    },
  })
  resetWorkExperienceForm()
  return true
}

function submitWorkExperienceModal() {
  if (addWorkExperience()) {
    closeWorkExperienceModal()
  }
}

function handleGraduationMonthSelect(value: unknown) {
  const monthValue = formatCalendarMonth(value)
  if (!monthValue) return

  form.value.graduationYear = monthValue
  graduationDatePopoverOpen.value = false
}

function handleWorkExperienceRangeSelect(value: unknown) {
  workExperienceCalendarRange.value = value

  const startValue = formatCalendarMonth(getCalendarRangeValue(value, 'start'))
  const endValue = formatCalendarMonth(getCalendarRangeValue(value, 'end'))

  if (startValue) workExperienceForm.period.start = startValue
  if (endValue) workExperienceForm.period.end = endValue

  if (workExperienceForm.period.start && workExperienceForm.period.end) {
    clearWorkExperienceError('period')
    workExperiencePeriodPopoverOpen.value = false
  }
}

function removeWorkExperience(index: number) {
  workExperiences.value.splice(index, 1)
  pendingDeleteWorkExperienceIndex.value = null
}

function clearResumeError(field: ResumeRequiredField) {
  emit('clearResumeError', field)
}

function clearWorkExperienceError(field: WorkExperienceRequiredField) {
  workExperienceErrors[field] = ''
}

function lockBodyScroll() {
  if (typeof document === 'undefined') return

  originalBodyOverflow.value = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return

  document.body.style.overflow = originalBodyOverflow.value
}

watch(isWorkExperienceModalOpen, (isOpen) => {
  if (isOpen) {
    lockBodyScroll()
    return
  }

  unlockBodyScroll()
})

watch(availableLanguageOptions, () => {
  if (!availableLanguageOptions.value.some((option) => option.value === languageForm.language)) {
    resetLanguageForm()
  }
})

onBeforeUnmount(() => {
  unlockBodyScroll()
})
</script>

<template>
  <section>
    <div class="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 class="app-section-title">基础信息</h2>
        <p class="app-section-kicker mt-1">用于后续 JD 匹配、简历建议和面试追问</p>
      </div>
    </div>

    <div class="grid gap-x-5 gap-y-3 md:grid-cols-2">
      <UFormField label="简历名称" required>
        <UInput
          v-model="form.title"
          class="w-full"
          :class="{ 'form-control-error': resumeErrors.title }"
          placeholder="前端开发简历"
          @update:model-value="clearResumeError('title')"
        />
        <p
          class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
          :class="resumeErrors.title ? 'text-error' : 'invisible'"
        >
          {{ resumeErrors.title || '占位' }}
        </p>
      </UFormField>
      <UFormField label="目标岗位" required>
        <UInput
          v-model="form.targetDirection"
          class="w-full"
          :class="{ 'form-control-error': resumeErrors.targetDirection }"
          placeholder="前端开发工程师"
          @update:model-value="clearResumeError('targetDirection')"
        />
        <p
          class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
          :class="resumeErrors.targetDirection ? 'text-error' : 'invisible'"
        >
          {{ resumeErrors.targetDirection || '占位' }}
        </p>
      </UFormField>
      <UFormField label="姓名" required>
        <UInput
          v-model="form.name"
          class="w-full"
          :class="{ 'form-control-error': resumeErrors.name }"
          placeholder="请输入姓名"
          @update:model-value="clearResumeError('name')"
        />
        <p class="mt-1 min-h-[14px] text-[11px] leading-[14px]" :class="resumeErrors.name ? 'text-error' : 'invisible'">
          {{ resumeErrors.name || '占位' }}
        </p>
      </UFormField>
      <UFormField label="意向城市">
        <CityPicker v-model="form.address" />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
    </div>

    <div class="grid gap-x-5 gap-y-3 md:grid-cols-2">
      <UFormField label="毕业/在读学校">
        <UInput v-model="form.school" class="w-full" placeholder="例如：武汉大学" />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
      <UFormField label="专业">
        <UInput v-model="form.major" class="w-full" placeholder="例如：计算机科学与技术" />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
      <UFormField label="毕业时间">
        <UPopover v-model:open="graduationDatePopoverOpen">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="w-full justify-between"
            trailing-icon="i-lucide-calendar-days"
          >
            {{ graduationTimeLabel }}
          </UButton>
          <template #content>
            <div class="p-2">
              <UCalendar
                v-model="graduationCalendarDate"
                type="month"
                size="sm"
                @update:model-value="handleGraduationMonthSelect"
              />
            </div>
          </template>
        </UPopover>
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
      <UFormField label="学历">
        <USelect
          v-model="form.educationLevel"
          class="w-full"
          :items="educationLevelOptions"
          value-key="value"
          placeholder="选择学历"
        />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
      <UFormField label="求职身份" required>
        <USelect
          v-model="form.jobSearchIdentity"
          class="w-full"
          :class="{ 'form-control-error': resumeErrors.jobSearchIdentity }"
          :items="jobSearchIdentityOptions"
          value-key="value"
          placeholder="选择求职身份"
          @update:model-value="clearResumeError('jobSearchIdentity')"
        />
        <p
          class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
          :class="resumeErrors.jobSearchIdentity ? 'text-error' : 'invisible'"
        >
          {{ resumeErrors.jobSearchIdentity || '占位' }}
        </p>
      </UFormField>
      <UFormField label="当前状态">
        <USelect
          v-model="form.currentStatus"
          class="w-full"
          :items="currentStatusOptions"
          value-key="value"
          placeholder="选择当前状态"
        />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
    </div>

    <section class="app-panel-muted mt-5 p-3">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="text-sm font-semibold text-highlighted">过往工作经历</h3>
          <UBadge color="neutral" variant="subtle" :label="`${workExperiences.length} 段`" />
        </div>
        <UButton
          type="button"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="shrink-0"
          @click="openWorkExperienceModal"
        >
          添加
        </UButton>
      </div>

      <div
        v-if="!workExperiences.length"
        class="rounded-xl border border-dashed border-default bg-[color-mix(in_srgb,var(--app-surface)_48%,transparent)] px-4 py-5 text-center text-xs text-muted"
      >
        暂无过往工作经历
      </div>

      <div v-else class="grid gap-2 sm:grid-cols-2">
        <article v-for="(experience, index) in workExperiences" :key="experience.id" class="app-card px-3 py-2.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ experience.companyName }} · {{ experience.jobTitle }}
              </p>
              <p class="mt-1 truncate text-xs text-muted">
                {{ experience.period.start }} 至 {{ experience.period.end }}
                <span v-if="experience.industry"> · {{ experience.industry }}</span>
                <span v-if="experience.department"> · {{ experience.department }}</span>
              </p>
            </div>
            <div class="relative shrink-0">
              <button
                type="button"
                class="project-card-remove"
                aria-label="删除工作经历"
                title="删除工作经历"
                @click="pendingDeleteWorkExperienceIndex = pendingDeleteWorkExperienceIndex === index ? null : index"
              >
                <UIcon name="i-lucide-trash-2" class="size-3.5" />
              </button>

              <div
                v-if="pendingDeleteWorkExperienceIndex === index"
                class="app-panel absolute right-0 top-[calc(100%+0.5rem)] z-20 w-56 p-3 text-sm shadow-xl"
              >
                <p class="font-medium text-highlighted">删除这段工作经历？</p>
                <p class="mt-1 text-xs leading-5 text-muted">删除后需要重新添加。</p>
                <div class="mt-3 flex justify-end gap-2">
                  <UButton
                    type="button"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="pendingDeleteWorkExperienceIndex = null"
                  >
                    取消
                  </UButton>
                  <UButton
                    type="button"
                    size="xs"
                    color="error"
                    icon="i-lucide-trash-2"
                    @click="removeWorkExperience(index)"
                  >
                    删除
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div class="mt-5 space-y-3">
      <UFormField label="作品链接">
        <UTextarea
          v-model="portfolioLinksText"
          class="w-full"
          :rows="3"
          placeholder="一行一个链接，例如：https://github.com/your-name/project"
        />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>

      <div>
        <div class="mb-2 flex items-center justify-between gap-3">
          <label class="block text-sm font-medium text-highlighted">语言能力</label>
          <span v-if="languages.length" class="text-xs text-muted">已添加 {{ languages.length }} 项</span>
        </div>

        <div class="app-panel-muted p-3">
          <div class="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]">
            <USelect
              v-model="languageForm.language"
              class="w-full"
              :items="availableLanguageOptions"
              value-key="value"
              placeholder="选择语言"
              :disabled="availableLanguageOptions.length === 0"
            />
            <USelect
              v-model="languageForm.level"
              class="w-full"
              :items="languageLevelOptions"
              value-key="value"
              placeholder="选择水平"
              :disabled="availableLanguageOptions.length === 0"
            />
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              class="justify-center"
              :disabled="!canAddLanguage"
              @click="addLanguage"
            >
              添加
            </UButton>
          </div>

          <div
            v-if="languages.length"
            class="mt-3 divide-y divide-default rounded-xl border border-default bg-[var(--app-surface)]"
          >
            <div
              v-for="language in languages"
              :key="language.id"
              class="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">{{ language.language }}</p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ languageLevelOptions.find((option) => option.value === language.level)?.label }}
                </p>
              </div>
              <button
                type="button"
                class="project-card-remove"
                :aria-label="`删除${language.language}能力`"
                :title="`删除${language.language}能力`"
                @click="removeLanguage(language.id)"
              >
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
          </div>

          <p v-else class="mt-3 text-xs leading-5 text-muted">
            如果 JD 没有外语要求，这一项不会参与核心匹配；如果岗位要求英语、日语等，会作为补充信号。
          </p>
          <p v-if="availableLanguageOptions.length === 0" class="mt-3 text-xs leading-5 text-muted">
            当前支持的语言都已添加，后续可以扩展自定义语言。
          </p>
        </div>
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </div>
    </div>

    <div class="mt-5 space-y-3">
      <UFormField label="专业技能" required>
        <UTextarea
          v-model="form.skills"
          class="w-full"
          :class="{ 'form-control-error': resumeErrors.skills }"
          :rows="5"
          placeholder="例如：Vue 3、TypeScript、Vite、前端工程化"
          @update:model-value="clearResumeError('skills')"
        />
        <p
          class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
          :class="resumeErrors.skills ? 'text-error' : 'invisible'"
        >
          {{ resumeErrors.skills || '占位' }}
        </p>
      </UFormField>
      <UFormField label="自我评价">
        <UTextarea v-model="form.comment" class="w-full" :rows="5" placeholder="用几句话介绍你的工作方向、经验和优势" />
        <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
      </UFormField>
    </div>

    <Teleport to="body">
      <Transition name="project-edit-drawer">
        <div
          v-if="isWorkExperienceModalOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6"
          @click.self="closeWorkExperienceModal"
        >
          <section
            class="app-panel flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="work-experience-modal-title"
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-default px-5 py-4">
              <div class="min-w-0">
                <h2 id="work-experience-modal-title" class="text-base font-semibold text-highlighted">
                  添加过往工作经历
                </h2>
                <p class="mt-1 text-xs leading-5 text-muted">只记录会影响岗位匹配判断的核心经历。</p>
              </div>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="关闭添加过往工作经历"
                @click="closeWorkExperienceModal"
              />
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                <UFormField label="公司名称" required>
                  <UInput
                    v-model="workExperienceForm.companyName"
                    class="w-full"
                    :class="{ 'form-control-error': workExperienceErrors.companyName }"
                    placeholder="例如：腾讯"
                    @update:model-value="clearWorkExperienceError('companyName')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="workExperienceErrors.companyName ? 'text-error' : 'invisible'"
                  >
                    {{ workExperienceErrors.companyName || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="岗位名称" required>
                  <UInput
                    v-model="workExperienceForm.jobTitle"
                    class="w-full"
                    :class="{ 'form-control-error': workExperienceErrors.jobTitle }"
                    placeholder="例如：前端开发工程师"
                    @update:model-value="clearWorkExperienceError('jobTitle')"
                  />
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="workExperienceErrors.jobTitle ? 'text-error' : 'invisible'"
                  >
                    {{ workExperienceErrors.jobTitle || '占位' }}
                  </p>
                </UFormField>

                <UFormField label="公司行业">
                  <USelect
                    v-model="workExperienceForm.industry"
                    class="w-full"
                    :items="industrySelectItems"
                    value-key="value"
                    placeholder="选择公司行业"
                    :ui="{ content: 'z-[60]' }"
                  />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>

                <UFormField label="部门">
                  <UInput v-model="workExperienceForm.department" class="w-full" placeholder="例如：商业化前端组" />
                  <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
                </UFormField>

                <UFormField label="工作时间" required class="sm:col-span-2">
                  <UPopover v-model:open="workExperiencePeriodPopoverOpen" :ui="{ content: 'z-[60]' }">
                    <UButton
                      type="button"
                      color="neutral"
                      variant="outline"
                      class="w-full justify-between"
                      :class="{ 'form-control-error': workExperienceErrors.period }"
                      trailing-icon="i-lucide-calendar-range"
                    >
                      {{ workExperiencePeriodLabel }}
                    </UButton>
                    <template #content>
                      <div class="p-2">
                        <UCalendar
                          v-model="workExperienceCalendarRange"
                          type="month"
                          range
                          size="sm"
                          @update:model-value="handleWorkExperienceRangeSelect"
                        />
                      </div>
                    </template>
                  </UPopover>
                  <p
                    class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                    :class="workExperienceErrors.period ? 'text-error' : 'invisible'"
                  >
                    {{ workExperienceErrors.period || '占位' }}
                  </p>
                </UFormField>
              </div>
            </div>

            <footer class="flex shrink-0 justify-end gap-2 border-t border-default px-5 py-4">
              <UButton type="button" color="neutral" variant="ghost" @click="closeWorkExperienceModal">取消</UButton>
              <UButton type="button" icon="i-lucide-plus" @click="submitWorkExperienceModal">添加经历</UButton>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
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
