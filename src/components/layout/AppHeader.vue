<script setup lang="ts">
import type { ThemeMode } from '@/types/settings'

defineProps<{
  title: string
  isDark: boolean
  themeMode: ThemeMode
}>()

defineEmits<{
  toggleTheme: []
}>()
</script>

<template>
  <header
    class="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_78%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:px-8"
  >
    <div>
      <p class="text-sm font-semibold tracking-tight text-highlighted">{{ title }}</p>
      <p class="mt-0.5 text-[11px] text-muted">Where rest becomes readiness.</p>
    </div>

    <UButton
      :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
      color="neutral"
      variant="ghost"
      :title="themeMode === 'system' ? '当前随系统，点击后固定切换主题' : '切换主题'"
      :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
      @click="$emit('toggleTheme')"
    />
  </header>
</template>
