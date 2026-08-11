<script setup lang="ts">
const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <section class="min-h-[calc(100vh-4rem)] bg-[var(--app-bg)]" role="status" aria-label="正在加载 JD 分析详情">
    <div
      class="mx-4 mt-4 rounded-[22px] border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_96%,transparent)] px-5 py-4 shadow-[var(--app-shadow-panel)] backdrop-blur-xl lg:mx-6 lg:px-6"
    >
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        class="-ml-2 mb-2"
        @click="emit('back')"
      >
        返回机会管理
      </UButton>
      <div class="flex flex-wrap items-center gap-2">
        <USkeleton class="h-7 w-36 rounded-lg" />
        <USkeleton class="h-6 w-20 rounded-full" />
        <USkeleton class="h-6 w-32 rounded-full" />
      </div>
      <div class="mt-2 flex items-center justify-between gap-4">
        <USkeleton class="h-4 w-52 max-w-[60%]" />
        <USkeleton class="h-3 w-44 max-w-[34%]" />
      </div>
    </div>

    <div class="px-4 py-5 lg:px-6">
      <nav class="app-panel mb-5 flex flex-wrap items-center gap-1.5 p-1.5" aria-label="正在加载机会详情导航">
        <USkeleton v-for="index in 3" :key="index" class="h-10 w-32 rounded-xl" />
      </nav>

      <main class="min-w-0 space-y-5" aria-label="正在加载机会详情内容">
        <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <USkeleton class="h-48 w-full rounded-[var(--app-radius-panel)]" />
          <USkeleton class="h-48 w-full rounded-[var(--app-radius-panel)]" />
        </div>
        <div class="grid gap-4 lg:grid-cols-3">
          <USkeleton v-for="index in 6" :key="index" class="h-32 w-full rounded-[var(--app-radius-card)]" />
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          <USkeleton class="h-64 w-full rounded-[var(--app-radius-panel)]" />
          <USkeleton class="h-64 w-full rounded-[var(--app-radius-panel)]" />
        </div>
        <USkeleton class="h-64 w-full rounded-[var(--app-radius-panel)]" />
      </main>
    </div>
  </section>
</template>
