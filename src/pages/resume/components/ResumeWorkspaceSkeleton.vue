<template>
  <div class="space-y-6" role="status" aria-label="正在加载简历与版本记录">
    <div class="flex items-center justify-between gap-4">
      <USkeleton class="h-6 w-24" />
      <div class="flex gap-2">
        <USkeleton class="h-9 w-28 rounded-xl" />
        <USkeleton class="h-9 w-24 rounded-xl" />
      </div>
    </div>

    <div class="grid items-start gap-6 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <USkeleton class="h-4 w-20" />
          <USkeleton class="h-6 w-12 rounded-full" />
        </div>
        <div v-for="index in 3" :key="index" class="app-card space-y-3 p-4">
          <USkeleton class="h-4 w-36" />
          <USkeleton class="h-3 w-28" />
          <USkeleton class="h-3 w-24" />
        </div>
      </section>

      <section class="app-panel space-y-5 p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-3">
            <USkeleton class="h-3 w-20" />
            <USkeleton class="h-6 w-48" />
            <USkeleton class="h-4 w-32" />
          </div>
          <div class="flex gap-2">
            <USkeleton class="h-8 w-20 rounded-lg" />
            <USkeleton class="h-8 w-20 rounded-lg" />
          </div>
        </div>
        <USkeleton class="h-28 w-full rounded-2xl" />
        <div class="grid gap-4 md:grid-cols-2">
          <USkeleton v-for="index in 6" :key="index" class="h-16 w-full rounded-2xl" />
        </div>
        <USkeleton class="h-40 w-full rounded-2xl" />
      </section>
    </div>
  </div>
</template>
