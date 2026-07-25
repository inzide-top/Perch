<script setup lang="ts">
const navigation = [
  { label: '首页', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '简历管理', to: '/resumes', icon: 'i-lucide-file-text' },
  { label: '机会管理', to: '/opportunities', icon: 'i-lucide-briefcase-business' },
  { label: '求职策略', to: '/strategy', icon: 'i-lucide-compass' },
]
</script>

<template>
  <aside class="fixed inset-y-0 left-0 hidden w-64 border-r border-default bg-default lg:block">
    <div class="flex h-full flex-col px-4 py-5">
      <RouterLink to="/" class="mb-8 flex items-center gap-3 px-3">
        <div class="flex size-9 items-center justify-center rounded-lg bg-primary text-inverted">
          <UIcon name="i-lucide-sparkles" class="size-5" />
        </div>
        <div>
          <p class="text-sm font-semibold text-highlighted">Agent Seek</p>
          <p class="text-xs text-muted">Employment Workspace</p>
        </div>
      </RouterLink>

      <nav class="space-y-1">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-highlighted"
          active-class="bg-elevated text-highlighted"
        >
          <UIcon :name="item.icon" class="size-4" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="mt-auto rounded-lg border border-dashed border-default p-3 text-xs text-muted">
        <p class="font-medium text-highlighted">本地 Mock 阶段</p>
        <p class="mt-1 leading-5">先跑通简历版本链，再接入真实数据与 Agent。</p>
      </div>
    </div>
  </aside>
</template>
