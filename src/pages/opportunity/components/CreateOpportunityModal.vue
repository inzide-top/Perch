<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import CityPicker from '@/components/CityPicker.vue'
import type { CreateOpportunityPayload } from '@/services/opportunities'
import { defaultMockJobDraft, type MockJobDraft } from '../mocks/jobDraft'

type JobFormField = 'company' | 'jobTitle' | 'description'

const props = defineProps<{
  open: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: CreateOpportunityPayload]
}>()

const mockJobDraftStorageKey = 'agent-seek-employment:mock-job-draft:v2'
let mockSavedTimer: number | null = null

const mockSavedMessage = ref('')
const form = reactive<MockJobDraft>({
  company: '',
  jobTitle: '',
  address: [],
  introduction: '',
  description: '',
})
const errors = reactive<Record<JobFormField, string>>({
  company: '',
  jobTitle: '',
  description: '',
})

function normalizeCityList(cities: string[] | string | undefined) {
  if (Array.isArray(cities)) return cities
  if (typeof cities === 'string' && cities.trim()) return [cities.trim()]

  return []
}

function resetForm() {
  Object.assign(form, { company: '', jobTitle: '', address: [], introduction: '', description: '' })
  clearAllErrors()
}

function clearAllErrors() {
  errors.company = ''
  errors.jobTitle = ''
  errors.description = ''
}

function readMockJobDraft(): MockJobDraft {
  const storedDraft = localStorage.getItem(mockJobDraftStorageKey)
  if (!storedDraft) return defaultMockJobDraft

  try {
    const parsedDraft = JSON.parse(storedDraft) as MockJobDraft & { address?: string[] | string }

    return {
      ...defaultMockJobDraft,
      ...parsedDraft,
      address: normalizeCityList(parsedDraft.address),
    }
  } catch {
    return defaultMockJobDraft
  }
}

function importMockJobDraft() {
  Object.assign(form, readMockJobDraft())
  clearAllErrors()
}

function validateForm() {
  errors.company = form.company.trim() ? '' : '请填写公司名称'
  errors.jobTitle = form.jobTitle.trim() ? '' : '请填写岗位名称'
  errors.description = form.description.trim() ? '' : '请填写岗位要求'

  return !Object.values(errors).some(Boolean)
}

function clearError(field: JobFormField) {
  errors[field] = ''
}

function setCurrentJobDraftAsMockData() {
  if (!validateForm()) return

  const draft: MockJobDraft = {
    company: form.company.trim(),
    jobTitle: form.jobTitle.trim(),
    address: [...form.address],
    introduction: form.introduction.trim(),
    description: form.description.trim(),
  }
  localStorage.setItem(mockJobDraftStorageKey, JSON.stringify(draft))
  mockSavedMessage.value = '已设为本地 mock 数据'

  if (mockSavedTimer) window.clearTimeout(mockSavedTimer)
  mockSavedTimer = window.setTimeout(() => {
    mockSavedMessage.value = ''
    mockSavedTimer = null
  }, 2500)
}

function close() {
  if (props.loading) return

  emit('close')
}

function submit() {
  if (props.loading || !validateForm()) return

  emit('submit', {
    company: form.company.trim(),
    jobTitle: form.jobTitle.trim(),
    address: [...form.address],
    introduction: form.introduction.trim(),
    description: form.description.trim(),
  })
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (!isOpen && wasOpen) resetForm()
  },
)
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!loading"
    :close="false"
    :ui="{ overlay: 'bg-black/55', content: 'app-panel w-[calc(100%-2rem)] max-w-2xl overflow-hidden shadow-xl' }"
    @update:open="(nextOpen: boolean) => !nextOpen && close()"
  >
    <template #content>
      <div>
        <header class="flex items-start justify-between gap-4 border-b border-default px-6 py-5">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">创建 JD 分析</h2>
            <p class="mt-1 text-sm text-muted">先保存 JD 信息，后续会基于简历版本生成结构化分析。</p>
          </div>
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="loading" @click="close" />
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div class="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <UFormField label="公司名称" required>
              <UInput
                v-model="form.company"
                class="w-full"
                :class="{ 'form-control-error': errors.company }"
                placeholder="例如：小红书"
                @update:model-value="clearError('company')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.company ? 'text-error' : 'invisible'"
              >
                {{ errors.company || '占位' }}
              </p>
            </UFormField>

            <UFormField label="岗位名称" required>
              <UInput
                v-model="form.jobTitle"
                class="w-full"
                :class="{ 'form-control-error': errors.jobTitle }"
                placeholder="例如：前端开发工程师"
                @update:model-value="clearError('jobTitle')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.jobTitle ? 'text-error' : 'invisible'"
              >
                {{ errors.jobTitle || '占位' }}
              </p>
            </UFormField>
          </div>

          <div class="space-y-3">
            <UFormField label="Base 地址">
              <CityPicker v-model="form.address" :max="5" panel-height-class="h-52" />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>

            <UFormField label="岗位介绍">
              <UTextarea
                v-model="form.introduction"
                class="w-full"
                :rows="4"
                placeholder="粘贴岗位背景、团队方向或业务介绍"
              />
              <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
            </UFormField>

            <UFormField label="岗位要求" required>
              <UTextarea
                v-model="form.description"
                class="w-full"
                :class="{ 'form-control-error': errors.description }"
                :rows="8"
                placeholder="粘贴 JD 中的岗位职责、任职要求、加分项"
                @update:model-value="clearError('description')"
              />
              <p
                class="mt-1 min-h-[14px] text-[11px] leading-[14px]"
                :class="errors.description ? 'text-error' : 'invisible'"
              >
                {{ errors.description || '占位' }}
              </p>
            </UFormField>
          </div>
        </div>

        <footer class="flex items-center justify-between gap-3 border-t border-default px-6 py-4">
          <div class="flex items-center gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-file-input"
              :disabled="loading"
              @click="importMockJobDraft"
            >
              导入 mock 数据
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-save"
              :disabled="loading"
              @click="setCurrentJobDraftAsMockData"
            >
              设为 mock 数据
            </UButton>
            <span v-if="mockSavedMessage" class="text-xs text-muted">{{ mockSavedMessage }}</span>
          </div>

          <div class="flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="close">取消</UButton>
            <UButton type="button" icon="i-lucide-check" :loading="loading" :disabled="loading" @click="submit"
              >确认创建</UButton
            >
          </div>
        </footer>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
:deep(.city-picker-trigger) {
  height: 32px !important;
  min-height: 32px !important;
  border-color: var(--ui-border-accented);
  border-radius: calc(var(--ui-radius) * 1.5);
}
</style>
