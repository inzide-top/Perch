<template>
  <section class="min-h-[calc(100vh-4rem)] bg-[var(--app-bg)]" role="status" aria-label="正在加载 JD 分析详情">
    <div class="app-panel mx-4 mt-4 space-y-3 px-5 py-4 lg:mx-6 lg:px-6">
      <USkeleton class="h-8 w-32 rounded-lg" />
      <div class="flex flex-wrap items-center gap-2">
        <USkeleton class="h-7 w-32" />
        <USkeleton class="h-6 w-16 rounded-full" />
        <USkeleton class="h-6 w-28 rounded-full" />
      </div>
      <USkeleton class="h-4 w-56 max-w-full" />
    </div>

    <div
      class="grid min-h-[calc(100vh-6.5rem)] items-stretch gap-5 px-4 py-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-6"
    >
      <aside class="app-panel min-h-[calc(100vh-6.5rem)] space-y-3 p-3">
        <USkeleton v-for="index in 3" :key="index" class="h-14 w-full rounded-xl" />
        <div class="border-t border-default pt-4">
          <USkeleton class="mb-3 h-3 w-16" />
          <USkeleton class="h-12 w-full rounded-xl" />
        </div>
      </aside>

      <main class="min-w-0 space-y-5">
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
      </main>
    </div>
  </section>
</template>
