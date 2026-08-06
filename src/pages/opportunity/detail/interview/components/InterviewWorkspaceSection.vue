<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { useInterviewStore, useSettingsStore } from '@/stores'
import type { InterviewConfig, InterviewSessionSummary } from '@/types/interview'
import type { JobAnalysis } from '@/types/opportunity'
import CreateInterviewModal from './CreateInterviewModal.vue'
import InterviewHistoryList from './InterviewHistoryList.vue'
import InterviewOverviewPanel from './InterviewOverviewPanel.vue'

const props = defineProps<{
  opportunityId: string
  analysis: JobAnalysis | null
}>()

const router = useRouter()
const toast = useToast()
const interviewStore = useInterviewStore()
const settingsStore = useSettingsStore()

const isCreateModalOpen = ref(false)
const isCreating = ref(false)
const openingSessionId = ref<string | null>(null)
const sessionSummaries = computed<InterviewSessionSummary[]>(() =>
  interviewStore.sessionSummariesForOpportunity(props.opportunityId),
)
const overview = computed(() => interviewStore.overviewsByOpportunityId[props.opportunityId] ?? null)
const isLoading = computed(() => interviewStore.loadingOpportunityIds.includes(props.opportunityId))
const loadError = computed(() => interviewStore.errorsByScope[`opportunity:${props.opportunityId}`])
const isModelReady = computed(() => {
  const { baseUrl, modelName, apiKey } = settingsStore.llm
  return Boolean(baseUrl.trim() && modelName.trim() && apiKey.trim())
})

function loadWorkspace() {
  if (!props.opportunityId) return
  void interviewStore.loadInterviewHome(props.opportunityId)
}

function openCreateModal() {
  if (!props.analysis) {
    toast.add({
      title: '当前 JD 尚未完成分析',
      description: '分析完成后才能基于简历和 JD 创建模拟面试。',
      color: 'warning',
    })
    return
  }
  if (!isModelReady.value) {
    toast.add({ title: '请先配置可用模型', description: '模拟面试需要模型配置才能生成问题与评分。', color: 'warning' })
    void router.push({ name: 'settings' })
    return
  }

  isCreateModalOpen.value = true
}

async function createInterview(config: InterviewConfig) {
  if (isCreating.value) return

  isCreating.value = true
  try {
    const session = await interviewStore.createInterview(props.opportunityId, config)
    isCreateModalOpen.value = false
    toast.add({
      title: '模拟面试已开始',
      description: '正在根据本轮配置准备第一个问题。',
      color: 'success',
      icon: 'i-lucide-wand-sparkles',
    })
    await router.push({
      name: 'opportunity-interview-session',
      params: { id: props.opportunityId, sessionId: session.id },
    })
  } catch (error) {
    toast.add({
      title: '创建模拟面试失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    isCreating.value = false
  }
}

async function openSession(sessionId: string) {
  if (openingSessionId.value) return

  openingSessionId.value = sessionId
  try {
    await router.push({ name: 'opportunity-interview-session', params: { id: props.opportunityId, sessionId } })
  } finally {
    openingSessionId.value = null
  }
}

watch(
  () => props.opportunityId,
  () => loadWorkspace(),
  { immediate: true },
)
</script>

<template>
  <section class="min-w-0">
    <section v-if="loadError" class="app-empty-state p-6 text-center">
      <p class="text-sm text-error">{{ loadError }}</p>
      <UButton
        type="button"
        class="mt-4"
        color="neutral"
        variant="outline"
        icon="i-lucide-rotate-cw"
        :loading="isLoading"
        @click="loadWorkspace"
      >
        重新加载
      </UButton>
    </section>

    <div v-else class="grid items-start gap-5 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-stretch">
      <InterviewHistoryList
        :sessions="sessionSummaries"
        :loading="isLoading"
        :opening-session-id="openingSessionId"
        @create="openCreateModal"
        @open="openSession"
      />
      <InterviewOverviewPanel :overview="overview" :loading="isLoading" />
    </div>
  </section>

  <CreateInterviewModal
    :open="isCreateModalOpen"
    :loading="isCreating"
    @close="isCreateModalOpen = false"
    @submit="createInterview"
  />
</template>
