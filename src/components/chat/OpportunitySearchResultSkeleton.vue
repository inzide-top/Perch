<template>
  <section
    class="rounded-2xl border border-default bg-[var(--app-surface-muted)]/55 p-3"
    aria-label="正在加载机会查询结果"
    aria-busy="true"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon name="i-lucide-briefcase-business" class="size-3.5" />
        </span>
        <span class="h-3 w-20 animate-pulse rounded-full bg-[var(--app-border)]" />
      </div>
      <span class="h-2.5 w-10 animate-pulse rounded-full bg-[var(--app-border)]" />
    </div>

    <div class="mt-3 space-y-2">
      <div
        v-for="index in 3"
        :key="index"
        class="flex items-center gap-3 rounded-xl border border-default bg-[var(--app-surface)] px-3 py-2.5"
      >
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex items-center gap-2">
            <span class="h-3 w-20 animate-pulse rounded-full bg-[var(--app-border)]" />
            <span class="h-2.5 w-28 animate-pulse rounded-full bg-[var(--app-surface-muted)]" />
          </div>
          <span class="block h-2.5 w-40 animate-pulse rounded-full bg-[var(--app-surface-muted)]" />
        </div>
        <span class="h-3 w-8 animate-pulse rounded-full bg-[var(--app-surface-muted)]" />
      </div>
    </div>
  </section>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .animate-pulse {
    animation: none;
  }
}
</style>
