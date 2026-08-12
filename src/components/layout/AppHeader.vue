<script setup lang="ts">
defineProps<{
  title: string
  modelLabel: string
  isModelReady: boolean
  isChatOpen: boolean
}>()

defineEmits<{
  openSettings: []
  toggleChat: []
}>()
</script>

<template>
  <header
    class="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_78%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:px-8"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold tracking-tight text-highlighted">{{ title }}</p>
      <p class="mt-0.5 truncate text-[11px] text-muted" title="Where rest becomes readiness.">
        Where rest becomes readiness.
      </p>
    </div>

    <div class="ml-3 flex shrink-0 items-center gap-2">
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-sparkles"
        class="hidden max-w-56 sm:inline-flex"
        :class="isModelReady ? '' : 'border-warning/35 text-warning'"
        :title="isModelReady ? `当前工作台模型：${modelLabel}` : '当前未配置可用模型，点击前往设置'"
        @click="$emit('openSettings')"
      >
        <span class="truncate">{{ isModelReady ? `当前模型 · ${modelLabel}` : '当前未配置模型' }}</span>
      </UButton>
      <UButton
        color="primary"
        variant="solid"
        size="sm"
        icon="i-lucide-message-circle"
        class="text-white shadow-sm"
        :aria-pressed="isChatOpen"
        :title="isChatOpen ? '收起 AI 助手' : '打开 AI 助手'"
        @click="$emit('toggleChat')"
      >
        AI 助手
      </UButton>
    </div>
  </header>
</template>
