<script setup lang="ts">
defineProps<{
  title: string
  modelLabel: string
  isModelReady: boolean
}>()

defineEmits<{
  openSettings: []
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
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-sparkles"
      class="max-w-56"
      :class="isModelReady ? '' : 'border-warning/35 text-warning'"
      :title="isModelReady ? `当前工作台模型：${modelLabel}` : '当前未配置可用模型，点击前往设置'"
      @click="$emit('openSettings')"
    >
      <span class="truncate">{{ isModelReady ? `当前模型 · ${modelLabel}` : '当前未配置模型' }}</span>
    </UButton>
  </header>
</template>
