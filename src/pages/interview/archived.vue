<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { interviewApi } from '@/services/interviews'
import type { ArchivedInterviewSessionSummary } from '@/types/interview'

const router = useRouter()
const toast = useToast()
const sessions = ref<ArchivedInterviewSessionSummary[]>([])
const loading = ref(true)
const loadError = ref('')
const restoringSessionId = ref<string | null>(null)
const deletingSessionId = ref<string | null>(null)
const deleteTarget = ref<ArchivedInterviewSessionSummary | null>(null)

function getTypeLabel(session: ArchivedInterviewSessionSummary) {
  return session.config.type === 'foundation' ? '基础面' : '项目面'
}

function getStatusLabel(session: ArchivedInterviewSessionSummary) {
  const labels = {
    preparing: '准备中',
    preparation_failed: '准备失败',
    active: '进行中',
    finalizing: '生成复盘中',
    completed: '已完成',
    ended_early: '提前结束',
    cancelled: '已取消',
  } as const
  return labels[session.status]
}

function formatDate(value: string | null | undefined) {
  if (!value) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function loadSessions() {
  loading.value = true
  loadError.value = ''
  try {
    sessions.value = await interviewApi.listArchivedSessions()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载已归档模拟面试失败'
  } finally {
    loading.value = false
  }
}

function openSession(session: ArchivedInterviewSessionSummary) {
  void router.push({
    name: 'opportunity-interview-session',
    params: { id: session.opportunityId, sessionId: session.id },
  })
}

async function restoreSession(session: ArchivedInterviewSessionSummary) {
  if (restoringSessionId.value) return
  restoringSessionId.value = session.id
  try {
    await interviewApi.restoreSession(session.id)
    sessions.value = sessions.value.filter((item) => item.id !== session.id)
    toast.add({ title: '模拟面试已恢复', color: 'success', icon: 'i-lucide-archive-restore' })
  } catch (error) {
    toast.add({
      title: '恢复失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    restoringSessionId.value = null
  }
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deletingSessionId.value) return
  deletingSessionId.value = target.id
  try {
    await interviewApi.deleteArchivedSession(target.id)
    sessions.value = sessions.value.filter((item) => item.id !== target.id)
    deleteTarget.value = null
    toast.add({ title: '模拟面试已彻底删除', color: 'success', icon: 'i-lucide-trash-2' })
  } catch (error) {
    toast.add({
      title: '彻底删除失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    deletingSessionId.value = null
  }
}

onMounted(() => void loadSessions())
</script>

<template>
  <main class="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            icon="i-lucide-arrow-left"
            aria-label="返回机会管理"
            @click="router.push({ name: 'opportunities' })"
          />
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">已归档模拟面试</h1>
        </div>
        <p class="mt-2 text-sm leading-6 text-muted">
          归档记录不会出现在机会详情的日常列表中；有效训练证据仍会参与能力画像。若不希望继续纳入能力证据，请彻底删除对应记录。
        </p>
      </div>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="loadSessions"
      >
        刷新
      </UButton>
    </header>

    <section v-if="loading" class="grid gap-3 md:grid-cols-2" aria-label="正在加载已归档模拟面试">
      <div v-for="item in 4" :key="item" class="app-panel h-36 animate-pulse" />
    </section>

    <section v-else-if="loadError" class="app-empty-state p-10 text-center">
      <UIcon name="i-lucide-circle-alert" class="mx-auto size-6 text-error" />
      <p class="mt-3 text-sm text-error">{{ loadError }}</p>
      <UButton class="mt-4" color="neutral" variant="outline" @click="loadSessions">重新加载</UButton>
    </section>

    <section v-else-if="sessions.length" class="grid gap-3 md:grid-cols-2">
      <article v-for="session in sessions" :key="session.id" class="app-card p-4">
        <button type="button" class="w-full text-left" @click="openSession(session)">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-base font-semibold text-highlighted">
                  {{ session.company }} · {{ session.jobTitle }}
                </h2>
                <UBadge color="neutral" variant="subtle" :label="getTypeLabel(session)" />
              </div>
              <p class="mt-2 text-sm text-muted">
                {{ getStatusLabel(session) }} · {{ session.answeredQuestionCount }} 次作答 ·
                {{ formatDate(session.archivedAt) }}
              </p>
            </div>
            <span v-if="session.overallScore !== null" class="shrink-0 text-lg font-semibold text-highlighted">
              {{ session.overallScore }}<small class="ml-0.5 text-xs font-normal text-muted">分</small>
            </span>
          </div>
        </button>

        <div class="mt-4 flex items-center justify-between gap-3 border-t border-default pt-3">
          <span class="text-xs text-muted">
            {{ session.opportunityDeletedAt ? '所属机会已删除，仅可查看历史详情' : '可恢复到原机会' }}
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              v-if="!session.opportunityDeletedAt"
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-archive-restore"
              :loading="restoringSessionId === session.id"
              :disabled="restoringSessionId !== null || deletingSessionId !== null"
              @click="restoreSession(session)"
            >
              恢复
            </UButton>
            <UButton
              type="button"
              color="error"
              variant="ghost"
              size="sm"
              square
              icon="i-lucide-trash-2"
              title="彻底删除"
              aria-label="彻底删除"
              :disabled="restoringSessionId !== null || deletingSessionId !== null"
              @click="deleteTarget = session"
            />
          </div>
        </div>
      </article>
    </section>

    <section v-else class="app-empty-state p-12 text-center">
      <UIcon name="i-lucide-archive" class="mx-auto size-7 text-muted" />
      <p class="mt-4 text-sm font-medium text-highlighted">还没有已归档的模拟面试</p>
      <p class="mt-2 text-sm text-muted">在机会详情中归档已经结束的训练后，会统一显示在这里。</p>
    </section>

    <UModal
      :open="Boolean(deleteTarget)"
      :dismissible="!deletingSessionId"
      :close="false"
      :ui="{
        overlay: 'app-overlay-layer bg-black/55',
        content: 'app-modal-layer app-panel w-[calc(100%-2rem)] max-w-sm p-5 shadow-xl',
      }"
      @update:open="(open: boolean) => !open && !deletingSessionId && (deleteTarget = null)"
    >
      <template #content>
        <div>
          <h2 class="text-base font-semibold text-highlighted">彻底删除这场模拟面试？</h2>
          <p class="mt-2 text-sm leading-6 text-muted">问答、评分、深度点评和能力证据都会一并删除，且无法恢复。</p>
          <div class="mt-6 flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="Boolean(deletingSessionId)"
              @click="deleteTarget = null"
            >
              取消
            </UButton>
            <UButton color="error" icon="i-lucide-trash-2" :loading="Boolean(deletingSessionId)" @click="confirmDelete">
              彻底删除
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </main>
</template>
