<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores'
import type { ThemeMode } from '@/types/settings'

const settingsStore = useSettingsStore()

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
const savedMessage = ref('')
let savedMessageTimer: ReturnType<typeof window.setTimeout> | null = null

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
const currentThemeLabel = computed(
  () => themeOptions.find((item) => item.value === settingsStore.themeMode)?.label ?? '随系统',
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

function showSavedMessage() {
  savedMessage.value = '设置已保存'

  if (savedMessageTimer) window.clearTimeout(savedMessageTimer)

  savedMessageTimer = window.setTimeout(() => {
    savedMessage.value = ''
    savedMessageTimer = null
  }, 2500)
}

function saveLlmSettings() {
  if (!canSaveLlm.value) return

  settingsStore.updateLlmSettings({
    baseUrl: llmDraft.baseUrl,
    modelName: llmDraft.modelName,
    apiKey: llmDraft.apiKey,
  })
  showSavedMessage()
}

watch(
  () => settingsStore.llm,
  (llm) => {
    llmDraft.baseUrl = llm.baseUrl
    llmDraft.modelName = llm.modelName
    llmDraft.apiKey = llm.apiKey
  },
)

onBeforeUnmount(() => {
  if (savedMessageTimer) window.clearTimeout(savedMessageTimer)
})
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">系统设置</h1>
        <p class="mt-1 text-sm text-muted">配置工作台外观和后续 AI 调用所需的模型连接。</p>
      </div>
      <UBadge v-if="savedMessage" color="success" variant="subtle" :label="savedMessage" />
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
            当前仅保存到本地浏览器，后端接入后再做服务端加密与连通性检查
          </p>
        </UFormField>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="ghost" :disabled="!isLlmDirty" @click="fillDeepSeekPreset">
          恢复示例
        </UButton>
        <UButton type="button" icon="i-lucide-save" :disabled="!canSaveLlm" @click="saveLlmSettings"
          >保存模型配置</UButton
        >
      </div>
    </section>
  </section>
</template>
