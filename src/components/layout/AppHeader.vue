<script setup lang="ts">
defineProps<{
  title: string
  modelLabel: string
  isModelReady: boolean
  isChatOpen: boolean
}>()

defineEmits<{
  toggleNavigation: []
  openSettings: []
  toggleChat: []
}>()
</script>

<template>
  <header
    class="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_78%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:px-8"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        icon="i-lucide-menu"
        class="-ml-2 shrink-0 lg:hidden"
        aria-label="打开主导航"
        title="打开主导航"
        @click="$emit('toggleNavigation')"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold tracking-tight text-highlighted">{{ title }}</p>
        <p class="mt-0.5 truncate text-[11px] text-muted" title="Where rest becomes readiness.">
          Where rest becomes readiness.
        </p>
      </div>
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
        color="neutral"
        :variant="isChatOpen ? 'solid' : 'outline'"
        size="sm"
        :icon="isChatOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-circle'"
        class="app-chat-toggle transition-[box-shadow,background-color,color]"
        :class="
          isChatOpen
            ? 'app-chat-toggle--open shadow-sm ring-2 ring-primary/25'
            : 'app-chat-toggle--closed shadow-none'
        "
        :aria-pressed="isChatOpen"
        :title="isChatOpen ? '收起 AI 助手' : '打开 AI 助手'"
        @click="$emit('toggleChat')"
      >
        AI 助手
      </UButton>
    </div>
  </header>
</template>

<style scoped>
.app-chat-toggle--open {
  border-color: var(--app-accent-strong) !important;
  background: var(--app-accent-strong) !important;
  color: var(--ui-text-inverted) !important;
}

.app-chat-toggle--closed {
  border-color: var(--app-border-strong) !important;
  background: var(--app-surface) !important;
  color: var(--app-text) !important;
}

.app-chat-toggle--closed :deep(svg) {
  color: var(--app-accent-deep);
}
</style>
