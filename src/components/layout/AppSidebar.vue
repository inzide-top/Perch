<script setup lang="ts">
import perchMarkDarkUrl from '@/assets/brand/perch-mark-dark.png'
import perchMarkLightUrl from '@/assets/brand/perch-mark-light.png'

const isExpanded = defineModel<boolean>('expanded', { required: true })

const navigation = [
  { label: '首页', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '简历管理', to: '/resumes', icon: 'i-lucide-file-text' },
  { label: '机会管理', to: '/opportunities', icon: 'i-lucide-briefcase-business' },
  { label: '求职策略', to: '/strategy', icon: 'i-lucide-compass' },
]
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-30 hidden overflow-hidden border-r border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_92%,transparent)] shadow-[12px_0_34px_rgb(15_23_42/6%)] backdrop-blur-xl transition-[width] duration-200 ease-out lg:block"
    :class="isExpanded ? 'w-64' : 'w-16'"
  >
    <div class="absolute inset-y-0 top-0 left-1 w-16 px-2 py-3.5">
      <RouterLink
        v-if="isExpanded"
        to="/"
        class="flex size-10 items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label="返回首页"
        title="返回首页"
      >
        <img :src="perchMarkLightUrl" alt="PERCH" class="size-full object-contain dark:hidden" />
        <img :src="perchMarkDarkUrl" alt="PERCH" class="hidden size-full object-contain dark:block" />
      </RouterLink>
      <button
        v-else
        type="button"
        class="flex size-10 items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label="打开边栏"
        title="打开边栏"
        @click="isExpanded = true"
      >
        <img :src="perchMarkLightUrl" alt="PERCH" class="size-full object-contain dark:hidden" />
        <img :src="perchMarkDarkUrl" alt="PERCH" class="hidden size-full object-contain dark:block" />
      </button>
    </div>

    <div
      class="absolute inset-y-0 py-3.5 transition-[opacity,transform] duration-150 ease-out"
      :class="
        isExpanded
          ? 'left-16 w-48 translate-x-0 pr-3 opacity-100'
          : 'pointer-events-none left-16 w-48 -translate-x-2 pr-3 opacity-0'
      "
    >
      <div class="flex h-10 items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight text-highlighted">PERCH</p>
          <p class="truncate text-[11px] text-muted">AI Career Workspace</p>
        </div>

        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-panel-left-close"
          aria-label="关闭边栏"
          title="关闭边栏"
          @click="isExpanded = false"
        />
      </div>
    </div>

    <div class="flex h-full flex-col px-2 pb-4 pt-16">
      <nav class="space-y-1">
        <UTooltip
          v-for="item in navigation"
          :key="item.to"
          :text="item.label"
          :disabled="isExpanded"
          :content="{ side: 'right', sideOffset: 12 }"
        >
          <RouterLink
            :to="item.to"
            class="relative flex h-10 items-center rounded-xl text-sm font-medium text-muted transition-[width,background-color,color,box-shadow] duration-150 hover:bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)] hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :class="isExpanded ? 'w-60' : 'w-12'"
            active-class="sidebar-nav-active text-highlighted"
          >
            <span class="absolute left-0 top-0 flex h-10 w-12 items-center justify-center">
              <UIcon :name="item.icon" class="size-4 shrink-0" />
            </span>
            <span
              class="absolute left-12 top-0 flex h-10 items-center overflow-hidden whitespace-nowrap transition-[opacity,transform] duration-150 ease-out"
              :class="isExpanded ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0'"
            >
              {{ item.label }}
            </span>
          </RouterLink>
        </UTooltip>
      </nav>

      <div class="mt-auto space-y-2">
        <UTooltip text="设置" :disabled="isExpanded" :content="{ side: 'right', sideOffset: 12 }">
          <RouterLink
            to="/settings"
            class="relative flex h-10 items-center rounded-xl text-sm font-medium text-muted transition-[width,background-color,color,box-shadow] duration-150 hover:bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)] hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :class="isExpanded ? 'w-60' : 'w-12'"
            active-class="sidebar-nav-active text-highlighted"
          >
            <span class="absolute left-0 top-0 flex h-10 w-12 items-center justify-center">
              <UIcon name="i-lucide-settings" class="size-4 shrink-0" />
            </span>
            <span
              class="absolute left-12 top-0 flex h-10 items-center overflow-hidden whitespace-nowrap transition-[opacity,transform] duration-150 ease-out"
              :class="isExpanded ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0'"
            >
              设置
            </span>
          </RouterLink>
        </UTooltip>
      </div>
    </div>
  </aside>
</template>
