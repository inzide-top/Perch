<template>
  <div class="space-y-5" aria-label="正在加载能力画像" aria-busy="true">
    <div class="app-panel p-6 sm:p-8">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-3">
          <USkeleton class="h-3 w-28" />
          <USkeleton class="h-8 w-52" />
          <USkeleton class="h-4 w-80 max-w-[70vw]" />
        </div>
        <USkeleton class="h-9 w-44 rounded-xl" />
      </div>
      <div class="mt-6 grid gap-3 sm:grid-cols-4">
        <USkeleton v-for="index in 4" :key="index" class="h-20 rounded-2xl" />
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <USkeleton class="h-80 rounded-[var(--app-radius-panel)]" />
      <USkeleton class="h-80 rounded-[var(--app-radius-panel)]" />
    </div>
    <USkeleton class="h-96 rounded-[var(--app-radius-panel)]" />
  </div>
</template>
