<script setup lang="ts">
import { computed } from 'vue'
import perchMarkDarkUrl from '@/assets/brand/perch-mark-dark.png'
import perchMarkLightUrl from '@/assets/brand/perch-mark-light.png'
import { useAuthStore } from '@/stores/auth'

const isOpen = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ logout: []; feedback: [] }>()
const authStore = useAuthStore()

const navigation = [
  { label: '首页', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '简历管理', to: '/resumes', icon: 'i-lucide-file-text' },
  { label: '机会管理', to: '/opportunities', icon: 'i-lucide-briefcase-business' },
  { label: '求职策略', to: '/strategy', icon: 'i-lucide-compass' },
  { label: '设置', to: '/settings', icon: 'i-lucide-settings' },
]

const userInitial = computed(() => authStore.user?.displayName.trim().charAt(0).toUpperCase() || 'P')
const userSecondary = computed(() => {
  if (authStore.mode === 'interview') return '共享演示数据'
  if (authStore.mode === 'development') return 'demo-user'
  return authStore.user?.email ?? '已登录'
})

function closeNavigation() {
  isOpen.value = false
}

function openFeedback() {
  closeNavigation()
  emit('feedback')
}
</script>

<template>
  <USlideover
    :open="isOpen"
    side="left"
    :close="false"
    :ui="{
      overlay: 'app-overlay-layer',
      content: 'app-drawer-layer w-72 max-w-[calc(100vw-2.5rem)] p-0',
      body: 'p-0',
    }"
    @update:open="isOpen = $event"
  >
    <template #body>
      <aside class="flex min-h-full flex-col bg-[var(--app-surface)] px-3 py-4">
        <div class="flex items-center justify-between gap-3 px-1">
          <RouterLink to="/" class="flex min-w-0 items-center gap-3" aria-label="返回首页" @click="closeNavigation">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-xl p-0.5">
              <img :src="perchMarkLightUrl" alt="PERCH" class="size-full object-contain dark:hidden" />
              <img :src="perchMarkDarkUrl" alt="PERCH" class="hidden size-full object-contain dark:block" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold tracking-tight text-highlighted">PERCH</span>
              <span class="block truncate text-[11px] text-muted">AI Career Workspace</span>
            </span>
          </RouterLink>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            icon="i-lucide-x"
            aria-label="关闭导航"
            @click="closeNavigation"
          />
        </div>

        <nav class="mt-7 space-y-1.5" aria-label="主导航">
          <RouterLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            class="app-mobile-nav-item flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-[background-color,color,box-shadow] duration-150 hover:bg-[var(--app-accent-soft)] hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            active-class="is-active"
            @click="closeNavigation"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="mt-auto border-t border-default pt-3">
          <div class="flex items-center gap-3 rounded-xl px-2 py-2">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border-strong)] bg-elevated text-sm font-semibold text-[var(--app-accent-deep)]"
            >
              {{ userInitial }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-highlighted">{{ authStore.user?.displayName }}</span>
              <span class="block truncate text-xs text-muted">{{ userSecondary }}</span>
            </span>
          </div>
          <p v-if="authStore.mode === 'interview'" class="px-2 pb-2 text-xs leading-5 text-muted">
            当前体验者使用共享演示数据。
          </p>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            block
            icon="i-lucide-message-square-text"
            label="提交反馈"
            class="mt-1 justify-start"
            @click="openFeedback"
          />
          <UButton
            v-if="authStore.mode === 'supabase'"
            type="button"
            color="neutral"
            variant="ghost"
            block
            icon="i-lucide-log-out"
            label="退出登录"
            class="mt-1 justify-start"
            @click="emit('logout')"
          />
        </div>
      </aside>
    </template>
  </USlideover>
</template>

<style scoped>
.app-mobile-nav-item.is-active {
  background: color-mix(in srgb, var(--app-accent) 14%, transparent);
  box-shadow: inset 3px 0 0 var(--app-accent-deep);
  color: var(--app-text);
}
</style>
