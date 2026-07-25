<script setup lang="ts">
defineProps<{ title: string }>()

const isDark = defineModel<boolean>('isDark', { required: true })
</script>

<template>
  <header class="flex h-16 items-center justify-between border-b border-default bg-default px-4 sm:px-6 lg:px-8">
    <div>
      <p class="text-sm font-medium text-highlighted">{{ title }}</p>
      <p class="text-xs text-muted">本地优先的求职辅助工作台</p>
    </div>

    <UButton
      :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
      color="neutral"
      variant="ghost"
      :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
      @click="isDark = !isDark"
    />
  </header>
</template>
