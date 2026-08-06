<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { useSettingsStore } from '@/stores'
import { interviewApi } from '@/services/interviews'
import { isSameModelIdentity } from '@/services/interview-runtime'
import type { LlmConnectionSettings, ThemeMode } from '@/types/settings'

const settingsStore = useSettingsStore()
const toast = useToast()

const themeOptions: { label: string; value: ThemeMode; icon: string; description: string }[] = [
  { label: '随系统', value: 'system', icon: 'i-lucide-monitor-cog', description: '跟随系统浅色或深色设置' },
  { label: '浅色', value: 'light', icon: 'i-lucide-sun', description: '白色背景，适合白天开发' },
  { label: '深色', value: 'dark', icon: 'i-lucide-moon', description: '石墨黑背景，适合长时间阅读' },
]

const llmDraft = reactive({
  baseUrl: settingsStore.llm.baseUrl,
  modelName: settingsStore.llm.modelName,
  apiKey: settingsStore.llm.apiKey,
})
const apiKeyVisible = ref(false)
const isCheckingModelUsage = ref(false)
const isModelWarningOpen = ref(false)
const affectedInterviewCount = ref(0)
const affectedModelName = ref('')
let pendingModelAction: (() => void) | null = null

const isLlmDirty = computed(() => {
  return (
    llmDraft.baseUrl !== settingsStore.llm.baseUrl ||
    llmDraft.modelName !== settingsStore.llm.modelName ||
    llmDraft.apiKey !== settingsStore.llm.apiKey
  )
})

const canSaveLlm = computed(
  () => isLlmDirty.value && llmDraft.baseUrl.trim() !== '' && llmDraft.modelName.trim() !== '',
)
const canSaveReusableLlm = computed(() => llmDraft.baseUrl.trim() !== '' && llmDraft.modelName.trim() !== '')
const currentThemeLabel = computed(
  () => themeOptions.find((item) => item.value === settingsStore.themeMode)?.label ?? '随系统',
)
const activeSavedLlmConnectionId = computed(
  () =>
    settingsStore.savedLlmConnections.find(
      (connection) =>
        connection.modelName === settingsStore.llm.modelName && connection.baseUrl === settingsStore.llm.baseUrl,
    )?.id ?? null,
)

function selectThemeMode(themeMode: ThemeMode) {
  settingsStore.setThemeMode(themeMode)
}

function fillDeepSeekPreset() {
  llmDraft.baseUrl = 'https://api.deepseek.com'
  llmDraft.modelName = 'deepseek-chat'
}

function clearApiKey() {
  llmDraft.apiKey = ''
}

async function runWithModelUsageWarning(
  identity: Pick<LlmConnectionSettings, 'baseUrl' | 'modelName'>,
  action: () => void,
) {
  isCheckingModelUsage.value = true
  try {
    const usages = await interviewApi.listActiveModelUsage()
    const affected = usages.filter((usage) => isSameModelIdentity(usage.modelSnapshot, identity))
    if (!affected.length) {
      action()
      return
    }

    affectedInterviewCount.value = affected.length
    affectedModelName.value = identity.modelName
    pendingModelAction = action
    isModelWarningOpen.value = true
  } catch (error) {
    toast.add({
      title: '暂时无法检查进行中的面试',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error',
    })
  } finally {
    isCheckingModelUsage.value = false
  }
}

function confirmPendingModelAction() {
  const action = pendingModelAction
  pendingModelAction = null
  isModelWarningOpen.value = false
  action?.()
}

function cancelPendingModelAction() {
  pendingModelAction = null
  isModelWarningOpen.value = false
}

async function saveLlmSettings() {
  if (!canSaveLlm.value) return

  const save = () => {
    settingsStore.updateLlmSettings({
      baseUrl: llmDraft.baseUrl,
      modelName: llmDraft.modelName,
      apiKey: llmDraft.apiKey,
    })
    toast.add({ title: '模型配置已保存', color: 'success' })
  }
  const nextIdentity = { baseUrl: llmDraft.baseUrl, modelName: llmDraft.modelName }
  if (isSameModelIdentity(settingsStore.llm, nextIdentity)) {
    save()
    return
  }
  await runWithModelUsageWarning(settingsStore.llm, save)
}

function saveCurrentLlmAsReusable() {
  if (!canSaveReusableLlm.value) return

  const savedConnection = settingsStore.saveLlmAsReusable({
    baseUrl: llmDraft.baseUrl,
    modelName: llmDraft.modelName,
    apiKey: llmDraft.apiKey,
  })

  toast.add({
    title: `已保存 ${savedConnection.modelName} 配置`,
    color: 'success',
  })
}

async function selectSavedLlmConnection(connectionId: string) {
  if (connectionId === activeSavedLlmConnectionId.value) return

  await runWithModelUsageWarning(settingsStore.llm, () => {
    const connection = settingsStore.useSavedLlmConnection(connectionId)
    if (!connection) return
    toast.add({ title: `已切换至 ${connection.modelName}`, color: 'success' })
  })
}

async function deleteSavedLlmConnection(connectionId: string) {
  const connection = settingsStore.savedLlmConnections.find((item) => item.id === connectionId)
  if (!connection) return

  const remove = () => {
    if (!settingsStore.deleteSavedLlmConnection(connectionId)) return
    toast.add({ title: `已删除 ${connection.modelName} 配置`, color: 'success' })
  }
  if (isSameModelIdentity(connection, settingsStore.llm)) {
    remove()
    return
  }
  await runWithModelUsageWarning(connection, remove)
}

watch(
  () => settingsStore.llm,
  (llm) => {
    llmDraft.baseUrl = llm.baseUrl
    llmDraft.modelName = llm.modelName
    llmDraft.apiKey = llm.apiKey
  },
)
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">系统设置</h1>
        <p class="mt-1 text-sm text-muted">配置工作台外观和后续 AI 调用所需的模型连接。</p>
      </div>
      <UButton to="/developer/agent-runs" target="_blank" color="neutral" variant="outline" icon="i-lucide-bug-play">
        打开 Agent 调试台
      </UButton>
    </div>

    <section class="app-panel p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="app-section-title">外观</h2>
          <p class="mt-1 text-sm text-muted">默认跟随系统，也可以固定为浅色或深色。</p>
        </div>
        <UBadge color="neutral" variant="subtle" :label="currentThemeLabel" />
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-3">
        <button
          v-for="option in themeOptions"
          :key="option.value"
          type="button"
          class="app-card app-card-interactive flex items-start gap-3 p-4 text-left"
          :class="
            settingsStore.themeMode === option.value
              ? 'border-primary bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface))]'
              : ''
          "
          @click="selectThemeMode(option.value)"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-primary"
          >
            <UIcon :name="option.icon" class="size-4" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-highlighted">{{ option.label }}</span>
            <span class="mt-1 block text-xs leading-5 text-muted">{{ option.description }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="app-panel p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="app-section-title">模型连接</h2>
          <p class="mt-1 text-sm text-muted">使用兼容 OpenAI Chat Completions 的服务地址、模型名和 Key。</p>
        </div>
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-sparkles" @click="fillDeepSeekPreset">
          DeepSeek 示例
        </UButton>
      </div>

      <div v-if="settingsStore.savedLlmConnections.length" class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-muted">已保存配置</span>
        <div
          v-for="connection in settingsStore.savedLlmConnections"
          :key="connection.id"
          class="model-config-tag-group flex overflow-hidden rounded-full border border-[var(--app-border)]"
          :class="{ 'is-active': connection.id === activeSavedLlmConnectionId }"
          :title="connection.baseUrl"
        >
          <UButton
            type="button"
            size="xs"
            color="neutral"
            variant="ghost"
            class="model-config-tag rounded-r-none shadow-none"
            :class="{ 'is-active': connection.id === activeSavedLlmConnectionId }"
            :disabled="isCheckingModelUsage"
            @click="selectSavedLlmConnection(connection.id)"
          >
            {{ connection.modelName }}
          </UButton>
          <UButton
            type="button"
            size="xs"
            color="neutral"
            variant="ghost"
            class="model-config-tag-remove rounded-l-none border-l border-default shadow-none"
            icon="i-lucide-x"
            :aria-label="`删除 ${connection.modelName} 配置`"
            :disabled="isCheckingModelUsage"
            @click="deleteSavedLlmConnection(connection.id)"
          />
        </div>
      </div>

      <div class="mt-5 grid gap-x-4 gap-y-3 md:grid-cols-2">
        <UFormField label="Base URL" required>
          <UInput v-model="llmDraft.baseUrl" class="w-full" placeholder="https://api.deepseek.com" />
          <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
        </UFormField>

        <UFormField label="Model ID" required>
          <UInput v-model="llmDraft.modelName" class="w-full" placeholder="deepseek-chat" />
          <p class="invisible mt-1 min-h-[14px] text-[11px] leading-[14px]">占位</p>
        </UFormField>

        <UFormField label="API Key" class="md:col-span-2">
          <div class="flex gap-2">
            <UInput
              v-model="llmDraft.apiKey"
              class="min-w-0 flex-1"
              :type="apiKeyVisible ? 'text' : 'password'"
              placeholder="sk-..."
            />
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :icon="apiKeyVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="apiKeyVisible ? '隐藏 API Key' : '显示 API Key'"
              @click="apiKeyVisible = !apiKeyVisible"
            />
            <UButton type="button" color="neutral" variant="outline" icon="i-lucide-eraser" @click="clearApiKey" />
          </div>
          <p class="mt-1 min-h-[14px] text-[11px] leading-[14px] text-muted">
            仅保存到当前浏览器；发起分析时临时传给后端，不写入分析记录或数据库
          </p>
        </UFormField>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="ghost" :disabled="!isLlmDirty" @click="fillDeepSeekPreset">
          恢复示例
        </UButton>
        <UButton
          type="button"
          icon="i-lucide-save"
          :loading="isCheckingModelUsage"
          :disabled="!canSaveLlm || isCheckingModelUsage"
          @click="saveLlmSettings"
          >保存模型配置</UButton
        >
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          icon="i-lucide-bookmark-plus"
          :disabled="!canSaveReusableLlm"
          @click="saveCurrentLlmAsReusable"
        >
          保存为可复用配置
        </UButton>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="isModelWarningOpen"
        class="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 px-4"
        role="dialog"
        aria-modal="true"
      >
        <section class="app-panel w-full max-w-md p-5 shadow-2xl">
          <div class="flex items-start gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <UIcon name="i-lucide-triangle-alert" class="size-4" />
            </span>
            <div>
              <h2 class="text-base font-semibold text-highlighted">有进行中的模拟面试</h2>
              <p class="mt-2 text-sm leading-6 text-muted">
                当前有 {{ affectedInterviewCount }} 场未完成面试绑定
                {{ affectedModelName }}。这次操作不会静默篡改历史任务；
                已在执行的任务仍会使用原模型完成。回到对应面试后，需要明确确认是否让后续问题改用当前模型。
              </p>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="cancelPendingModelAction">取消</UButton>
            <UButton type="button" color="warning" @click="confirmPendingModelAction">仍然继续</UButton>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>
