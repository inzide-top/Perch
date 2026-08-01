<template>
  <div class="space-y-3" role="status" aria-label="正在加载机会记录">
    <article v-for="index in 3" :key="index" class="app-card p-4">
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <USkeleton class="size-9 shrink-0 rounded-md" />
          <div class="min-w-0 flex-1 space-y-2">
            <USkeleton class="h-4 w-36 max-w-full" />
            <USkeleton class="h-3 w-52 max-w-[80%]" />
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <USkeleton class="size-8 rounded-md" />
          <USkeleton class="h-9 w-28 rounded-xl" />
          <USkeleton class="size-8 rounded-md" />
        </div>
      </div>
    </article>
  </div>
</template>
