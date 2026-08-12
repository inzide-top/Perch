<script setup lang="ts">
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
</script>

<template>
  <aside
    v-if="chatStore.isOpen"
    class="fixed inset-y-0 right-0 hidden h-screen max-w-full overflow-hidden border-l border-default bg-default shadow-[-14px_0_36px_rgb(15_23_42/10%)] lg:flex"
    :style="{ width: `${chatStore.width}px`, zIndex: 'var(--app-z-assistant)' }"
    aria-label="AI 助手正在加载"
    aria-busy="true"
  >
    <section class="flex h-full min-h-0 w-full flex-col">
      <header class="flex items-center gap-3 border-b border-default px-4 py-3">
        <USkeleton class="size-8 shrink-0 rounded-xl" />
        <div class="min-w-0 flex-1 space-y-2">
          <USkeleton class="h-4 w-24 rounded" />
          <USkeleton class="h-3 w-40 max-w-full rounded" />
        </div>
      </header>
      <div class="flex-1 space-y-5 overflow-hidden px-4 py-5">
        <div class="flex justify-end"><USkeleton class="h-20 w-4/5 rounded-2xl" /></div>
        <div class="flex gap-3">
          <USkeleton class="size-8 shrink-0 rounded-xl" />
          <USkeleton class="h-28 w-5/6 rounded-2xl" />
        </div>
      </div>
      <footer class="border-t border-default p-4">
        <USkeleton class="h-28 w-full rounded-2xl" />
      </footer>
    </section>
  </aside>
</template>
